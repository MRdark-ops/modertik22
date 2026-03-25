import { DashboardLayout } from "@/components/DashboardLayout";
import { StatusBadge } from "@/components/StatusBadge";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Trash2, Loader2, AlertTriangle, RefreshCw, CheckCircle2, XCircle, Info, Copy, ExternalLink } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

const COMMISSION_AMOUNTS = [2.50, 2.00, 1.50, 1.00, 0.50];

const SUPABASE_PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "tflqruwrfplrsfasfbia";
const SQL_EDITOR_URL = `https://supabase.com/dashboard/project/${SUPABASE_PROJECT_ID}/sql/new`;

// Minimal SQL — just 2 policies (much simpler than RPC functions)
const MINIMAL_SQL = `-- Run these 2 statements in Supabase SQL Editor:
-- ${SQL_EDITOR_URL}

CREATE POLICY IF NOT EXISTS "Admins can update all profiles"
  ON public.profiles FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY IF NOT EXISTS "Admins can insert commissions"
  ON public.referral_commissions FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));`;

interface CommissionLine {
  level: number;
  name: string;
  amount: number;
  ok: boolean;
  error?: string;
}

interface ApproveResult {
  depositId: string;
  userName: string;
  ok: boolean;
  method: "direct";
  error?: string;
  lines: CommissionLine[];
  skipped?: boolean;
  skipReason?: string;
}

export default function AdminDepositsPage() {
  const queryClient = useQueryClient();
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [proofOpen, setProofOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; amount: number; status: string } | null>(null);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [result, setResult] = useState<ApproveResult | null>(null);
  const [sqlOpen, setSqlOpen] = useState(false);
  const [sqlCopied, setSqlCopied] = useState(false);

  const copySql = () => {
    navigator.clipboard.writeText(MINIMAL_SQL);
    setSqlCopied(true);
    setTimeout(() => setSqlCopied(false), 2000);
    toast.success("SQL copied — paste it in the Supabase SQL Editor and click Run");
  };

  const { data: deposits } = useQuery({
    queryKey: ["admin-deposits"],
    queryFn: async () => {
      const { data: deps } = await supabase
        .from("deposits")
        .select("id, amount, status, created_at, proof_url, user_id")
        .order("created_at", { ascending: false });
      if (!deps || deps.length === 0) return [];

      const userIds = Array.from(new Set(deps.map((d) => d.user_id)));
      const [profilesRes, commissionsRes] = await Promise.all([
        supabase.from("profiles").select("user_id, full_name, referred_by, balance").in("user_id", userIds),
        supabase.from("referral_commissions").select("deposit_id").in("deposit_id", deps.map((d) => d.id)),
      ]);

      const profileMap = new Map(
        (profilesRes.data ?? []).map((p) => [p.user_id, p])
      );
      const paidDeposits = new Set<string>(
        (commissionsRes.data ?? []).map((c) => c.deposit_id).filter(Boolean) as string[]
      );

      return deps.map((d) => ({
        ...d,
        full_name: profileMap.get(d.user_id)?.full_name ?? "Unknown",
        balance: profileMap.get(d.user_id)?.balance ?? 0,
        referred_by: profileMap.get(d.user_id)?.referred_by ?? null,
        has_commissions: paidDeposits.has(d.id),
      }));
    },
  });

  const handleViewProof = async (path: string) => {
    const { data } = await supabase.storage.from("deposit-proofs").createSignedUrl(path, 300);
    if (data?.signedUrl) { setProofUrl(data.signedUrl); setProofOpen(true); }
    else toast.error("Failed to load proof image");
  };

  // ── Commission chain (direct INSERT — needs "Admins can insert commissions" policy) ──
  const runCommissionChain = async (
    depositId: string,
    depositorUserId: string
  ): Promise<CommissionLine[]> => {
    const lines: CommissionLine[] = [];
    let currentUserId = depositorUserId;

    for (let lvl = 1; lvl <= 5; lvl++) {
      const { data: prof } = await supabase
        .from("profiles")
        .select("referred_by, full_name, balance")
        .eq("user_id", currentUserId)
        .maybeSingle();

      if (!prof?.referred_by) break;

      const commAmt = COMMISSION_AMOUNTS[lvl - 1];
      const ancestorId = prof.referred_by;

      // Get ancestor info
      const { data: ancestor } = await supabase
        .from("profiles")
        .select("full_name, balance")
        .eq("user_id", ancestorId)
        .maybeSingle();

      try {
        // Insert commission record
        const { error: insErr } = await supabase.from("referral_commissions").insert({
          referrer_id: ancestorId,
          referred_id: depositorUserId,
          deposit_id: depositId,
          level: lvl,
          rate: 0,
          commission_amount: commAmt,
          status: "paid",
        });
        if (insErr) throw insErr;

        // Credit ancestor balance
        const newBal = (ancestor?.balance ?? 0) + commAmt;
        const { error: balErr } = await supabase
          .from("profiles")
          .update({ balance: newBal })
          .eq("user_id", ancestorId);
        if (balErr) throw balErr;

        lines.push({ level: lvl, name: ancestor?.full_name ?? "Unknown", amount: commAmt, ok: true });
      } catch (err: any) {
        lines.push({ level: lvl, name: ancestor?.full_name ?? "Unknown", amount: commAmt, ok: false, error: err.message });
        break; // Stop on first error — likely a missing policy
      }

      currentUserId = ancestorId;
    }
    return lines;
  };

  // ── Approve: Direct operations (no RPC needed) ──────────────────────────
  const handleApprove = async (depositId: string) => {
    setLoading(depositId + "-approve");
    const dep = (deposits as any[])?.find((d) => d.id === depositId);
    const userName = dep?.full_name ?? "User";

    if (!dep) {
      toast.error("Deposit not found");
      setLoading(null);
      return;
    }

    try {
      // Step 1: Approve deposit
      const { error: depErr } = await supabase
        .from("deposits")
        .update({ status: "approved" })
        .eq("id", depositId)
        .eq("status", "pending");
      
      if (depErr) throw new Error("Failed to approve deposit: " + depErr.message);

      // Step 2: Credit depositor balance
      const currentBalance = dep?.balance ?? 0;
      const amount = dep?.amount ?? 0;
      const { error: balErr, data: balData } = await supabase
        .from("profiles")
        .update({ balance: currentBalance + amount })
        .eq("user_id", dep?.user_id)
        .select("balance")
        .maybeSingle();

      // Detect silent RLS failure: no error but 0 rows updated
      const balanceCredited = !balErr && balData !== null;

      if (balErr || !balanceCredited) {
        setSqlOpen(true);
        setResult({
          depositId, userName, ok: false, method: "direct",
          error: `Deposit approved but balance credit failed. Run the SQL fix, then use "Retry Commission" on this deposit.`,
          lines: [],
        });
        queryClient.invalidateQueries({ queryKey: ["admin-deposits"] });
        return;
      }

      // Step 3: Commission chain
      let lines: CommissionLine[] = [];
      let skipped = false;
      let skipReason: string | undefined;

      if (!dep?.referred_by) {
        skipped = true;
        skipReason = "User has no referrer";
      } else {
        // Check if already paid
        const { count } = await supabase
          .from("referral_commissions")
          .select("id", { count: "exact", head: true })
          .eq("deposit_id", depositId)
          .eq("status", "paid");
        
        if ((count ?? 0) > 0) {
          skipped = true;
          skipReason = "Commissions already exist";
        } else {
          lines = await runCommissionChain(depositId, dep.user_id);
        }
      }

      queryClient.invalidateQueries({ queryKey: ["admin-deposits"] });

      const hasErrors = lines.some((l) => !l.ok);
      const successCount = lines.filter((l) => l.ok).length;

      setResult({ depositId, userName, ok: true, method: "direct", lines, skipped, skipReason });
      
      if (skipped) {
        toast.success(`Deposit approved — ${skipReason}`);
      } else if (!hasErrors && lines.length > 0) {
        toast.success(`Deposit approved — ${successCount} commission(s) credited`);
      } else if (hasErrors && successCount > 0) {
        toast.warning(`Deposit approved — ${successCount} of ${lines.length} commissions credited`);
      } else if (lines.length === 0) {
        toast.success("Deposit approved — no referrers in chain");
      } else {
        setSqlOpen(true);
        toast.warning("Deposit approved — commission credit failed");
      }
    } catch (err: any) {
      toast.error("Approval failed: " + err.message);
    } finally {
      setLoading(null);
    }
  };

  // ── Retry commissions (Direct approach - no RPC needed) ────────────────────
  const handleRetryCommissions = async (depositId: string, userName: string) => {
    setLoading(depositId + "-retry");
    const dep = (deposits as any[])?.find((d) => d.id === depositId);
    
    if (!dep) {
      toast.error("Deposit not found");
      setLoading(null);
      return;
    }

    try {
      // Check if commissions already exist for this deposit
      const { count: existingCount } = await supabase
        .from("referral_commissions")
        .select("id", { count: "exact", head: true })
        .eq("deposit_id", depositId)
        .eq("status", "paid");
      
      if ((existingCount ?? 0) > 0) {
        setResult({ 
          depositId, 
          userName, 
          ok: true, 
          method: "direct", 
          lines: [], 
          skipped: true, 
          skipReason: "Commissions already exist for this deposit" 
        });
        toast.info("Commissions already exist for this deposit");
        setLoading(null);
        return;
      }

      // Check if user has a referrer
      if (!dep?.referred_by) {
        setResult({ 
          depositId, 
          userName, 
          ok: true, 
          method: "direct", 
          lines: [], 
          skipped: true, 
          skipReason: "User has no referrer" 
        });
        toast.info("User has no referrer — no commissions to pay");
        setLoading(null);
        return;
      }

      // Run commission chain directly
      const lines = await runCommissionChain(depositId, dep.user_id);
      const hasErrors = lines.some((l) => !l.ok);
      const successCount = lines.filter((l) => l.ok).length;
      
      setResult({ 
        depositId, 
        userName, 
        ok: successCount > 0, 
        method: "direct", 
        lines 
      });
      
      queryClient.invalidateQueries({ queryKey: ["admin-deposits"] });
      
      if (lines.length === 0) {
        toast.info("No referrers found in the chain");
      } else if (!hasErrors) {
        toast.success(`${successCount} commission(s) credited successfully`);
      } else if (successCount > 0) {
        toast.warning(`${successCount} of ${lines.length} commissions credited — some failed`);
      } else {
        setSqlOpen(true);
        toast.error("Commission credit failed — check database permissions");
      }
    } catch (err: any) {
      toast.error("Retry failed: " + err.message);
      setResult({ 
        depositId, 
        userName, 
        ok: false, 
        method: "direct", 
        error: err.message, 
        lines: [] 
      });
    } finally {
      setLoading(null);
    }
  };

  // ── Reject ───────────────────────────────────────────────────────────────
  const handleReject = async (depositId: string) => {
    setLoading(depositId + "-reject");
    try {
      const { error } = await supabase.from("deposits").update({ status: "rejected" }).eq("id", depositId).eq("status", "pending");
      if (error) throw new Error(error.message);
      toast.success("Deposit rejected");
      queryClient.invalidateQueries({ queryKey: ["admin-deposits"] });
    } catch (err: any) {
      toast.error("Failed to reject: " + err.message);
    } finally {
      setLoading(null);
    }
  };

  // ── Delete ───────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setLoading(deleteTarget.id + "-delete");
    try {
      const { error } = await supabase.from("deposits").delete().eq("id", deleteTarget.id);
      if (error) throw new Error(error.message);
      toast.success("Deposit deleted");
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["admin-deposits"] });
    } catch (err: any) {
      toast.error("Failed to delete: " + err.message);
    } finally {
      setLoading(null);
    }
  };

  const handleDeleteAll = async () => {
    setLoading("delete-all");
    try {
      const { data: all } = await supabase.from("deposits").select("id");
      if (!all?.length) { toast.info("No deposits to delete"); setDeleteAllOpen(false); return; }
      const { error } = await supabase.from("deposits").delete().in("id", all.map((d) => d.id));
      if (error) throw new Error(error.message);
      toast.success(`${all.length} deposit(s) deleted`);
      setDeleteAllOpen(false);
      queryClient.invalidateQueries({ queryKey: ["admin-deposits"] });
    } catch (err: any) {
      toast.error("Failed: " + err.message);
    } finally {
      setLoading(null);
    }
  };

  const isLoading = (id: string, action: string) => loading === `${id}-${action}`;

  return (
    <DashboardLayout isAdmin title="Deposit Management">
      <div className="space-y-5 animate-fade-in">

        {/* ── SQL Setup Dialog ─────────────────────────────────────────── */}
        <Dialog open={sqlOpen} onOpenChange={setSqlOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-yellow-400">
                <AlertTriangle className="w-4 h-4" />
                One-Time Database Setup Required
              </DialogTitle>
              <DialogDescription className="pt-1">
                Run these 2 lines in{" "}
                <a href={SQL_EDITOR_URL} target="_blank" rel="noopener noreferrer"
                  className="text-primary underline inline-flex items-center gap-1">
                  Supabase SQL Editor <ExternalLink className="w-3 h-3" />
                </a>
                {" "}to enable commission payouts.
              </DialogDescription>
            </DialogHeader>

            <div className="bg-black/60 border border-border rounded-xl p-4 font-mono text-xs text-green-300 leading-relaxed whitespace-pre-wrap">
              {MINIMAL_SQL}
            </div>

            <div className="flex gap-2 pt-1">
              <Button onClick={copySql} variant="outline" className="flex-1 gap-2" data-testid="button-copy-sql">
                <Copy className="w-3.5 h-3.5" />
                {sqlCopied ? "Copied!" : "Copy SQL"}
              </Button>
              <Button asChild variant="outline" className="flex-1 gap-2">
                <a href={SQL_EDITOR_URL} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open SQL Editor
                </a>
              </Button>
            </div>

            <p className="text-xs text-muted-foreground text-center">
              After running: paste the SQL → click <strong>Run</strong> → come back here
            </p>

            <DialogFooter>
              <Button onClick={() => setSqlOpen(false)}>Done</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {deposits?.length ?? 0} deposit{deposits?.length !== 1 ? "s" : ""}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setSqlOpen(true)}
              className="text-xs text-yellow-400 border-yellow-500/30 hover:bg-yellow-500/10"
              data-testid="button-sql-setup">
              <AlertTriangle className="w-3 h-3 mr-1" /> SQL Setup
            </Button>
            {deposits && deposits.length > 0 && (
              <Button variant="destructive" size="sm" onClick={() => setDeleteAllOpen(true)}
                disabled={!!loading} className="text-xs" data-testid="button-delete-all">
                <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete All ({deposits.length})
              </Button>
            )}
          </div>
        </div>

        {/* ── Table ───────────────────────────────────────────────────── */}
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/30">
                  {["User", "Amount", "Proof", "Date", "Status", "Commission", "Actions"].map((h) => (
                    <th key={h} className="text-left py-3 px-4 text-muted-foreground font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {deposits?.map((d: any) => (
                  <tr key={d.id} className="border-b border-border/50 hover:bg-secondary/20 transition-colors" data-testid={`row-deposit-${d.id}`}>
                    <td className="py-3 px-4 font-medium">{d.full_name}</td>
                    <td className="py-3 px-4 font-semibold">${Number(d.amount).toFixed(2)}</td>
                    <td className="py-3 px-4">
                      {d.proof_url
                        ? <button onClick={() => handleViewProof(d.proof_url)} className="text-primary text-xs underline hover:text-primary/80" data-testid={`button-proof-${d.id}`}>View</button>
                        : "—"}
                    </td>
                    <td className="py-3 px-4 text-muted-foreground">{new Date(d.created_at).toLocaleDateString()}</td>
                    <td className="py-3 px-4"><StatusBadge status={d.status as any} /></td>
                    <td className="py-3 px-4">
                      {d.status === "approved"
                        ? d.referred_by
                          ? d.has_commissions
                            ? <span className="inline-flex items-center gap-1 text-xs text-green-400"><CheckCircle2 className="w-3 h-3" /> Paid</span>
                            : <span className="inline-flex items-center gap-1 text-xs text-yellow-400"><AlertTriangle className="w-3 h-3" /> Missing</span>
                          : <span className="text-xs text-muted-foreground">No referrer</span>
                        : <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1 flex-wrap">
                        {d.status === "pending" && (
                          <>
                            <button onClick={() => handleApprove(d.id)} disabled={!!loading}
                              className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-success/10 text-success border border-success/20 hover:bg-success/20 disabled:opacity-50"
                              data-testid={`button-approve-${d.id}`}>
                              {isLoading(d.id, "approve") ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                              Approve
                            </button>
                            <button onClick={() => handleReject(d.id)} disabled={!!loading}
                              className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/20 disabled:opacity-50"
                              data-testid={`button-reject-${d.id}`}>
                              {isLoading(d.id, "reject") ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                              Reject
                            </button>
                          </>
                        )}
                        {d.status === "approved" && d.referred_by && !d.has_commissions && (
                          <button onClick={() => handleRetryCommissions(d.id, d.full_name)} disabled={!!loading}
                            className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 hover:bg-yellow-500/20 disabled:opacity-50"
                            data-testid={`button-retry-${d.id}`}>
                            {isLoading(d.id, "retry") ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                            Retry Commission
                          </button>
                        )}
                        <button onClick={() => setDeleteTarget({ id: d.id, name: d.full_name, amount: Number(d.amount), status: d.status })}
                          disabled={!!loading}
                          className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/20 disabled:opacity-50"
                          data-testid={`button-delete-${d.id}`}>
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!deposits?.length && (
                  <tr><td colSpan={7} className="py-10 text-center text-muted-foreground">No deposits found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Approval / Commission Result Dialog ─────────────────────── */}
        <Dialog open={!!result} onOpenChange={(open) => { if (!open) setResult(null); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Info className="w-4 h-4 text-primary" />
                {result?.userName} — {result?.ok ? "Approved" : "Issue Detected"}
              </DialogTitle>
            </DialogHeader>
            <ScrollArea className="max-h-64 pr-1">
              <div className="space-y-2.5 text-sm">
                {result?.error && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-400 space-y-2">
                    <p>{result.error}</p>
                    <Button size="sm" variant="outline" onClick={() => setSqlOpen(true)} className="text-xs h-7">
                      View SQL Setup
                    </Button>
                  </div>
                )}
                {result?.skipped && (
                  <div className="bg-secondary/50 border border-border rounded-lg p-3 text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">Commissions skipped: </span>{result.skipReason}
                  </div>
                )}
                {result?.lines && result.lines.length > 0 && (
                  <div className="space-y-1.5">
                    {result.lines.map((ln) => (
                      <div key={ln.level} className={`flex items-center gap-2 p-2.5 rounded-lg border text-xs ${ln.ok ? "bg-green-500/5 border-green-500/20" : "bg-red-500/5 border-red-500/20"}`}>
                        {ln.ok ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0" /> : <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                        <span className="font-semibold">Level {ln.level}</span>
                        <span className="text-muted-foreground">— {ln.name}</span>
                        <span className="ml-auto text-primary font-mono">+${ln.amount.toFixed(2)}</span>
                        {ln.error && <span className="text-red-400 break-all block w-full mt-1">{ln.error}</span>}
                      </div>
                    ))}
                  </div>
                )}
                {result?.lines && result.lines.length > 0 && result.lines.every((l) => l.ok) && (
                  <p className="text-xs text-green-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    All {result.lines.length} commission(s) credited successfully
                  </p>
                )}
                {result?.lines?.some((l) => !l.ok) && (
                  <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-xs space-y-2">
                    <p className="text-yellow-400 font-semibold flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" /> Missing database permissions
                    </p>
                    <Button size="sm" variant="outline" onClick={() => setSqlOpen(true)} className="text-xs h-7">
                      View 2-Line SQL Fix
                    </Button>
                  </div>
                )}
              </div>
            </ScrollArea>
            <DialogFooter>
              <Button onClick={() => setResult(null)} data-testid="button-close-result">Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Proof Dialog ─────────────────────────────────────────────── */}
        <Dialog open={proofOpen} onOpenChange={setProofOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Deposit Proof</DialogTitle></DialogHeader>
            {proofUrl && <img src={proofUrl} alt="proof" className="w-full rounded-lg" />}
          </DialogContent>
        </Dialog>

        {/* ── Delete Single ────────────────────────────────────────────── */}
        <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-destructive flex items-center gap-2"><Trash2 className="w-4 h-4" /> Delete Deposit</DialogTitle>
              <DialogDescription className="pt-2 space-y-1">
                <span className="block">Delete deposit for <strong>{deleteTarget?.name}</strong> — ${deleteTarget?.amount?.toFixed(2)}?</span>
                {deleteTarget?.status === "approved" && (
                  <span className="block text-yellow-500 text-xs mt-1">⚠️ Already approved — balance will NOT be reversed.</span>
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 mt-2">
              <Button variant="outline" onClick={() => setDeleteTarget(null)} data-testid="button-cancel-delete">Cancel</Button>
              <Button variant="destructive" onClick={handleDelete} disabled={!!loading} data-testid="button-confirm-delete">
                {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null} Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Delete All ───────────────────────────────────────────────── */}
        <Dialog open={deleteAllOpen} onOpenChange={setDeleteAllOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-destructive flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Delete All Deposits</DialogTitle>
              <DialogDescription className="pt-2 space-y-1">
                <span className="block font-semibold text-foreground text-sm">This will delete ALL {deposits?.length ?? 0} deposit records permanently.</span>
                {deposits?.some((d: any) => d.status === "approved") && (
                  <span className="block text-yellow-500 text-xs mt-1">⚠️ Some are already approved — balances will NOT be reversed.</span>
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 mt-2">
              <Button variant="outline" onClick={() => setDeleteAllOpen(false)} data-testid="button-cancel-delete-all">Cancel</Button>
              <Button variant="destructive" onClick={handleDeleteAll} disabled={loading === "delete-all"} data-testid="button-confirm-delete-all">
                {loading === "delete-all" ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Trash2 className="w-3 h-3 mr-1" />}
                Delete All
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </div>
    </DashboardLayout>
  );
}

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
import { Trash2, Loader2, AlertTriangle, RefreshCw, CheckCircle2, XCircle, Info } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface CommissionLine {
  level: number;
  referrer_id: string;
  name: string;
  amount: number;
  ok: boolean;
  error?: string;
}

interface CommissionRunResult {
  depositId: string;
  userName: string;
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  error?: string;
  lines: CommissionLine[];
  rpcMissing?: boolean;
}

// SQL the admin must run in Supabase if the RPC functions are not yet applied
const REQUIRED_SQL = `-- Run this in Supabase SQL Editor → https://supabase.com/dashboard/project/_/sql

CREATE OR REPLACE FUNCTION public.admin_run_commissions(p_deposit_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid(); v_is_admin BOOLEAN;
  v_deposit RECORD; v_current_uid UUID; v_ancestor_id UUID;
  v_ancestor_bal NUMERIC; v_ancestor_nm TEXT; v_comm_amt NUMERIC;
  v_existing INT; v_lines JSON[] := ARRAY[]::JSON[];
  AMOUNTS CONSTANT NUMERIC[] := ARRAY[2.50, 2.00, 1.50, 1.00, 0.50];
BEGIN
  IF v_caller IS NULL THEN RETURN json_build_object('ok',false,'error','Unauthorized'); END IF;
  SELECT EXISTS(SELECT 1 FROM user_roles WHERE user_id=v_caller AND role='admin') INTO v_is_admin;
  IF NOT v_is_admin THEN RETURN json_build_object('ok',false,'error','Admin only'); END IF;
  SELECT d.*,p.referred_by,p.balance AS depositor_balance INTO v_deposit
  FROM deposits d JOIN profiles p ON p.user_id=d.user_id WHERE d.id=p_deposit_id;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'error','Deposit not found'); END IF;
  IF v_deposit.status != 'approved' THEN RETURN json_build_object('ok',false,'error','Deposit not approved'); END IF;
  IF v_deposit.referred_by IS NULL THEN
    RETURN json_build_object('ok',true,'skipped',true,'reason','No referrer','lines','[]'::JSON);
  END IF;
  SELECT COUNT(*) INTO v_existing FROM referral_commissions WHERE deposit_id=p_deposit_id AND status='paid';
  IF v_existing > 0 THEN
    RETURN json_build_object('ok',true,'skipped',true,'reason','Already paid ('||v_existing||' records)','lines','[]'::JSON);
  END IF;
  v_current_uid := v_deposit.user_id;
  FOR lvl IN 1..5 LOOP
    SELECT referred_by INTO v_ancestor_id FROM profiles WHERE user_id=v_current_uid;
    EXIT WHEN v_ancestor_id IS NULL;
    v_comm_amt := AMOUNTS[lvl];
    SELECT full_name,COALESCE(balance,0) INTO v_ancestor_nm,v_ancestor_bal FROM profiles WHERE user_id=v_ancestor_id;
    BEGIN
      INSERT INTO referral_commissions(referrer_id,referred_id,deposit_id,level,rate,commission_amount,status)
      VALUES(v_ancestor_id,v_deposit.user_id,p_deposit_id,lvl,0,v_comm_amt,'paid');
      UPDATE profiles SET balance=COALESCE(balance,0)+v_comm_amt WHERE user_id=v_ancestor_id;
      v_lines := v_lines || json_build_object('level',lvl,'referrer_id',v_ancestor_id,'name',COALESCE(v_ancestor_nm,'Unknown'),'amount',v_comm_amt,'ok',true);
    EXCEPTION WHEN OTHERS THEN
      v_lines := v_lines || json_build_object('level',lvl,'referrer_id',v_ancestor_id,'name',COALESCE(v_ancestor_nm,'Unknown'),'amount',v_comm_amt,'ok',false,'error',SQLERRM);
    END;
    v_current_uid := v_ancestor_id;
  END LOOP;
  RETURN json_build_object('ok',true,'skipped',false,'lines_count',array_length(v_lines,1),'lines',array_to_json(v_lines));
END; $$;
GRANT EXECUTE ON FUNCTION public.admin_run_commissions(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_approve_deposit(p_deposit_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid(); v_is_admin BOOLEAN;
  v_deposit RECORD; v_comm_result JSON;
BEGIN
  IF v_caller IS NULL THEN RETURN json_build_object('ok',false,'error','Unauthorized'); END IF;
  SELECT EXISTS(SELECT 1 FROM user_roles WHERE user_id=v_caller AND role='admin') INTO v_is_admin;
  IF NOT v_is_admin THEN RETURN json_build_object('ok',false,'error','Admin only'); END IF;
  SELECT * INTO v_deposit FROM deposits WHERE id=p_deposit_id;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'error','Deposit not found'); END IF;
  IF v_deposit.status != 'pending' THEN RETURN json_build_object('ok',false,'error','Already processed: '||v_deposit.status); END IF;
  UPDATE deposits SET status='approved' WHERE id=p_deposit_id;
  UPDATE profiles SET balance=COALESCE(balance,0)+v_deposit.amount WHERE user_id=v_deposit.user_id;
  SELECT public.admin_run_commissions(p_deposit_id) INTO v_comm_result;
  RETURN json_build_object('ok',true,'status','approved','amount',v_deposit.amount,'commission',v_comm_result);
END; $$;
GRANT EXECUTE ON FUNCTION public.admin_approve_deposit(UUID) TO authenticated;`;

export default function AdminDepositsPage() {
  const queryClient = useQueryClient();
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [proofOpen, setProofOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; amount: number; status: string } | null>(null);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [commissionResult, setCommissionResult] = useState<CommissionRunResult | null>(null);
  const [showRequiredSql, setShowRequiredSql] = useState(false);

  const handleViewProof = async (path: string) => {
    const { data } = await supabase.storage.from("deposit-proofs").createSignedUrl(path, 300);
    if (data?.signedUrl) { setProofUrl(data.signedUrl); setProofOpen(true); }
    else toast.error("Failed to load proof image");
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
        supabase.from("profiles").select("user_id, full_name, referred_by").in("user_id", userIds),
        supabase.from("referral_commissions")
          .select("deposit_id")
          .in("deposit_id", deps.map((d) => d.id)),
      ]);

      const profileMap = new Map(
        (profilesRes.data ?? []).map((p) => [p.user_id, { name: p.full_name, referredBy: p.referred_by }])
      );
      const paidDeposits = new Set<string>(
        (commissionsRes.data ?? []).map((c) => c.deposit_id).filter(Boolean) as string[]
      );

      return deps.map((d) => ({
        ...d,
        full_name: profileMap.get(d.user_id)?.name ?? "Unknown",
        referred_by: profileMap.get(d.user_id)?.referredBy ?? null,
        has_commissions: paidDeposits.has(d.id),
      }));
    },
  });

  // ── Parse RPC commission JSON ─────────────────────────────────────────────
  const parseCommissionJson = (raw: any): { lines: CommissionLine[]; skipped: boolean; reason?: string } => {
    if (!raw) return { lines: [], skipped: true, reason: "No commission data returned" };
    const rawLines = Array.isArray(raw.lines) ? raw.lines : (typeof raw.lines === "string" ? JSON.parse(raw.lines) : []);
    return {
      lines: rawLines as CommissionLine[],
      skipped: !!raw.skipped,
      reason: raw.reason,
    };
  };

  // ── Approve via RPC ───────────────────────────────────────────────────────
  const handleApprove = async (depositId: string) => {
    setLoading(depositId + "-approve");
    const userName = (deposits?.find((d: any) => d.id === depositId) as any)?.full_name ?? "User";
    try {
      const { data, error } = await supabase.rpc("admin_approve_deposit", { p_deposit_id: depositId });

      if (error) {
        // RPC function might not be applied yet
        if (error.message?.includes("does not exist") || error.code === "PGRST202") {
          setShowRequiredSql(true);
          toast.error("Database function not yet applied — see the SQL setup panel");
          return;
        }
        throw new Error(error.message);
      }

      const res = data as any;
      if (!res?.ok) throw new Error(res?.error ?? "Approval failed");

      const { lines, skipped, reason } = parseCommissionJson(res.commission);

      setCommissionResult({
        depositId,
        userName,
        ok: true,
        skipped,
        reason,
        lines,
      });

      queryClient.invalidateQueries({ queryKey: ["admin-deposits"] });

      if (lines.length > 0 && lines.every((l) => l.ok)) {
        toast.success("Deposit approved — commissions credited to referrers");
      } else if (skipped) {
        toast.success("Deposit approved — see commission details");
      } else {
        toast.success("Deposit approved — check commission report for details");
      }
    } catch (err: any) {
      toast.error(`Failed to approve: ${err.message}`);
    } finally {
      setLoading(null);
    }
  };

  // ── Retry commissions via RPC ─────────────────────────────────────────────
  const handleRetryCommissions = async (depositId: string, userName: string) => {
    setLoading(depositId + "-retry");
    try {
      const { data, error } = await supabase.rpc("admin_run_commissions", { p_deposit_id: depositId });

      if (error) {
        if (error.message?.includes("does not exist") || error.code === "PGRST202") {
          setShowRequiredSql(true);
          toast.error("Database function not yet applied — see the SQL setup panel");
          return;
        }
        throw new Error(error.message);
      }

      const res = data as any;
      const { lines, skipped, reason } = parseCommissionJson(res);

      setCommissionResult({
        depositId,
        userName,
        ok: !!res?.ok,
        skipped,
        reason: res?.error ?? reason,
        lines,
      });

      queryClient.invalidateQueries({ queryKey: ["admin-deposits"] });

      if (!res?.ok) {
        toast.error(res?.error ?? "Commission run failed");
      } else if (skipped) {
        toast.info("Commissions skipped — " + (reason ?? "see details"));
      } else if (lines.every((l) => l.ok)) {
        toast.success("Commissions credited successfully");
      } else {
        toast.warning("Commission run complete — some entries failed");
      }
    } catch (err: any) {
      toast.error(`Commission retry failed: ${err.message}`);
    } finally {
      setLoading(null);
    }
  };

  // ── Reject ───────────────────────────────────────────────────────────────
  const handleReject = async (depositId: string) => {
    setLoading(depositId + "-reject");
    try {
      const { data: dep, error } = await supabase
        .from("deposits").select("status").eq("id", depositId).single();
      if (error) throw new Error(error.message);
      if (dep.status !== "pending") throw new Error("Deposit already processed");

      const { error: updateErr } = await supabase
        .from("deposits").update({ status: "rejected" }).eq("id", depositId);
      if (updateErr) throw new Error(updateErr.message);

      toast.success("Deposit rejected");
      queryClient.invalidateQueries({ queryKey: ["admin-deposits"] });
    } catch (err: any) {
      toast.error(`Failed to reject: ${err.message}`);
    } finally {
      setLoading(null);
    }
  };

  // ── Delete single ─────────────────────────────────────────────────────────
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
      toast.error(`Failed to delete: ${err.message}`);
    } finally {
      setLoading(null);
    }
  };

  // ── Delete ALL deposits ────────────────────────────────────────────────────
  const handleDeleteAll = async () => {
    setLoading("delete-all");
    try {
      const { data: allDeposits, error: fetchErr } = await supabase
        .from("deposits").select("id");
      if (fetchErr) throw new Error(fetchErr.message);
      if (!allDeposits || allDeposits.length === 0) {
        toast.info("No deposits to delete");
        setDeleteAllOpen(false);
        return;
      }
      const ids = allDeposits.map((d) => d.id);
      const { error } = await supabase.from("deposits").delete().in("id", ids);
      if (error) throw new Error(error.message);
      toast.success(`${ids.length} deposit(s) deleted successfully`);
      setDeleteAllOpen(false);
      queryClient.invalidateQueries({ queryKey: ["admin-deposits"] });
    } catch (err: any) {
      toast.error(`Failed to delete all: ${err.message}`);
    } finally {
      setLoading(null);
    }
  };

  const isLoading = (id: string, action: string) => loading === `${id}-${action}`;

  return (
    <DashboardLayout isAdmin title="Deposit Management">
      <div className="space-y-6 animate-fade-in">

        {/* ── Required SQL banner ── */}
        {showRequiredSql && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-yellow-400 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                One-time Setup Required — Run in Supabase SQL Editor
              </h3>
              <button onClick={() => setShowRequiredSql(false)} className="text-muted-foreground hover:text-foreground text-xs">✕ Dismiss</button>
            </div>
            <p className="text-xs text-muted-foreground">
              The referral commission functions are not yet applied to your Supabase project.
              Copy the SQL below and run it in{" "}
              <a href={`https://supabase.com/dashboard/project/${import.meta.env.VITE_SUPABASE_PROJECT_ID}/sql`}
                target="_blank" rel="noopener noreferrer"
                className="text-primary underline">
                Supabase SQL Editor ↗
              </a>
            </p>
            <ScrollArea className="h-48 rounded-lg bg-black/40 border border-border">
              <pre className="text-[10px] p-3 text-green-300 leading-relaxed whitespace-pre-wrap font-mono">
                {REQUIRED_SQL}
              </pre>
            </ScrollArea>
            <Button
              size="sm"
              variant="outline"
              className="text-xs"
              onClick={() => { navigator.clipboard.writeText(REQUIRED_SQL); toast.success("SQL copied to clipboard"); }}
            >
              Copy SQL
            </Button>
          </div>
        )}

        {/* ── Header bar ── */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {deposits?.length ?? 0} total deposit{deposits?.length !== 1 ? "s" : ""}
          </p>
          <div className="flex items-center gap-2">
            {!showRequiredSql && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowRequiredSql(true)}
                className="text-xs text-muted-foreground"
                data-testid="button-show-sql-setup"
              >
                SQL Setup
              </Button>
            )}
            {deposits && deposits.length > 0 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setDeleteAllOpen(true)}
                disabled={!!loading}
                className="flex items-center gap-1.5 text-xs"
                data-testid="button-delete-all-deposits"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete All ({deposits.length})
              </Button>
            )}
          </div>
        </div>

        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/30">
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">User</th>
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">Amount</th>
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">Proof</th>
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">Date</th>
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">Status</th>
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">Commission</th>
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {deposits?.map((d: any) => (
                  <tr key={d.id} className="border-b border-border/50 hover:bg-secondary/20 transition-colors" data-testid={`row-deposit-${d.id}`}>
                    <td className="py-3 px-4 font-medium">{d.full_name}</td>
                    <td className="py-3 px-4 font-semibold">${Number(d.amount).toFixed(2)}</td>
                    <td className="py-3 px-4">
                      {d.proof_url ? (
                        <button onClick={() => handleViewProof(d.proof_url)} className="text-primary text-xs underline cursor-pointer hover:text-primary/80" data-testid={`button-view-proof-${d.id}`}>View</button>
                      ) : "-"}
                    </td>
                    <td className="py-3 px-4 text-muted-foreground">{new Date(d.created_at).toLocaleDateString()}</td>
                    <td className="py-3 px-4"><StatusBadge status={d.status as any} /></td>

                    {/* Commission status */}
                    <td className="py-3 px-4">
                      {d.status === "approved" ? (
                        d.referred_by ? (
                          d.has_commissions ? (
                            <span className="inline-flex items-center gap-1 text-xs text-green-400">
                              <CheckCircle2 className="w-3 h-3" /> Paid
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-yellow-400">
                              <AlertTriangle className="w-3 h-3" /> Missing
                            </span>
                          )
                        ) : (
                          <span className="text-xs text-muted-foreground">No referrer</span>
                        )
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>

                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1 flex-wrap">
                        {d.status === "pending" && (
                          <>
                            <button
                              onClick={() => handleApprove(d.id)}
                              disabled={!!loading}
                              className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-success/10 text-success border border-success/20 hover:bg-success/20 disabled:opacity-50"
                              data-testid={`button-approve-${d.id}`}
                            >
                              {isLoading(d.id, "approve") ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                              Approve
                            </button>
                            <button
                              onClick={() => handleReject(d.id)}
                              disabled={!!loading}
                              className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/20 disabled:opacity-50"
                              data-testid={`button-reject-${d.id}`}
                            >
                              {isLoading(d.id, "reject") ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                              Reject
                            </button>
                          </>
                        )}

                        {/* Retry commissions for approved + has referrer + missing commissions */}
                        {d.status === "approved" && d.referred_by && !d.has_commissions && (
                          <button
                            onClick={() => handleRetryCommissions(d.id, d.full_name)}
                            disabled={!!loading}
                            className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 hover:bg-yellow-500/20 disabled:opacity-50"
                            data-testid={`button-retry-commission-${d.id}`}
                          >
                            {isLoading(d.id, "retry") ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                            Retry Commission
                          </button>
                        )}

                        <button
                          onClick={() => setDeleteTarget({ id: d.id, name: d.full_name, amount: Number(d.amount), status: d.status })}
                          disabled={!!loading}
                          className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/20 disabled:opacity-50"
                          data-testid={`button-delete-${d.id}`}
                        >
                          <Trash2 className="w-3 h-3" /> Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!deposits?.length && (
                  <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">No deposits found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Commission Result Dialog ── */}
        <Dialog open={!!commissionResult} onOpenChange={(open) => { if (!open) setCommissionResult(null); }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Info className="w-4 h-4 text-primary" />
                Commission Report — {commissionResult?.userName}
              </DialogTitle>
            </DialogHeader>

            <ScrollArea className="max-h-72 pr-1">
              <div className="space-y-3 text-sm">

                {/* Error */}
                {commissionResult && !commissionResult.ok && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-400">
                    {commissionResult.reason ?? "An error occurred"}
                  </div>
                )}

                {/* Skipped */}
                {commissionResult?.skipped && (
                  <div className="bg-secondary/50 border border-border rounded-lg p-3 text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">Skipped: </span>
                    {commissionResult.reason}
                  </div>
                )}

                {/* Commission lines */}
                {commissionResult?.lines && commissionResult.lines.length > 0 && (
                  <div className="space-y-1.5">
                    {commissionResult.lines.map((ln) => (
                      <div
                        key={ln.level}
                        className={`flex items-start gap-2 p-2.5 rounded-lg border text-xs ${
                          ln.ok ? "bg-green-500/5 border-green-500/20" : "bg-red-500/5 border-red-500/20"
                        }`}
                      >
                        {ln.ok
                          ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400 mt-0.5 shrink-0" />
                          : <XCircle className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />
                        }
                        <div className="flex-1">
                          <span className="font-semibold">Level {ln.level}</span>
                          {ln.name && <span className="text-muted-foreground ml-1">— {ln.name}</span>}
                          <span className="ml-2 text-primary font-mono">+${ln.amount.toFixed(2)}</span>
                          {ln.error && <p className="text-red-400 mt-0.5 break-all">{ln.error}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* All levels succeed */}
                {commissionResult?.lines && commissionResult.lines.length > 0 && commissionResult.lines.every(l => l.ok) && (
                  <p className="text-xs text-green-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    All {commissionResult.lines.length} commission(s) credited successfully
                  </p>
                )}

                {/* Prompt to apply SQL if any line failed */}
                {commissionResult?.lines?.some(l => !l.ok) && (
                  <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-xs space-y-1.5">
                    <p className="text-yellow-400 font-semibold flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Commission functions may not be applied in Supabase
                    </p>
                    <p className="text-muted-foreground">
                      Click "SQL Setup" in the deposits header to view and apply the required SQL.
                    </p>
                  </div>
                )}
              </div>
            </ScrollArea>

            <DialogFooter>
              <Button onClick={() => setCommissionResult(null)} data-testid="button-close-commission-result">
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Proof Image Dialog */}
        <Dialog open={proofOpen} onOpenChange={setProofOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Deposit Proof</DialogTitle></DialogHeader>
            {proofUrl && <img src={proofUrl} alt="Deposit proof" className="w-full rounded-lg" />}
          </DialogContent>
        </Dialog>

        {/* Delete Single Confirmation Dialog */}
        <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-destructive flex items-center gap-2">
                <Trash2 className="w-4 h-4" /> Delete Deposit
              </DialogTitle>
              <DialogDescription className="pt-2 space-y-1">
                <span className="block">Are you sure you want to delete this deposit?</span>
                {deleteTarget && (
                  <span className="block text-foreground font-medium">
                    {deleteTarget.name} — ${deleteTarget.amount.toFixed(2)}{" "}
                    <span className="text-muted-foreground font-normal">({deleteTarget.status})</span>
                  </span>
                )}
                {deleteTarget?.status === "approved" && (
                  <span className="block text-yellow-500 text-xs mt-2">
                    ⚠️ Already approved — deleting will NOT reverse the user's balance.
                  </span>
                )}
                <span className="block text-muted-foreground text-xs mt-1">This action cannot be undone.</span>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 mt-2">
              <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={!!loading} data-testid="button-cancel-delete">Cancel</Button>
              <Button variant="destructive" onClick={handleDelete} disabled={!!loading} data-testid="button-confirm-delete">
                {loading ? <><Loader2 className="w-3 h-3 animate-spin mr-1" /> Deleting...</> : "Delete"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete ALL Confirmation Dialog */}
        <Dialog open={deleteAllOpen} onOpenChange={(open) => { if (!open) setDeleteAllOpen(false); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-destructive flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> Delete All Deposits
              </DialogTitle>
              <DialogDescription className="pt-3 space-y-2">
                <span className="block font-semibold text-foreground text-sm">
                  This will permanently delete ALL {deposits?.length ?? 0} deposit record(s).
                </span>
                {deposits?.some((d: any) => d.status === "approved") && (
                  <span className="block text-yellow-500 text-xs bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-2 mt-1">
                    ⚠️ Some deposits are already approved — deleting them will NOT reverse user balances.
                  </span>
                )}
                <span className="block text-destructive text-xs font-medium mt-1">This action cannot be undone.</span>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 mt-2">
              <Button variant="outline" onClick={() => setDeleteAllOpen(false)} disabled={loading === "delete-all"} data-testid="button-cancel-delete-all">Cancel</Button>
              <Button variant="destructive" onClick={handleDeleteAll} disabled={loading === "delete-all"} data-testid="button-confirm-delete-all">
                {loading === "delete-all"
                  ? <><Loader2 className="w-3 h-3 animate-spin mr-1" /> Deleting...</>
                  : <><Trash2 className="w-3 h-3 mr-1" /> Delete All</>
                }
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </div>
    </DashboardLayout>
  );
}

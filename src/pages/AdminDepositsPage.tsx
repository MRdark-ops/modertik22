import { DashboardLayout } from "@/components/DashboardLayout";
import { StatusBadge } from "@/components/StatusBadge";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Trash2, Loader2, AlertTriangle } from "lucide-react";

// Commission per level: index = level number (1-based)
// Level 1 = direct referrer, Level 2-5 = indirect chain
const COMMISSION_PER_LEVEL: Record<number, number> = {
  1: 2.50,
  2: 2.00,
  3: 1.50,
  4: 1.00,
  5: 0.50,
};

export default function AdminDepositsPage() {
  const queryClient = useQueryClient();
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [proofOpen, setProofOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; amount: number; status: string } | null>(null);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);

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
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", userIds);
      const profileMap = new Map((profiles ?? []).map((p) => [p.user_id, p.full_name]));
      return deps.map((d) => ({ ...d, full_name: profileMap.get(d.user_id) ?? "Unknown" }));
    },
  });

  // ── Approve ──────────────────────────────────────────────────────────────
  const handleApprove = async (depositId: string) => {
    setLoading(depositId + "-approve");
    const commissionWarnings: string[] = [];

    try {
      // ── Step 1: Fetch and validate deposit ─────────────────────────────
      const { data: dep, error: depErr } = await supabase
        .from("deposits").select("*").eq("id", depositId).single();
      if (depErr || !dep) throw new Error(depErr?.message ?? "Deposit not found");
      if (dep.status !== "pending") throw new Error("Deposit already processed");

      // ── Step 2: Read depositor profile FIRST (before marking approved) ─
      const { data: profile, error: profErr } = await supabase
        .from("profiles").select("balance, referred_by").eq("user_id", dep.user_id).single();
      if (profErr) throw new Error(`Failed to read user profile: ${profErr.message}`);

      // ── Step 3: Mark deposit approved ──────────────────────────────────
      const { error: updateErr } = await supabase
        .from("deposits").update({ status: "approved" }).eq("id", depositId);
      if (updateErr) throw new Error(`Failed to update deposit status: ${updateErr.message}`);

      // ── Step 4: Credit depositor's balance ─────────────────────────────
      const newDepositorBalance = parseFloat(profile.balance ?? "0") + parseFloat(dep.amount);
      const { error: balErr } = await supabase
        .from("profiles")
        .update({ balance: newDepositorBalance })
        .eq("user_id", dep.user_id);
      if (balErr) throw new Error(`Balance update failed: ${balErr.message}. Deposit is marked approved — manually credit balance of $${dep.amount} to user.`);

      // ── Step 5: Multi-level referral commissions ────────────────────────
      if (profile.referred_by) {
        // Guard: skip if commissions already paid for this referred user
        const { count: alreadyPaid, error: checkErr } = await supabase
          .from("referral_commissions")
          .select("*", { count: "exact", head: true })
          .eq("referred_id", dep.user_id)
          .eq("status", "paid");

        if (checkErr) {
          commissionWarnings.push(`Could not verify existing commissions: ${checkErr.message}`);
        } else if (!alreadyPaid || alreadyPaid === 0) {
          // Build ancestor chain: walk referred_by up to 5 levels
          type Ancestor = { userId: string; level: number };
          const ancestors: Ancestor[] = [];
          let currentUserId: string | null = dep.user_id;

          for (let lvl = 1; lvl <= 5; lvl++) {
            const { data: p, error: chainErr } = await supabase
              .from("profiles")
              .select("referred_by")
              .eq("user_id", currentUserId!)
              .single();

            if (chainErr) {
              commissionWarnings.push(`Chain traversal stopped at level ${lvl}: ${chainErr.message}`);
              break;
            }
            if (!p?.referred_by) break; // end of chain

            ancestors.push({ userId: p.referred_by, level: lvl });
            currentUserId = p.referred_by;
          }

          console.info(`[Commission] Found ${ancestors.length} ancestor(s) for deposit ${depositId}`, ancestors);

          // Grant commission to each ancestor
          for (const ancestor of ancestors) {
            const commissionAmt = COMMISSION_PER_LEVEL[ancestor.level] ?? 0;
            if (commissionAmt <= 0) continue;

            // Insert commission record
            const { error: comErr } = await supabase.from("referral_commissions").insert({
              referrer_id: ancestor.userId,
              referred_id: dep.user_id,
              deposit_id: depositId,
              level: ancestor.level,
              rate: 0,
              commission_amount: commissionAmt,
              status: "paid",
            });

            if (comErr) {
              const msg = `L${ancestor.level} commission insert failed: ${comErr.message}`;
              console.error(`[Commission] ${msg}`);
              commissionWarnings.push(msg);
              continue; // don't credit balance if commission record failed
            }

            // Credit ancestor balance
            const { data: ancProfile, error: ancReadErr } = await supabase
              .from("profiles").select("balance").eq("user_id", ancestor.userId).single();

            if (ancReadErr || !ancProfile) {
              const msg = `L${ancestor.level} ancestor profile not found: ${ancReadErr?.message ?? "no data"}`;
              console.error(`[Commission] ${msg}`);
              commissionWarnings.push(msg);
              continue;
            }

            const newAncBalance = parseFloat(ancProfile.balance ?? "0") + commissionAmt;
            const { error: ancBalErr } = await supabase
              .from("profiles")
              .update({ balance: newAncBalance })
              .eq("user_id", ancestor.userId);

            if (ancBalErr) {
              const msg = `L${ancestor.level} balance credit failed ($${commissionAmt}): ${ancBalErr.message}`;
              console.error(`[Commission] ${msg}`);
              commissionWarnings.push(msg);
            } else {
              console.info(`[Commission] L${ancestor.level} ancestor ${ancestor.userId} credited $${commissionAmt}`);
            }
          }
        } else {
          console.info(`[Commission] Skipped — commissions already paid for user ${dep.user_id}`);
        }
      }

      // ── Show result ─────────────────────────────────────────────────────
      if (commissionWarnings.length === 0) {
        toast.success("Deposit approved — balance and commissions credited");
      } else {
        toast.success("Deposit approved — balance credited");
        toast.warning(
          `${commissionWarnings.length} commission issue(s) — check browser console for details. Run required SQL policies if not done.`,
          { duration: 8000 }
        );
        console.warn("[Commission] Issues during approval:", commissionWarnings);
      }

      queryClient.invalidateQueries({ queryKey: ["admin-deposits"] });
    } catch (err: any) {
      toast.error(`Failed to approve: ${err.message}`);
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
      // Fetch all deposit IDs first (Supabase requires a filter to delete all rows via RLS)
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

        {/* ── Header bar with Delete All button ── */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {deposits?.length ?? 0} total deposit{deposits?.length !== 1 ? "s" : ""}
          </p>
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
                  <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">No deposits found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

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
                <span className="block text-sm">
                  Deposits will be removed from <span className="text-foreground font-medium">both the admin panel and all user accounts</span>.
                </span>
                {deposits?.some((d: any) => d.status === "approved") && (
                  <span className="block text-yellow-500 text-xs bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-2 mt-1">
                    ⚠️ Some deposits are already approved — deleting them will NOT reverse user balances.
                  </span>
                )}
                <span className="block text-destructive text-xs font-medium mt-1">
                  This action cannot be undone.
                </span>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 mt-2">
              <Button
                variant="outline"
                onClick={() => setDeleteAllOpen(false)}
                disabled={loading === "delete-all"}
                data-testid="button-cancel-delete-all"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteAll}
                disabled={loading === "delete-all"}
                data-testid="button-confirm-delete-all"
              >
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

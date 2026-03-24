import { DashboardLayout } from "@/components/DashboardLayout";
import { StatusBadge } from "@/components/StatusBadge";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Trash2, Loader2 } from "lucide-react";

const DIRECT_REWARD = 2.50;
const INDIRECT_TIERS = [2.00, 1.50, 1.00, 0.50];

export default function AdminDepositsPage() {
  const queryClient = useQueryClient();
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [proofOpen, setProofOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; amount: number; status: string } | null>(null);
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
    try {
      // 1. Fetch deposit
      const { data: dep, error: depErr } = await supabase
        .from("deposits").select("*").eq("id", depositId).single();
      if (depErr || !dep) throw new Error(depErr?.message ?? "Deposit not found");
      if (dep.status !== "pending") throw new Error("Deposit already processed");

      // 2. Update deposit status
      const { error: updateErr } = await supabase
        .from("deposits").update({ status: "approved" }).eq("id", depositId);
      if (updateErr) throw new Error(updateErr.message);

      // 3. Credit user balance
      const { data: profile, error: profErr } = await supabase
        .from("profiles").select("balance, referred_by").eq("user_id", dep.user_id).single();
      if (profErr) throw new Error(profErr.message);

      const { error: balErr } = await supabase
        .from("profiles")
        .update({ balance: parseFloat(profile.balance ?? "0") + parseFloat(dep.amount) })
        .eq("user_id", dep.user_id);
      if (balErr) throw new Error(`Balance update failed: ${balErr.message}`);

      // 4. Referral commissions
      if (profile.referred_by) {
        const directReferrerId = profile.referred_by;

        // Check if commission already granted for this user
        const { count: existing } = await supabase
          .from("referral_commissions")
          .select("*", { count: "exact", head: true })
          .eq("referred_id", dep.user_id)
          .eq("level", 1)
          .eq("status", "paid");

        if (!existing || existing === 0) {
          // Grant direct $2.50 commission
          await supabase.from("referral_commissions").insert({
            referrer_id: directReferrerId,
            referred_id: dep.user_id,
            deposit_id: depositId,
            level: 1,
            rate: 0,
            commission_amount: DIRECT_REWARD,
            status: "paid",
          });

          // Credit direct referrer
          const { data: refProfile } = await supabase
            .from("profiles").select("balance, referred_by").eq("user_id", directReferrerId).single();
          if (refProfile) {
            await supabase.from("profiles")
              .update({ balance: parseFloat(refProfile.balance ?? "0") + DIRECT_REWARD })
              .eq("user_id", directReferrerId);

            // Level 2 indirect commission
            if (refProfile.referred_by) {
              const grandReferrerId = refProfile.referred_by;
              const { count: priorCount } = await supabase
                .from("referral_commissions")
                .select("*", { count: "exact", head: true })
                .eq("referrer_id", directReferrerId)
                .eq("level", 1)
                .eq("status", "paid")
                .neq("referred_id", dep.user_id);

              const pos = priorCount ?? 0;
              const indirectAmt = pos < INDIRECT_TIERS.length ? INDIRECT_TIERS[pos] : 0.50;

              await supabase.from("referral_commissions").insert({
                referrer_id: grandReferrerId,
                referred_id: dep.user_id,
                deposit_id: depositId,
                level: 2,
                rate: 0,
                commission_amount: indirectAmt,
                status: "paid",
              });

              const { data: grandProfile } = await supabase
                .from("profiles").select("balance").eq("user_id", grandReferrerId).single();
              if (grandProfile) {
                await supabase.from("profiles")
                  .update({ balance: parseFloat(grandProfile.balance ?? "0") + indirectAmt })
                  .eq("user_id", grandReferrerId);
              }
            }
          }
        }
      }

      toast.success("Deposit approved and balance credited");
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
      toast.error(`Failed to delete: ${err.message}`);
    } finally {
      setLoading(null);
    }
  };

  const isLoading = (id: string, action: string) => loading === `${id}-${action}`;

  return (
    <DashboardLayout isAdmin title="Deposit Management">
      <div className="space-y-6 animate-fade-in">
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

        {/* Delete Confirmation Dialog */}
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
      </div>
    </DashboardLayout>
  );
}

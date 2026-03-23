import { DashboardLayout } from "@/components/DashboardLayout";
import { StatusBadge } from "@/components/StatusBadge";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";

export default function AdminDepositsPage() {
  const queryClient = useQueryClient();
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [proofOpen, setProofOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; amount: number; status: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleViewProof = async (path: string) => {
    const { data } = await supabase.storage
      .from("deposit-proofs")
      .createSignedUrl(path, 300);
    if (data?.signedUrl) {
      setProofUrl(data.signedUrl);
      setProofOpen(true);
    } else {
      toast.error("Failed to load proof image");
    }
  };

  const { data: deposits } = useQuery({
    queryKey: ["admin-deposits"],
    queryFn: async () => {
      const { data: deposits } = await supabase
        .from("deposits")
        .select("id, amount, status, created_at, proof_url, user_id")
        .order("created_at", { ascending: false });

      if (!deposits || deposits.length === 0) return [];

      const userIds = Array.from(new Set(deposits.map((d) => d.user_id)));
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", userIds);

      const profileMap = new Map((profiles ?? []).map((p) => [p.user_id, p.full_name]));

      return deposits.map((d) => ({
        ...d,
        full_name: profileMap.get(d.user_id) ?? "Unknown",
      }));
    },
  });

  const handleAction = async (depositId: string, action: "approve" | "reject") => {
    const { error } = await supabase.functions.invoke("approve-deposit", {
      body: { deposit_id: depositId, action, admin_note: "" },
    });
    if (error) toast.error("Failed to process deposit");
    else {
      toast.success(`Deposit ${action}d`);
      queryClient.invalidateQueries({ queryKey: ["admin-deposits"] });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.functions.invoke("approve-deposit", {
      body: { deposit_id: deleteTarget.id, action: "delete" },
    });
    setDeleting(false);
    if (error) {
      toast.error("Failed to delete deposit");
    } else {
      toast.success("Deposit deleted successfully");
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["admin-deposits"] });
    }
  };

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
                      <div className="flex items-center gap-1">
                        {d.status === "pending" && (
                          <>
                            <button
                              onClick={() => handleAction(d.id, "approve")}
                              className="px-2 py-1 text-xs rounded bg-success/10 text-success border border-success/20 hover:bg-success/20"
                              data-testid={`button-approve-${d.id}`}
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => handleAction(d.id, "reject")}
                              className="px-2 py-1 text-xs rounded bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/20"
                              data-testid={`button-reject-${d.id}`}
                            >
                              Reject
                            </button>
                          </>
                        )}
                        <button
                          onClick={() =>
                            setDeleteTarget({
                              id: d.id,
                              name: d.full_name,
                              amount: Number(d.amount),
                              status: d.status,
                            })
                          }
                          className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/20 transition-colors"
                          data-testid={`button-delete-${d.id}`}
                        >
                          <Trash2 className="w-3 h-3" /> Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Proof Image Dialog */}
        <Dialog open={proofOpen} onOpenChange={setProofOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Deposit Proof</DialogTitle>
            </DialogHeader>
            {proofUrl && (
              <img src={proofUrl} alt="Deposit proof" className="w-full rounded-lg" />
            )}
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
                <span className="block">
                  Are you sure you want to delete this deposit request?
                </span>
                {deleteTarget && (
                  <span className="block text-foreground font-medium">
                    {deleteTarget.name} — ${deleteTarget.amount.toFixed(2)}{" "}
                    <span className="text-muted-foreground font-normal">
                      ({deleteTarget.status})
                    </span>
                  </span>
                )}
                {deleteTarget?.status === "approved" && (
                  <span className="block text-yellow-500 text-xs mt-2">
                    ⚠️ This deposit is already approved. Deleting it will NOT reverse the user's balance.
                  </span>
                )}
                <span className="block text-muted-foreground text-xs mt-1">
                  This action cannot be undone.
                </span>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 mt-2">
              <Button
                variant="outline"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                data-testid="button-cancel-delete"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleting}
                data-testid="button-confirm-delete"
              >
                {deleting ? "Deleting..." : "Delete"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}

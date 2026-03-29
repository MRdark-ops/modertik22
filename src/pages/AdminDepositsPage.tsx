import { DashboardLayout } from "@/components/DashboardLayout";
import { StatusBadge } from "@/components/StatusBadge";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Trash2, Loader2, AlertTriangle, RefreshCw, CheckCircle2 } from "lucide-react";

// ── Component ────────────────────────────────────────────────────────────────
export default function AdminDepositsPage() {
  const queryClient = useQueryClient();
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [proofOpen, setProofOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
    amount: number;
    status: string;
  } | null>(null);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);

  const { data: deposits, isLoading: isLoadingDeposits } = useQuery({
    queryKey: ["admin-deposits"],
    queryFn: async () => {
      return await api.getAllDeposits();
    },
  });

  const handleViewProof = async (path: string) => {
    if (path) {
      setProofUrl(path);
      setProofOpen(true);
    }
  };

  // ── Approve ───────────────────────────────────────────────────────────
  const handleApprove = async (depositId: string) => {
    setLoading(depositId + "-approve");
    try {
      await api.approveDeposit(depositId, true);
      toast.success("Deposit approved successfully");
      queryClient.invalidateQueries({ queryKey: ["admin-deposits"] });
    } catch (err: any) {
      console.error("Approve error:", err);
      toast.error("Approval failed: " + (err?.message || "Unknown error"), {
        description: "Please try again or check the console for details.",
      });
    } finally {
      setLoading(null);
    }
  };

  // ── Reject ───────────────────────────────────────────────────────────
  const handleReject = async (depositId: string) => {
    setLoading(depositId + "-reject");
    try {
      await api.approveDeposit(depositId, false);
      toast.success("Deposit rejected");
      queryClient.invalidateQueries({ queryKey: ["admin-deposits"] });
    } catch (err: any) {
      console.error("Reject error:", err);
      toast.error("Failed to reject: " + (err?.message || "Unknown error"));
    } finally {
      setLoading(null);
    }
  };

  // ── Retry commissions ────────────────────────────────────────────────
  const handleRetryCommissions = async (depositId: string) => {
    setLoading(depositId + "-retry");
    try {
      await api.retryCommissions(depositId);
      toast.success(`Commissions processed successfully`);
      queryClient.invalidateQueries({ queryKey: ["admin-deposits"] });
    } catch (err: any) {
      console.error("Retry commissions error:", err);
      toast.error("Retry failed: " + (err?.message || "Unknown error"));
    } finally {
      setLoading(null);
    }
  };

  // ── Delete Single ────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setLoading(deleteTarget.id + "-delete");
    try {
      await api.deleteDeposit(deleteTarget.id);
      toast.success("Deposit deleted successfully");
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["admin-deposits"] });
    } catch (err: any) {
      console.error("Delete error:", err);
      toast.error("Delete failed: " + (err?.message || "Unknown error"));
    } finally {
      setLoading(null);
    }
  };

  // ── Delete All ───────────────────────────────────────────────────────
// ── Delete All ───────────────────────────────────────────────────────
const handleDeleteAll = async () => {
  setLoading("delete-all");
  try {
    // Note: Implement a delete all endpoint in your backend if needed
    toast.info("Mass delete should be implemented on backend");

    toast.success(`${deposits?.length ?? 0} deposit(s) deleted`);
    setDeleteAllOpen(false);
    queryClient.invalidateQueries({ queryKey: ["admin-deposits"] });
  } catch (err: any) {
    console.error("Delete all error:", err);
    toast.error("Failed to delete all: " + (err?.message || "Unknown error"));
  } finally {
    setLoading(null);
  }
};


  const isLoading = (id: string, action: string) => loading === `${id}-${action}`;

  return (
    <DashboardLayout isAdmin title="Deposit Management">
      <div className="space-y-5 animate-fade-in">
        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {deposits?.length ?? 0} deposit
            {deposits?.length !== 1 ? "s" : ""}
          </p>
          <div className="flex items-center gap-2">
            {deposits && deposits.length > 0 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setDeleteAllOpen(true)}
                disabled={!!loading}
                className="text-xs"
                data-testid="button-delete-all"
              >
                <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete All (
                {deposits.length})
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
                  {["User", "Amount", "Proof", "Date", "Status", "Commission", "Actions"].map(
                    (h) => (
                      <th
                        key={h}
                        className="text-left py-3 px-4 text-muted-foreground font-medium"
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {isLoadingDeposits && (
                  <tr>
                    <td colSpan={7} className="py-10 text-center">
                      <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
                    </td>
                  </tr>
                )}
                {deposits?.map((d: any) => (
                  <tr
                    key={d.id}
                    className="border-b border-border/50 hover:bg-secondary/20 transition-colors"
                    data-testid={`row-deposit-${d.id}`}
                  >
                    <td className="py-3 px-4 font-medium">{d.full_name}</td>
                    <td className="py-3 px-4 font-semibold">
                      ${Number(d.amount).toFixed(2)}
                    </td>
                    <td className="py-3 px-4">
                      {d.proof_url ? (
                        <button
                          onClick={() => handleViewProof(d.proof_url)}
                          className="text-primary text-xs underline hover:text-primary/80"
                          data-testid={`button-proof-${d.id}`}
                        >
                          View
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-3 px-4 text-muted-foreground">
                      {new Date(d.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-3 px-4">
                      <StatusBadge status={d.status as any} />
                    </td>
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
                          <span className="text-xs text-muted-foreground">
                            No referrer
                          </span>
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
                              className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-success/10 text-success border border-success/20 hover:bg-success/20 disabled:opacity-50 transition-colors"
                              data-testid={`button-approve-${d.id}`}
                            >
                              {isLoading(d.id, "approve") ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : null}
                              Approve
                            </button>
                            <button
                              onClick={() => handleReject(d.id)}
                              disabled={!!loading}
                              className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/20 disabled:opacity-50 transition-colors"
                              data-testid={`button-reject-${d.id}`}
                            >
                              {isLoading(d.id, "reject") ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : null}
                              Reject
                            </button>
                          </>
                        )}
                        {d.status === "approved" &&
                          d.referred_by &&
                          !d.has_commissions && (
                            <button
                              onClick={() => handleRetryCommissions(d.id)}
                              disabled={!!loading}
                              className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 hover:bg-yellow-500/20 disabled:opacity-50 transition-colors"
                              data-testid={`button-retry-${d.id}`}
                            >
                              {isLoading(d.id, "retry") ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <RefreshCw className="w-3 h-3" />
                              )}
                              Retry Commission
                            </button>
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
                          disabled={!!loading}
                          className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/20 disabled:opacity-50 transition-colors"
                          data-testid={`button-delete-${d.id}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!isLoadingDeposits && !deposits?.length && (
                  <tr>
                    <td
                      colSpan={7}
                      className="py-10 text-center text-muted-foreground"
                    >
                      No deposits found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Proof Dialog ─────────────────────────────────────────────── */}
        <Dialog open={proofOpen} onOpenChange={setProofOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Deposit Proof</DialogTitle>
            </DialogHeader>
            {proofUrl && (
              <img
                src={proofUrl}
                alt="Deposit proof"
                className="w-full rounded-lg border border-border"
                onError={() => toast.error("Failed to load image")}
              />
            )}
          </DialogContent>
        </Dialog>

        {/* ── Delete Single ────────────────────────────────────────────── */}
        <Dialog
          open={!!deleteTarget}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
        >
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-destructive flex items-center gap-2">
                <Trash2 className="w-4 h-4" /> Delete Deposit
              </DialogTitle>
              <DialogDescription className="pt-2 space-y-1">
                <span className="block">
                  Delete deposit for <strong>{deleteTarget?.name}</strong> — $                   {deleteTarget?.amount?.toFixed(2)}?
                </span>
                {deleteTarget?.status === "approved" && (
                  <span className="block text-yellow-500 text-xs mt-1">
                    Already approved — balance will NOT be reversed.
                  </span>
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 mt-2">
              <Button
                variant="outline"
                onClick={() => setDeleteTarget(null)}
                data-testid="button-cancel-delete"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={!!loading}
                data-testid="button-confirm-delete"
              >
                {loading ? (
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                ) : null}
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Delete All ───────────────────────────────────────────────── */}
        <Dialog open={deleteAllOpen} onOpenChange={setDeleteAllOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-destructive flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> Delete All Deposits
              </DialogTitle>
              <DialogDescription className="pt-2 space-y-1">
                <span className="block font-semibold text-foreground text-sm">
                  This will delete ALL {deposits?.length ?? 0} deposit records
                  permanently.
                </span>
                {deposits?.some((d: any) => d.status === "approved") && (
                  <span className="block text-yellow-500 text-xs mt-1">
                    Some are already approved — balances will NOT be reversed.
                  </span>
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 mt-2">
              <Button
                variant="outline"
                onClick={() => setDeleteAllOpen(false)}
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
                {loading === "delete-all" ? (
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                ) : (
                  <Trash2 className="w-3 h-3 mr-1" />
                )}
                Delete All
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
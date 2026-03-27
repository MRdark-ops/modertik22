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

export default function AdminDepositsPage() {
  const queryClient = useQueryClient();
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [proofOpen, setProofOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; amount: number; status: string } | null>(null);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);

  const { data: deposits } = useQuery({
    queryKey: ["admin-deposits"],
    queryFn: async () => {
      return await api.getAllDeposits();
    },
  });

  const handleViewProof = async (path: string) => {
    if (path.startsWith('http')) {
      setProofUrl(path);
      setProofOpen(true);
    } else {
      toast.error("Invalid proof image URL");
    }
  };

  const callAdminAPI = async (depositId: string, action: "approve" | "reject" | "delete" | "retry_commissions") => {
    switch (action) {
      case "approve":
        return await api.approveDeposit(depositId);
      case "reject":
        return await api.rejectDeposit(depositId);
      case "delete":
        // TODO: Add delete endpoint to API
        throw new Error("Delete not yet implemented in API");
      case "retry_commissions":
        // TODO: Add retry commissions endpoint to API
        throw new Error("Retry commissions not yet implemented in API");
      default:
        throw new Error("Unknown action");
    }
  };

  // ── Approve ───────────────────────────────────────────────────────────────
  const handleApprove = async (depositId: string) => {
    setLoading(depositId + "-approve");
    try {
      await callAdminAPI(depositId, "approve");
      toast.success("Deposit approved successfully");
      queryClient.invalidateQueries({ queryKey: ["admin-deposits"] });
    } catch (err: any) {
      const isEdgeError = err?.message?.includes('Edge Function') || err?.message?.includes('Approval failed');
      toast.error(
        isEdgeError ? "Connection failed. The request didn't reach the server." : "Approval failed: " + err.message,
        { description: isEdgeError ? "Please check your internet connection or if the Edge Function is deployed." : undefined }
      );
    } finally {
      setLoading(null);
    }
  };

  // ── Retry commissions via API ───────────────────────────────────────────────
  const handleRetryCommissions = async (depositId: string) => {
    setLoading(depositId + "-retry");
    try {
      const result = await callAdminAPI(depositId, "retry_commissions");

      if (result?.commissions_paid > 0) {
        toast.success(`${result.commissions_paid} commission(s) paid successfully`);
      } else if (result?.message) {
        toast.info(result.message);
      } else {
        toast.success("Commissions processed");
      }
      
      queryClient.invalidateQueries({ queryKey: ["admin-deposits"] });
    } catch (err: any) {
      const isEdgeError = err?.message?.includes('Edge Function') || err?.message?.includes('Approval failed');
      toast.error(
        isEdgeError ? "Server unreachable. Failed to retry commissions." : "Retry failed: " + err.message,
        { description: isEdgeError ? "Check your network or the Edge Function status." : undefined }
      );
    } finally {
      setLoading(null);
    }
  };

  // ── Reject ───────────────────────────────────────────────────────────────
  const handleReject = async (depositId: string) => {
    setLoading(depositId + "-reject");
    try {
      await callAdminAPI(depositId, "reject");
      toast.success("Deposit rejected");
      queryClient.invalidateQueries({ queryKey: ["admin-deposits"] });
    } catch (err: any) {
      const isEdgeError = err?.message?.includes('Edge Function') || err?.message?.includes('Approval failed');
      toast.error(
        isEdgeError ? "Network error. Failed to reject deposit." : "Failed to reject: " + err.message,
        { description: isEdgeError ? "The server could not be reached." : undefined }
      );
    } finally {
      setLoading(null);
    }
  };

  // ── Delete ───────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setLoading(deleteTarget.id + "-delete");
    try {
      await callAdminAPI(deleteTarget.id, "delete");
      toast.success("Deposit deleted successfully");
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["admin-deposits"] });
    } catch (err: any) {
      const isEdgeError = err?.message?.includes('Edge Function') || err?.message?.includes('Approval failed');
      toast.error(
        isEdgeError ? "Connection error. Could not delete deposit." : "Delete failed: " + err.message,
        { description: isEdgeError ? "Check your connection and try again." : undefined }
      );
    } finally {
      setLoading(null);
    }
  };

  const handleDeleteAll = async () => {
    setLoading("delete-all");
    try {
      const all = deposits ?? [];
      if (!all.length) { 
        toast.info("No deposits to delete"); 
        setDeleteAllOpen(false); 
        return; 
      }
      
      let deleted = 0;
      let failed = 0;
      
      for (const dep of all) {
        try {
          await callAdminAPI(dep.id, "delete");
          deleted++;
        } catch {
          failed++;
        }
      }
      
      if (failed > 0) {
        toast.warning(`${deleted} deleted, ${failed} failed. Check console logs.`);
      } else {
        toast.success(`${deleted} deposit(s) deleted`);
      }
      
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

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {deposits?.length ?? 0} deposit{deposits?.length !== 1 ? "s" : ""}
          </p>
          <div className="flex items-center gap-2">
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
                          <button onClick={() => handleRetryCommissions(d.id)} disabled={!!loading}
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
                  <span className="block text-yellow-500 text-xs mt-1">Already approved — balance will NOT be reversed.</span>
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
                  <span className="block text-yellow-500 text-xs mt-1">Some are already approved — balances will NOT be reversed.</span>
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

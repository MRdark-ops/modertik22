import { DashboardLayout } from "@/components/DashboardLayout";
import { StatusBadge } from "@/components/StatusBadge";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useState } from "react";
import { CheckCircle, Clock, CircleCheck, XCircle, Loader2 } from "lucide-react";

export default function AdminWithdrawalsPage() {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState<string | null>(null);

  const { data: withdrawals } = useQuery({
    queryKey: ["admin-withdrawals"],
    queryFn: async () => {
      const { data: wds } = await supabase
        .from("withdrawals")
        .select("id, amount, status, created_at, wallet_address, user_id")
        .order("created_at", { ascending: false });
      if (!wds || wds.length === 0) return [];
      const userIds = Array.from(new Set(wds.map((w) => w.user_id)));
      const { data: profiles } = await supabase
        .from("profiles").select("user_id, full_name").in("user_id", userIds);
      const profileMap = new Map((profiles ?? []).map((p) => [p.user_id, p.full_name]));
      return wds.map((w) => ({ ...w, full_name: profileMap.get(w.user_id) ?? "Unknown" }));
    },
  });

  const handleAction = async (
    withdrawalId: string,
    action: "approve" | "reject" | "in_progress" | "completed",
    userId: string,
    amount: number,
    currentStatus: string
  ) => {
    setLoading(`${withdrawalId}-${action}`);
    try {
      const statusMap: Record<string, string> = {
        approve: "approved",
        reject: "rejected",
        in_progress: "in_progress",
        completed: "completed",
      };
      const newStatus = statusMap[action];

      // Validate transition
      const validFrom: Record<string, string[]> = {
        pending: ["approved", "rejected"],
        approved: ["in_progress"],
        in_progress: ["completed"],
      };
      if (!validFrom[currentStatus]?.includes(newStatus)) {
        throw new Error(`Cannot change from "${currentStatus}" to "${newStatus}"`);
      }

      // Update withdrawal status
      const { error: updateErr } = await supabase
        .from("withdrawals").update({ status: newStatus }).eq("id", withdrawalId);
      if (updateErr) throw new Error(updateErr.message);

      // Refund balance if rejected
      if (action === "reject") {
        const { data: profile, error: profErr } = await supabase
          .from("profiles").select("balance").eq("user_id", userId).single();
        if (profErr) throw new Error(`Balance fetch failed: ${profErr.message}`);
        const { error: balErr } = await supabase
          .from("profiles")
          .update({ balance: parseFloat(profile.balance ?? "0") + amount })
          .eq("user_id", userId);
        if (balErr) throw new Error(`Balance refund failed: ${balErr.message}`);
      }

      const labels: Record<string, string> = {
        approve: "Withdrawal approved",
        reject: "Withdrawal rejected and balance refunded",
        in_progress: "Marked as in progress",
        completed: "Marked as completed",
      };
      toast.success(labels[action]);
      queryClient.invalidateQueries({ queryKey: ["admin-withdrawals"] });
    } catch (err: any) {
      toast.error(`Failed: ${err.message}`);
    } finally {
      setLoading(null);
    }
  };

  const isLoading = (id: string, action: string) => loading === `${id}-${action}`;

  const getActions = (status: string, id: string, userId: string, amount: number) => {
    const btnBase = "flex items-center gap-1 px-2 py-1 text-xs rounded border transition-colors disabled:opacity-50";
    switch (status) {
      case "pending":
        return (
          <div className="flex gap-1">
            <button
              onClick={() => handleAction(id, "approve", userId, amount, status)}
              disabled={!!loading}
              className={`${btnBase} bg-success/10 text-success border-success/20 hover:bg-success/20`}
              data-testid={`button-approve-${id}`}
            >
              {isLoading(id, "approve") ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
              Approve
            </button>
            <button
              onClick={() => handleAction(id, "reject", userId, amount, status)}
              disabled={!!loading}
              className={`${btnBase} bg-destructive/10 text-destructive border-destructive/20 hover:bg-destructive/20`}
              data-testid={`button-reject-${id}`}
            >
              {isLoading(id, "reject") ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
              Reject
            </button>
          </div>
        );
      case "approved":
        return (
          <button
            onClick={() => handleAction(id, "in_progress", userId, amount, status)}
            disabled={!!loading}
            className={`${btnBase} bg-primary/10 text-primary border-primary/20 hover:bg-primary/20`}
            data-testid={`button-in-progress-${id}`}
          >
            {isLoading(id, "in_progress") ? <Loader2 className="w-3 h-3 animate-spin" /> : <Clock className="w-3 h-3" />}
            In Progress
          </button>
        );
      case "in_progress":
        return (
          <button
            onClick={() => handleAction(id, "completed", userId, amount, status)}
            disabled={!!loading}
            className={`${btnBase} bg-success/10 text-success border-success/20 hover:bg-success/20`}
            data-testid={`button-completed-${id}`}
          >
            {isLoading(id, "completed") ? <Loader2 className="w-3 h-3 animate-spin" /> : <CircleCheck className="w-3 h-3" />}
            Completed
          </button>
        );
      default:
        return null;
    }
  };

  return (
    <DashboardLayout isAdmin title="Withdrawal Management">
      <div className="space-y-6 animate-fade-in">
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/30">
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">User</th>
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">Amount</th>
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">Wallet</th>
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">Date</th>
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">Status</th>
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {withdrawals?.map((w: any) => (
                  <tr key={w.id} className="border-b border-border/50 hover:bg-secondary/20 transition-colors" data-testid={`row-withdrawal-${w.id}`}>
                    <td className="py-3 px-4 font-medium">{w.full_name}</td>
                    <td className="py-3 px-4 font-semibold">${Number(w.amount).toFixed(2)}</td>
                    <td className="py-3 px-4 text-muted-foreground text-xs font-mono truncate max-w-[120px]">{w.wallet_address}</td>
                    <td className="py-3 px-4 text-muted-foreground">{new Date(w.created_at).toLocaleDateString()}</td>
                    <td className="py-3 px-4"><StatusBadge status={w.status as any} /></td>
                    <td className="py-3 px-4">{getActions(w.status, w.id, w.user_id, Number(w.amount))}</td>
                  </tr>
                ))}
                {!withdrawals?.length && (
                  <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">No withdrawals found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

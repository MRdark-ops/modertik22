import { DashboardLayout } from "@/components/DashboardLayout";
import { StatusBadge } from "@/components/StatusBadge";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CheckCircle, Clock, CircleCheck } from "lucide-react";

export default function AdminWithdrawalsPage() {
  const queryClient = useQueryClient();

  const { data: withdrawals } = useQuery({
    queryKey: ["admin-withdrawals"],
    queryFn: async () => {
      const { data: withdrawals } = await supabase
        .from("withdrawals")
        .select("id, amount, status, created_at, wallet_address, user_id")
        .order("created_at", { ascending: false });

      if (!withdrawals || withdrawals.length === 0) return [];

      const userIds = Array.from(new Set(withdrawals.map((w) => w.user_id)));
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", userIds);

      const profileMap = new Map((profiles ?? []).map((p) => [p.user_id, p.full_name]));

      return withdrawals.map((w) => ({
        ...w,
        full_name: profileMap.get(w.user_id) ?? "Unknown",
      }));
    },
  });

  const handleAction = async (withdrawalId: string, action: "approve" | "reject" | "in_progress" | "completed") => {
    const { data, error } = await supabase.functions.invoke("approve-withdrawal", {
      body: { withdrawal_id: withdrawalId, action, admin_note: "" },
    });
    if (error) {
      const msg = error?.message || "Unknown error";
      toast.error(`Failed to update withdrawal: ${msg}`);
      console.error("approve-withdrawal error:", error, data);
    } else if (data?.error) {
      toast.error(`Error: ${data.error}`);
    } else {
      toast.success("Withdrawal status updated successfully");
      queryClient.invalidateQueries({ queryKey: ["admin-withdrawals"] });
    }
  };

  const getActions = (status: string, id: string) => {
    switch (status) {
      case "pending":
        return (
          <div className="flex gap-1">
            <button onClick={() => handleAction(id, "approve")} className="px-2 py-1 text-xs rounded bg-success/10 text-success border border-success/20 hover:bg-success/20 flex items-center gap-1">
              <CheckCircle className="w-3 h-3" /> Approve
            </button>
            <button onClick={() => handleAction(id, "reject")} className="px-2 py-1 text-xs rounded bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/20">Reject</button>
          </div>
        );
      case "approved":
        return (
          <button onClick={() => handleAction(id, "in_progress")} className="px-2 py-1 text-xs rounded bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 flex items-center gap-1">
            <Clock className="w-3 h-3" /> In Progress
          </button>
        );
      case "in_progress":
        return (
          <button onClick={() => handleAction(id, "completed")} className="px-2 py-1 text-xs rounded bg-success/10 text-success border border-success/20 hover:bg-success/20 flex items-center gap-1">
            <CircleCheck className="w-3 h-3" /> Completed
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
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">Date</th>
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">Status</th>
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {withdrawals?.map((w: any) => (
                  <tr key={w.id} className="border-b border-border/50 hover:bg-secondary/20 transition-colors">
                    <td className="py-3 px-4 font-medium">{w.full_name}</td>
                    <td className="py-3 px-4 font-semibold">${Number(w.amount).toFixed(2)}</td>
                    <td className="py-3 px-4 text-muted-foreground">{new Date(w.created_at).toLocaleDateString()}</td>
                    <td className="py-3 px-4"><StatusBadge status={w.status as any} /></td>
                    <td className="py-3 px-4">{getActions(w.status, w.id)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

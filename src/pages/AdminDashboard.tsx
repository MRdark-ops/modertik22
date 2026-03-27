import { DashboardLayout } from "@/components/DashboardLayout";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { Users, DollarSign, ArrowDownToLine, ArrowUpFromLine, Activity, Eye, TrendingUp } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { toast } from "sonner";

export default function AdminDashboard() {
  const queryClient = useQueryClient();

  const { data: stats } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: async () => {
      return await api.getAdminStats();
    },
  });

  const { data: pendingDeposits } = useQuery({
    queryKey: ["admin-pending-deposits"],
    queryFn: async () => {
      const deposits = await api.getAllDeposits();
      return deposits.filter((d: any) => d.status === 'pending').slice(0, 5);
    },
  });

  const { data: recentLogs } = useQuery({
    queryKey: ["admin-recent-activity"],
    queryFn: async () => {
      return await api.getAdminLogs(5);
    },
  });

  const handleDeposit = async (depositId: string, action: "approve" | "reject") => {
    try {
      await api.approveDeposit(depositId, action === "approve");
      toast.success(`Deposit ${action}d`);
      queryClient.invalidateQueries({ queryKey: ["admin-pending-deposits"] });
      queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
      queryClient.invalidateQueries({ queryKey: ["admin-recent-activity"] });
    } catch (error) {
      toast.error("Failed to process deposit");
    }
  };

  const fmt = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <DashboardLayout isAdmin title="Admin Overview">
      <div className="space-y-6 animate-fade-in">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <StatCard title="Total Users" value={String(stats?.users ?? 0)} icon={Users} />
          <StatCard title="Total Visits" value={String(stats?.visits ?? 0)} icon={Eye} />
          <StatCard title="Total Deposits" value={fmt(stats?.deposits ?? 0)} icon={ArrowDownToLine} />
          <StatCard title="Total Withdrawals" value={fmt(stats?.withdrawals ?? 0)} icon={ArrowUpFromLine} />
          <StatCard title="Commissions Paid" value={fmt(stats?.commissions ?? 0)} icon={DollarSign} />
          <StatCard title="Net Earnings" value={fmt(stats?.netEarnings ?? 0)} icon={TrendingUp} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="glass-card p-6">
            <h3 className="font-display text-lg font-semibold mb-4 flex items-center gap-2">
              <ArrowDownToLine className="w-5 h-5 text-primary" /> Pending Deposits
            </h3>
            <div className="space-y-3">
              {(!pendingDeposits || pendingDeposits.length === 0) && (
                <p className="text-sm text-muted-foreground">No pending deposits</p>
              )}
              {pendingDeposits?.map((d: any) => (
                <div key={d.id} className="flex items-center justify-between py-3 border-b border-border last:border-0">
                  <div>
                    <p className="text-sm font-medium">{d.full_name}</p>
                    <p className="text-xs text-muted-foreground">{new Date(d.created_at).toLocaleDateString()}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold">{fmt(Number(d.amount))}</span>
                    <div className="flex gap-1">
                      <button onClick={() => handleDeposit(d.id, "approve")} className="px-2 py-1 text-xs rounded bg-success/10 text-success border border-success/20 hover:bg-success/20">Approve</button>
                      <button onClick={() => handleDeposit(d.id, "reject")} className="px-2 py-1 text-xs rounded bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/20">Reject</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-card p-6">
            <h3 className="font-display text-lg font-semibold mb-4 flex items-center gap-2">
              <Activity className="w-5 h-5 text-primary" /> Recent Activity
            </h3>
            <div className="space-y-3">
              {(!recentLogs || recentLogs.length === 0) && (
                <p className="text-sm text-muted-foreground">No recent activity</p>
              )}
              {recentLogs?.map((log: any) => (
                <div key={log.id} className="flex items-center justify-between py-3 border-b border-border last:border-0">
                  <div>
                    <p className="text-sm font-medium">{log.full_name}</p>
                    <p className="text-xs text-muted-foreground">{log.action.replace(/_/g, " ")}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">{(log.details as any)?.amount ? fmt(Number((log.details as any).amount)) : "-"}</p>
                    <p className="text-xs text-muted-foreground">{new Date(log.created_at).toLocaleDateString()}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

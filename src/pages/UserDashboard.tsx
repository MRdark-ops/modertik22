import { DashboardLayout } from "@/components/DashboardLayout";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { Wallet, TrendingUp, Users, ArrowDownToLine, ArrowUpFromLine, DollarSign } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import * as api from "@/lib/api";
import { useQuery } from "@tanstack/react-query";

export default function UserDashboard() {
  const { user, profile } = useAuth();

  const { data: deposits = [] } = useQuery({
    queryKey: ["deposits"],
    queryFn: () => api.getDeposits().then(res => res.deposits || []),
    enabled: !!user,
  });

  const { data: withdrawals = [] } = useQuery({
    queryKey: ["withdrawals"],
    queryFn: () => api.getWithdrawals().then(res => res.withdrawals || []),
    enabled: !!user,
  });

  const { data: referralData } = useQuery({
    queryKey: ["referrals"],
    queryFn: () => api.getReferrals(),
    enabled: !!user,
  });

  const balance = profile?.balance ?? 0;
  const approvedDeposits = deposits.filter((d: any) => d.status === 'approved') || [];
  const totalDeposits = approvedDeposits.reduce((sum: number, d: any) => sum + Number(d.amount), 0);
  
  const referralStats = referralData?.stats || { total_referred: 0, total_earned: 0 };
  const commissions = referralData?.commissions_breakdown || [];
  
  const recentTransactions = [
    ...deposits.map((d: any) => ({
      id: d.id, type: "Deposit" as const, amount: Number(d.amount), status: d.status, date: d.created_at,
    })),
    ...withdrawals.map((w: any) => ({
      id: w.id, type: "Withdrawal" as const, amount: Number(w.amount), status: w.status, date: w.created_at,
    })),
  ]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5);

  return (
    <DashboardLayout title="Dashboard">
      <div className="space-y-6 animate-fade-in">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="Account Balance" value={`$${Number(balance).toFixed(2)}`} icon={Wallet} />
          <StatCard title="Total Earnings" value={`$${referralStats.total_earned.toFixed(2)}`} icon={TrendingUp} />
          <StatCard title="Referral Earnings" value={`$${referralStats.total_earned.toFixed(2)}`} icon={Users} subtitle={`${referralStats.total_referred} referrals`} />
          <StatCard title="Total Deposits" value={`$${totalDeposits.toFixed(2)}`} icon={DollarSign} subtitle={`${approvedDeposits.length} approved`} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="glass-card p-6">
            <h3 className="font-display text-lg font-semibold mb-4">Recent Transactions</h3>
            <div className="space-y-3">
              {recentTransactions.map(tx => (
                <div key={tx.id} className="flex items-center justify-between py-3 border-b border-border last:border-0">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      tx.type === 'Deposit' ? 'bg-success/10' : 'bg-destructive/10'
                    }`}>
                      {tx.type === 'Deposit' ? <ArrowDownToLine className="w-4 h-4 text-success" /> :
                       <ArrowUpFromLine className="w-4 h-4 text-destructive" />}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{tx.type}</p>
                      <p className="text-xs text-muted-foreground">{new Date(tx.date).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold">${tx.amount.toFixed(2)}</span>
                    <StatusBadge status={tx.status} />
                  </div>
                </div>
              ))}
              {recentTransactions.length === 0 && (
                <p className="text-center text-muted-foreground py-4">No transactions yet</p>
              )}
            </div>
          </div>

          <div className="glass-card p-6">
            <h3 className="font-display text-lg font-semibold mb-4">Referral Summary</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between py-3 border-b border-border">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Users className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Total Referrals</p>
                    <p className="text-xs text-muted-foreground">
                      {referralStats.total_referred} signed up
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-semibold">{referralStats.total_referred} people</p>
                </div>
              </div>
              {commissions.map((c, idx) => (
                <div key={idx} className="flex items-center justify-between py-2 border-b border-border/50">
                  <span className="text-sm text-muted-foreground">Level {c.level} commissions</span>
                  <span className="text-sm font-semibold">${Number(c.total || 0).toFixed(2)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between pt-2">
                <span className="font-semibold">Total Referral Earnings</span>
                <span className="text-lg font-bold gold-gradient-text">${referralStats.total_earned.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

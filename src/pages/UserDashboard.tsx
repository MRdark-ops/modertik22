import { DashboardLayout } from "@/components/DashboardLayout";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { Wallet, TrendingUp, Users, ArrowDownToLine, ArrowUpFromLine, DollarSign } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

export default function UserDashboard() {
  const { user, profile } = useAuth();

  const { data: deposits = [] } = useQuery({
    queryKey: ["deposits", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("deposits")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(5);
      return data || [];
    },
    enabled: !!user,
  });

  const { data: withdrawals = [] } = useQuery({
    queryKey: ["withdrawals", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("withdrawals")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(5);
      return data || [];
    },
    enabled: !!user,
  });

  const { data: commissions = [] } = useQuery({
    queryKey: ["commissions", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("referral_commissions")
        .select("level, commission_amount")
        .eq("referrer_id", user!.id);
      return data || [];
    },
    enabled: !!user,
  });

  const { data: referralCount = 0 } = useQuery({
    queryKey: ["referral-count", user?.id],
    queryFn: async () => {
      const { count } = await supabase
        .from("referrals")
        .select("*", { count: "exact", head: true })
        .eq("referrer_id", user!.id);
      return count || 0;
    },
    enabled: !!user,
  });

  const balance = profile?.balance ?? 0;
  const totalDeposits = deposits
    .filter((d: any) => d.status === "approved")
    .reduce((sum: number, d: any) => sum + Number(d.amount), 0);
  const totalCommissions = commissions.reduce((sum: number, c: any) => sum + Number(c.commission_amount), 0);

  // Build recent transactions from deposits + withdrawals + commissions
  const recentTransactions = [
    ...deposits.map((d: any) => ({
      id: d.id,
      type: "Deposit" as const,
      amount: Number(d.amount),
      status: d.status,
      date: d.created_at,
    })),
    ...withdrawals.map((w: any) => ({
      id: w.id,
      type: "Withdrawal" as const,
      amount: Number(w.amount),
      status: w.status,
      date: w.created_at,
    })),
  ]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5);

  const COMMISSION_RATES = ["10%", "8%", "6%", "4%", "2%"];
  const referralLevels = [1, 2, 3, 4, 5].map(level => ({
    level,
    rate: COMMISSION_RATES[level - 1],
    earnings: commissions.filter((c: any) => c.level === level).reduce((s: number, c: any) => s + Number(c.commission_amount), 0),
  }));

  return (
    <DashboardLayout title="Dashboard">
      <div className="space-y-6 animate-fade-in">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="Account Balance" value={`$${Number(balance).toFixed(2)}`} icon={Wallet} />
          <StatCard title="Total Earnings" value={`$${totalCommissions.toFixed(2)}`} icon={TrendingUp} />
          <StatCard title="Referral Earnings" value={`$${totalCommissions.toFixed(2)}`} icon={Users} subtitle={`${referralCount} total referrals`} />
          <StatCard title="Total Deposits" value={`$${totalDeposits.toFixed(2)}`} icon={DollarSign} subtitle={`${deposits.length} deposits`} />
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
            <h3 className="font-display text-lg font-semibold mb-4">Referral Earnings by Level</h3>
            <div className="space-y-3">
              {referralLevels.map(lvl => (
                <div key={lvl.level} className="flex items-center justify-between py-3 border-b border-border last:border-0">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <span className="text-xs font-bold text-primary">L{lvl.level}</span>
                    </div>
                    <div>
                      <p className="text-sm font-medium">Level {lvl.level} ({lvl.rate})</p>
                    </div>
                  </div>
                  <span className="text-sm font-semibold gold-gradient-text">${lvl.earnings.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

import { DashboardLayout } from "@/components/DashboardLayout";
import { Users, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

const COMMISSION_RATES = ["10%", "8%", "6%", "4%", "2%"];

export default function ReferralsPage() {
  const [copied, setCopied] = useState(false);
  const { user, profile } = useAuth();

  const referralLink = profile?.referral_code
    ? `${window.location.origin}/register?ref=${profile.referral_code}`
    : "";

  const { data: referralData = [] } = useQuery({
    queryKey: ["referral-stats", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("referrals")
        .select("level, referred_id")
        .eq("referrer_id", user!.id);
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

  // Aggregate by level
  const levelStats = [1, 2, 3, 4, 5].map(level => {
    const count = referralData.filter(r => r.level === level).length;
    const earnings = commissions
      .filter(c => c.level === level)
      .reduce((sum, c) => sum + Number(c.commission_amount), 0);
    return { level, rate: COMMISSION_RATES[level - 1], count, earnings };
  });

  const totalEarnings = levelStats.reduce((sum, l) => sum + l.earnings, 0);

  const copyLink = () => {
    navigator.clipboard.writeText(referralLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <DashboardLayout title="Referrals">
      <div className="space-y-6 animate-fade-in max-w-5xl">
        <div className="glass-card p-6 gold-glow">
          <h3 className="font-display text-lg font-semibold mb-2 flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" /> Your Referral Link
          </h3>
          <p className="text-sm text-muted-foreground mb-4">Share this link to earn commissions on 5 levels!</p>
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-secondary rounded-lg px-4 py-2.5 text-sm font-mono text-foreground/80 border border-border">
              {referralLink || "Loading..."}
            </div>
            <Button onClick={copyLink} variant="outline" size="icon" className="h-10 w-10 border-primary/30 hover:bg-primary/10" disabled={!referralLink}>
              {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4 text-primary" />}
            </Button>
          </div>
        </div>

        <div className="glass-card p-6">
          <h3 className="font-display text-lg font-semibold mb-4">Commission by Level</h3>
          <div className="space-y-3">
            {levelStats.map(lvl => (
              <div key={lvl.level} className="flex items-center justify-between py-3 border-b border-border last:border-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <span className="text-sm font-bold text-primary">L{lvl.level}</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium">Level {lvl.level} — {lvl.rate}</p>
                    <p className="text-xs text-muted-foreground">{lvl.count} referrals</p>
                  </div>
                </div>
                <span className="font-semibold gold-gradient-text">${lvl.earnings.toFixed(2)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between pt-3">
              <span className="font-semibold">Total Earnings</span>
              <span className="text-lg font-bold gold-gradient-text">${totalEarnings.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

import { DashboardLayout } from "@/components/DashboardLayout";
import { Users, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

export default function ReferralsPage() {
  const [copied, setCopied] = useState(false);
  const { user, profile } = useAuth();

  const referralLink = profile?.referral_code
    ? `${window.location.origin}/register?ref=${profile.referral_code}`
    : "";

  const { data: directReferrals = [] } = useQuery({
    queryKey: ["direct-referrals", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("referrals")
        .select("referred_id, created_at")
        .eq("referrer_id", user!.id)
        .eq("level", 1)
        .order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!user,
  });

  const { data: commissions = [] } = useQuery({
    queryKey: ["commissions", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("referral_commissions")
        .select("commission_amount, created_at, referred_id")
        .eq("referrer_id", user!.id);
      return data || [];
    },
    enabled: !!user,
  });

  const totalEarnings = commissions.reduce((sum: number, c: any) => sum + Number(c.commission_amount), 0);

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
          <p className="text-sm text-muted-foreground mb-4">Share this link to earn $2.50 for each person who signs up and deposits!</p>
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
          <h3 className="font-display text-lg font-semibold mb-4">Referral Summary</h3>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-secondary/50 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold text-primary">{directReferrals.length}</p>
                <p className="text-xs text-muted-foreground mt-1">Total Referrals</p>
              </div>
              <div className="bg-secondary/50 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold text-primary">$2.50</p>
                <p className="text-xs text-muted-foreground mt-1">Per Referral</p>
              </div>
              <div className="bg-secondary/50 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold gold-gradient-text">${totalEarnings.toFixed(2)}</p>
                <p className="text-xs text-muted-foreground mt-1">Total Earnings</p>
              </div>
            </div>

            {directReferrals.length > 0 && (
              <div className="mt-4">
                <h4 className="text-sm font-medium mb-3">Recent Referrals</h4>
                {directReferrals.slice(0, 10).map((ref: any, i: number) => (
                  <div key={ref.referred_id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                        <span className="text-xs font-bold text-primary">#{i + 1}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">{new Date(ref.created_at).toLocaleDateString()}</p>
                    </div>
                    <span className="text-sm font-semibold gold-gradient-text">$2.50</span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between pt-3 border-t border-border">
              <span className="font-semibold">Total Earnings</span>
              <span className="text-lg font-bold gold-gradient-text">${totalEarnings.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

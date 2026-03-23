import { DashboardLayout } from "@/components/DashboardLayout";
import { Users, Copy, Check, Clock, CheckCircle2, TrendingUp } from "lucide-react";
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

  // All direct referrals (anyone who signed up with this user's code)
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

  // Verified direct commissions — only exist after deposit is approved
  const { data: directCommissions = [] } = useQuery({
    queryKey: ["direct-commissions", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("referral_commissions")
        .select("referred_id, commission_amount, created_at")
        .eq("referrer_id", user!.id)
        .eq("level", 1)
        .eq("status", "paid");
      return data || [];
    },
    enabled: !!user,
  });

  // Indirect commissions (tiered, level=2) from downline activity
  const { data: indirectCommissions = [] } = useQuery({
    queryKey: ["indirect-commissions", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("referral_commissions")
        .select("referred_id, commission_amount, created_at")
        .eq("referrer_id", user!.id)
        .eq("level", 2)
        .eq("status", "paid")
        .order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!user,
  });

  const verifiedIds = new Set(directCommissions.map((c: any) => c.referred_id));
  const verifiedCount = verifiedIds.size;
  const pendingCount = directReferrals.length - verifiedCount;

  const directEarnings = directCommissions.reduce(
    (sum: number, c: any) => sum + Number(c.commission_amount), 0
  );
  const indirectEarnings = indirectCommissions.reduce(
    (sum: number, c: any) => sum + Number(c.commission_amount), 0
  );
  const totalEarnings = directEarnings + indirectEarnings;

  const copyLink = () => {
    navigator.clipboard.writeText(referralLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <DashboardLayout title="Referrals">
      <div className="space-y-6 animate-fade-in max-w-5xl">

        {/* Referral Link */}
        <div className="glass-card p-6 gold-glow">
          <h3 className="font-display text-lg font-semibold mb-2 flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" /> Your Referral Link
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            Share this link. Earn{" "}
            <span className="text-primary font-semibold">$2.50</span> after your
            referral's first deposit is approved by an admin.
          </p>
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-secondary rounded-lg px-4 py-2.5 text-sm font-mono text-foreground/80 border border-border truncate">
              {referralLink || "Loading..."}
            </div>
            <Button
              onClick={copyLink}
              variant="outline"
              size="icon"
              className="h-10 w-10 shrink-0 border-primary/30 hover:bg-primary/10"
              disabled={!referralLink}
              data-testid="button-copy-referral"
            >
              {copied ? (
                <Check className="w-4 h-4 text-green-500" />
              ) : (
                <Copy className="w-4 h-4 text-primary" />
              )}
            </Button>
          </div>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="glass-card p-4 text-center">
            <p className="text-2xl font-bold text-foreground" data-testid="stat-total-referrals">
              {directReferrals.length}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Total Signed Up</p>
          </div>
          <div className="glass-card p-4 text-center">
            <p className="text-2xl font-bold text-green-500" data-testid="stat-verified-referrals">
              {verifiedCount}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Verified</p>
          </div>
          <div className="glass-card p-4 text-center">
            <p className="text-2xl font-bold text-yellow-500" data-testid="stat-pending-referrals">
              {pendingCount}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Pending</p>
          </div>
          <div className="glass-card p-4 text-center">
            <p className="text-2xl font-bold gold-gradient-text" data-testid="stat-total-earnings">
              ${totalEarnings.toFixed(2)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Total Earned</p>
          </div>
        </div>

        {/* How It Works + Tier Table */}
        <div className="glass-card p-6">
          <h3 className="font-display text-base font-semibold mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" /> How Rewards Work
          </h3>
          <div className="space-y-3 text-sm mb-5">
            {[
              "Your referral signs up using your link",
              "They make a deposit and upload payment proof",
              "Admin reviews and approves the deposit",
            ].map((step, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-xs shrink-0">
                  {i + 1}
                </span>
                <p className="text-muted-foreground">{step}</p>
              </div>
            ))}
            <div className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center text-green-500 font-bold text-xs shrink-0">
                ✓
              </span>
              <p className="text-foreground font-medium">
                You earn <span className="text-primary">$2.50</span> instantly credited to your balance
              </p>
            </div>
          </div>

          <div className="pt-4 border-t border-border">
            <p className="text-sm font-medium mb-3">Indirect Earnings (when your referrals invite others)</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                { label: "Their 1st verified referral", reward: "$2.00" },
                { label: "Their 2nd verified referral", reward: "$1.50" },
                { label: "Their 3rd verified referral", reward: "$1.00" },
                { label: "Their 4th+ verified referral", reward: "$0.50" },
              ].map(({ label, reward }) => (
                <div
                  key={label}
                  className="flex items-center justify-between bg-secondary/50 rounded px-3 py-2"
                >
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-semibold text-primary">{reward}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Direct Referrals List */}
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display text-base font-semibold">Direct Referrals</h3>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1 text-green-500">
                <CheckCircle2 className="w-3 h-3" /> Verified
              </span>
              <span className="flex items-center gap-1 text-yellow-500">
                <Clock className="w-3 h-3" /> Pending
              </span>
            </div>
          </div>

          {directReferrals.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No referrals yet — share your link to get started!
            </p>
          ) : (
            <div className="space-y-1">
              {directReferrals.map((ref: any, i: number) => {
                const isVerified = verifiedIds.has(ref.referred_id);
                const commission = directCommissions.find(
                  (c: any) => c.referred_id === ref.referred_id
                );
                return (
                  <div
                    key={ref.referred_id}
                    className="flex items-center justify-between py-2.5 px-3 rounded-lg border border-border/50 hover:bg-secondary/20 transition-colors"
                    data-testid={`row-referral-${ref.referred_id}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                        <span className="text-xs font-bold text-primary">#{i + 1}</span>
                      </div>
                      <div>
                        <p className="text-sm font-medium">Referral #{i + 1}</p>
                        <p className="text-xs text-muted-foreground">
                          Joined {new Date(ref.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {isVerified ? (
                        <>
                          <span className="flex items-center gap-1 text-xs text-green-500 font-medium">
                            <CheckCircle2 className="w-3 h-3" /> Verified
                          </span>
                          <span className="text-sm font-semibold gold-gradient-text">
                            +${Number(commission?.commission_amount ?? 2.50).toFixed(2)}
                          </span>
                        </>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-yellow-500 font-medium">
                          <Clock className="w-3 h-3" /> Awaiting deposit approval
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {directCommissions.length > 0 && (
            <div className="flex items-center justify-between pt-4 border-t border-border mt-4">
              <span className="text-sm font-semibold">Direct Earnings</span>
              <span className="text-base font-bold gold-gradient-text">${directEarnings.toFixed(2)}</span>
            </div>
          )}
        </div>

        {/* Indirect Earnings */}
        {indirectCommissions.length > 0 && (
          <div className="glass-card p-6">
            <h3 className="font-display text-base font-semibold mb-4">Indirect Earnings</h3>
            <div className="space-y-1">
              {indirectCommissions.map((c: any, i: number) => (
                <div
                  key={i}
                  className="flex items-center justify-between py-2.5 px-3 rounded-lg border border-border/50 hover:bg-secondary/20 transition-colors"
                  data-testid={`row-indirect-${i}`}
                >
                  <div>
                    <p className="text-sm font-medium">Indirect Referral Bonus</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(c.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <span className="text-sm font-semibold gold-gradient-text">
                    +${Number(c.commission_amount).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between pt-4 border-t border-border mt-4">
              <span className="text-sm font-semibold">Indirect Earnings</span>
              <span className="text-base font-bold gold-gradient-text">${indirectEarnings.toFixed(2)}</span>
            </div>
          </div>
        )}

        {/* Grand Total */}
        {(directCommissions.length > 0 || indirectCommissions.length > 0) && (
          <div className="glass-card p-5 gold-glow">
            <div className="flex items-center justify-between">
              <span className="font-display text-lg font-semibold">Total Referral Earnings</span>
              <span
                className="text-2xl font-bold gold-gradient-text"
                data-testid="text-grand-total"
              >
                ${totalEarnings.toFixed(2)}
              </span>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

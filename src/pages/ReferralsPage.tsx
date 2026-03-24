import { DashboardLayout } from "@/components/DashboardLayout";
import {
  Users, Copy, Check, Clock, CheckCircle2, Globe,
  TrendingUp, DollarSign, Star, Zap, Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

// ─── VIP Level definitions ────────────────────────────────────────────────────
const VIP_LEVELS = [
  {
    level: 1,
    label: "Level 1",
    required: 10,
    commission: "10% + 11%",
    perUser: 2.5,
    total: 25,
    color: "from-blue-500/20 to-blue-600/10",
    border: "border-blue-500/40",
    glow: "shadow-blue-500/20",
    text: "text-blue-400",
    badge: "bg-blue-500/20 text-blue-300",
    bar: "bg-blue-500",
    icon: <Users className="w-5 h-5" />,
    dbLevel: 1,
  },
  {
    level: 2,
    label: "Level 2",
    required: 100,
    commission: "8% + 8%",
    perUser: 2.0,
    total: 200,
    color: "from-violet-500/20 to-violet-600/10",
    border: "border-violet-500/40",
    glow: "shadow-violet-500/20",
    text: "text-violet-400",
    badge: "bg-violet-500/20 text-violet-300",
    bar: "bg-violet-500",
    icon: <TrendingUp className="w-5 h-5" />,
    dbLevel: 2,
  },
  {
    level: 3,
    label: "Level 3",
    required: 1_000,
    commission: "6%",
    perUser: 1.5,
    total: 1_500,
    color: "from-amber-500/20 to-amber-600/10",
    border: "border-amber-500/40",
    glow: "shadow-amber-500/20",
    text: "text-amber-400",
    badge: "bg-amber-500/20 text-amber-300",
    bar: "bg-amber-500",
    icon: <Star className="w-5 h-5" />,
    dbLevel: 3,
  },
  {
    level: 4,
    label: "Level 4",
    required: 10_000,
    commission: "4%",
    perUser: 1.0,
    total: 10_000,
    color: "from-orange-500/20 to-orange-600/10",
    border: "border-orange-500/40",
    glow: "shadow-orange-500/20",
    text: "text-orange-400",
    badge: "bg-orange-500/20 text-orange-300",
    bar: "bg-orange-500",
    icon: <Globe className="w-5 h-5" />,
    dbLevel: 4,
  },
  {
    level: 5,
    label: "Level 5",
    required: 100_000,
    commission: "2%",
    perUser: 0.5,
    total: 50_000,
    color: "from-emerald-500/20 to-emerald-600/10",
    border: "border-emerald-500/40",
    glow: "shadow-emerald-500/20",
    text: "text-emerald-400",
    badge: "bg-emerald-500/20 text-emerald-300",
    bar: "bg-emerald-500",
    icon: <Zap className="w-5 h-5" />,
    dbLevel: 5,
  },
];

const TOTAL_POTENTIAL = 61_725;

function fmt(n: number) {
  return n >= 1_000 ? n.toLocaleString() : String(n);
}

export default function ReferralsPage() {
  const [copied, setCopied] = useState(false);
  const { user, profile } = useAuth();

  const referralLink = profile?.referral_code
    ? `${window.location.origin}/register?ref=${profile.referral_code}`
    : "";

  // Count referrals at each depth level
  const { data: levelCounts = {} } = useQuery({
    queryKey: ["referral-level-counts", user?.id],
    queryFn: async () => {
      const counts: Record<number, number> = {};
      await Promise.all(
        [1, 2, 3, 4, 5].map(async (lvl) => {
          const { count } = await supabase
            .from("referrals")
            .select("*", { count: "exact", head: true })
            .eq("referrer_id", user!.id)
            .eq("level", lvl);
          counts[lvl] = count ?? 0;
        })
      );
      return counts;
    },
    enabled: !!user,
  });

  // Verified commissions at each level
  const { data: commissionsByLevel = {} } = useQuery({
    queryKey: ["commissions-by-level", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("referral_commissions")
        .select("level, commission_amount, referred_id")
        .eq("referrer_id", user!.id)
        .eq("status", "paid");
      const map: Record<number, { count: number; total: number }> = {};
      for (const row of data ?? []) {
        if (!map[row.level]) map[row.level] = { count: 0, total: 0 };
        map[row.level].count += 1;
        map[row.level].total += Number(row.commission_amount);
      }
      return map;
    },
    enabled: !!user,
  });

  // Direct referrals list (level 1 only, for the bottom section)
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

  // Verified direct IDs (level-1 paid commissions)
  const { data: verifiedDirectIds = new Set<string>() } = useQuery({
    queryKey: ["verified-direct-ids", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("referral_commissions")
        .select("referred_id")
        .eq("referrer_id", user!.id)
        .eq("level", 1)
        .eq("status", "paid");
      return new Set((data ?? []).map((r: any) => r.referred_id));
    },
    enabled: !!user,
  });

  const totalEarnings = Object.values(commissionsByLevel).reduce(
    (s, v) => s + v.total, 0
  );
  const verifiedCount = commissionsByLevel[1]?.count ?? 0;
  const pendingCount = (levelCounts[1] ?? 0) - verifiedCount;

  // Determine current VIP level achieved
  const currentVipLevel = VIP_LEVELS.reduce((max, lvl) => {
    const verified = commissionsByLevel[lvl.dbLevel]?.count ?? 0;
    return verified >= lvl.required ? lvl.level : max;
  }, 0);

  const copyLink = () => {
    navigator.clipboard.writeText(referralLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <DashboardLayout title="VIP Referral System">
      <div className="space-y-6 animate-fade-in max-w-5xl">

        {/* ── Hero Banner ─────────────────────────────────────────────────── */}
        <div className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-background to-blue-900/10 p-6 shadow-lg shadow-primary/10">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_hsl(43_74%_49%_/_0.08),_transparent_60%)] pointer-events-none" />
          <div className="relative flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <Star className="w-5 h-5 text-primary" />
                <span className="text-xs font-semibold uppercase tracking-widest text-primary">VIP Referral System</span>
              </div>
              <h2 className="font-display text-2xl font-bold text-foreground mb-1">
                Build Your Network.{" "}
                <span className="gold-gradient-text">Earn Up To $61,725</span>
              </h2>
              <p className="text-sm text-muted-foreground">
                5 levels · Commissions activated only after admin approves deposits
              </p>
            </div>
            <div className="flex flex-col items-center bg-primary/10 border border-primary/20 rounded-xl px-6 py-3 shrink-0">
              <span className="text-xs text-muted-foreground">Your VIP Level</span>
              <span className="text-4xl font-black gold-gradient-text leading-none mt-1">
                {currentVipLevel === 0 ? "—" : currentVipLevel}
              </span>
              <span className="text-xs text-primary mt-0.5">
                {currentVipLevel === 0 ? "Not reached yet" : `Level ${currentVipLevel} Active`}
              </span>
            </div>
          </div>
        </div>

        {/* ── Referral Link ────────────────────────────────────────────────── */}
        <div className="glass-card p-5 gold-glow">
          <div className="flex items-center gap-2 mb-3">
            <Globe className="w-4 h-4 text-primary" />
            <h3 className="font-semibold text-sm">Your Referral Link</h3>
            {profile?.referral_code && (
              <span className="ml-auto text-xs font-mono text-muted-foreground bg-secondary px-2 py-0.5 rounded">
                ID: {profile.referral_code}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-secondary rounded-lg px-4 py-2.5 text-xs font-mono text-foreground/80 border border-border truncate">
              {referralLink || "Loading..."}
            </div>
            <Button
              onClick={copyLink}
              size="sm"
              className="shrink-0 gap-1.5"
              disabled={!referralLink}
              data-testid="button-copy-referral"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "Copied!" : "Copy"}
            </Button>
          </div>
        </div>

        {/* ── Summary Stats ────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total Referred", value: fmt(levelCounts[1] ?? 0), color: "text-blue-400", icon: <Users className="w-4 h-4" /> },
            { label: "Verified", value: fmt(verifiedCount), color: "text-emerald-400", icon: <CheckCircle2 className="w-4 h-4" /> },
            { label: "Pending", value: fmt(pendingCount < 0 ? 0 : pendingCount), color: "text-amber-400", icon: <Clock className="w-4 h-4" /> },
            { label: "Total Earned", value: `$${totalEarnings.toFixed(2)}`, color: "gold-gradient-text", icon: <DollarSign className="w-4 h-4" /> },
          ].map(({ label, value, color, icon }) => (
            <div key={label} className="glass-card p-4 text-center">
              <div className={`flex justify-center mb-1.5 ${color}`}>{icon}</div>
              <p className={`text-xl font-bold ${color}`} data-testid={`stat-${label.toLowerCase().replace(/\s/g, "-")}`}>{value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        {/* ── VIP Level Cards ──────────────────────────────────────────────── */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-primary" />
            <h3 className="font-display font-semibold">Commission Levels</h3>
            <span className="ml-auto text-xs text-muted-foreground">
              Potential total: <span className="text-primary font-semibold">${TOTAL_POTENTIAL.toLocaleString()}</span>
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {VIP_LEVELS.map((lvl) => {
              const verified = commissionsByLevel[lvl.dbLevel]?.count ?? 0;
              const earned = commissionsByLevel[lvl.dbLevel]?.total ?? 0;
              const signups = levelCounts[lvl.dbLevel] ?? 0;
              const progress = Math.min(100, (verified / lvl.required) * 100);
              const isUnlocked = verified >= lvl.required;

              return (
                <div
                  key={lvl.level}
                  className={`relative overflow-hidden rounded-xl border ${lvl.border} bg-gradient-to-br ${lvl.color} p-5 shadow-lg ${lvl.glow} transition-transform hover:-translate-y-0.5`}
                  data-testid={`card-vip-level-${lvl.level}`}
                >
                  {/* Glow orb */}
                  <div className={`absolute -top-6 -right-6 w-24 h-24 rounded-full ${lvl.bar} opacity-10 blur-2xl pointer-events-none`} />

                  {/* Header */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className={`${lvl.text}`}>{lvl.icon}</span>
                      <span className={`text-sm font-bold ${lvl.text}`}>{lvl.label}</span>
                    </div>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${isUnlocked ? "bg-emerald-500/20 text-emerald-300" : lvl.badge}`}>
                      {isUnlocked ? "✓ Unlocked" : lvl.commission}
                    </span>
                  </div>

                  {/* Stats grid */}
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div className="bg-black/20 rounded-lg p-2.5">
                      <p className="text-xs text-muted-foreground">Required</p>
                      <p className="text-sm font-bold text-foreground">{fmt(lvl.required)} users</p>
                    </div>
                    <div className="bg-black/20 rounded-lg p-2.5">
                      <p className="text-xs text-muted-foreground">Per User</p>
                      <p className="text-sm font-bold text-foreground">${lvl.perUser.toFixed(2)}</p>
                    </div>
                    <div className="bg-black/20 rounded-lg p-2.5">
                      <p className="text-xs text-muted-foreground">Verified</p>
                      <p className={`text-sm font-bold ${lvl.text}`}>{fmt(verified)}</p>
                    </div>
                    <div className="bg-black/20 rounded-lg p-2.5">
                      <p className="text-xs text-muted-foreground">Earned</p>
                      <p className="text-sm font-bold text-emerald-400">${earned.toFixed(2)}</p>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{fmt(verified)} / {fmt(lvl.required)}</span>
                      <span>{progress.toFixed(1)}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-black/30 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${lvl.bar} transition-all duration-700`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>

                  {/* Potential total */}
                  <div className="mt-3 pt-3 border-t border-white/5 flex justify-between items-center">
                    <span className="text-xs text-muted-foreground">Max Potential</span>
                    <span className={`text-sm font-bold ${lvl.text}`}>${lvl.total.toLocaleString()}</span>
                  </div>

                  {/* Signed up (pending) note */}
                  {signups > verified && (
                    <div className="mt-2 text-xs text-amber-400/80 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {signups - verified} pending deposit approval
                    </div>
                  )}
                </div>
              );
            })}

            {/* Total Potential Card */}
            <div className="relative overflow-hidden rounded-xl border border-primary/40 bg-gradient-to-br from-primary/15 to-primary/5 p-5 shadow-lg shadow-primary/10 flex flex-col justify-between">
              <div className="absolute -bottom-8 -right-8 w-32 h-32 rounded-full bg-primary opacity-10 blur-3xl pointer-events-none" />
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <DollarSign className="w-5 h-5 text-primary" />
                  <span className="text-sm font-bold text-primary">Total Potential</span>
                </div>
                <p className="text-3xl font-black gold-gradient-text leading-none mb-1">
                  $61,725
                </p>
                <p className="text-xs text-muted-foreground">Across all 5 levels</p>
              </div>
              <div className="mt-4 space-y-1.5">
                {VIP_LEVELS.map((l) => (
                  <div key={l.level} className="flex justify-between text-xs">
                    <span className={`${l.text}`}>{l.label}</span>
                    <span className="text-muted-foreground">${l.total.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── How It Works ─────────────────────────────────────────────────── */}
        <div className="glass-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <Shield className="w-4 h-4 text-primary" />
            <h3 className="font-display font-semibold">How Commissions Are Activated</h3>
          </div>
          <div className="grid sm:grid-cols-4 gap-3">
            {[
              { step: "1", title: "Sign Up", desc: "Referral registers via your link", icon: <Users className="w-4 h-4" /> },
              { step: "2", title: "Deposit", desc: "They make a deposit on the platform", icon: <DollarSign className="w-4 h-4" /> },
              { step: "3", title: "Upload Proof", desc: "They upload payment proof", icon: <CheckCircle2 className="w-4 h-4" /> },
              { step: "4", title: "Admin Approves", desc: "Commission credited to your balance", icon: <Zap className="w-4 h-4" /> },
            ].map(({ step, title, desc, icon }) => (
              <div key={step} className="relative flex flex-col items-center text-center p-4 rounded-xl bg-secondary/30 border border-border/50">
                <div className="w-9 h-9 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-primary mb-2">
                  {icon}
                </div>
                <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">
                  {step}
                </span>
                <p className="text-sm font-semibold mb-0.5">{title}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-2">
            <Shield className="w-4 h-4 text-emerald-400 shrink-0" />
            <p className="text-xs text-emerald-300">
              <span className="font-semibold">Anti-Fraud:</span> Self-referrals are blocked. Each user can only be referred once. Commissions are verified by admin before being credited.
            </p>
          </div>
        </div>

        {/* ── Direct Referrals List ─────────────────────────────────────────── */}
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display font-semibold">Direct Referrals (Level 1)</h3>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1 text-emerald-400">
                <CheckCircle2 className="w-3 h-3" /> Verified
              </span>
              <span className="flex items-center gap-1 text-amber-400">
                <Clock className="w-3 h-3" /> Pending
              </span>
            </div>
          </div>

          {directReferrals.length === 0 ? (
            <div className="flex flex-col items-center py-10 text-center">
              <Users className="w-10 h-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">No referrals yet — share your link to start earning!</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {directReferrals.map((ref: any, i: number) => {
                const isVerified = verifiedDirectIds.has(ref.referred_id);
                return (
                  <div
                    key={ref.referred_id}
                    className="flex items-center justify-between py-2.5 px-3 rounded-lg border border-border/50 hover:bg-secondary/20 transition-colors"
                    data-testid={`row-referral-${ref.referred_id}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
                        <span className="text-xs font-bold text-primary">#{i + 1}</span>
                      </div>
                      <div>
                        <p className="text-sm font-medium">Referral #{i + 1}</p>
                        <p className="text-xs text-muted-foreground">
                          Joined {new Date(ref.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {isVerified ? (
                        <>
                          <span className="flex items-center gap-1 text-xs text-emerald-400 font-medium">
                            <CheckCircle2 className="w-3 h-3" /> Verified
                          </span>
                          <span className="text-sm font-bold gold-gradient-text">+$2.50</span>
                        </>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-amber-400 font-medium">
                          <Clock className="w-3 h-3" /> Awaiting deposit approval
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {totalEarnings > 0 && (
            <div className="flex items-center justify-between pt-4 border-t border-border mt-4">
              <span className="text-sm font-semibold flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-primary" /> Total Referral Earnings
              </span>
              <span className="text-xl font-black gold-gradient-text" data-testid="text-grand-total">
                ${totalEarnings.toFixed(2)}
              </span>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

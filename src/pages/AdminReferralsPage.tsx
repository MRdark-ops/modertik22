import { DashboardLayout } from "@/components/DashboardLayout";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export default function AdminReferralsPage() {
  const { data: referralData } = useQuery({
    queryKey: ["admin-referrals"],
    queryFn: async () => {
      // Get all profiles
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name");

      // Get referrals
      const { data: referrals } = await supabase
        .from("referrals")
        .select("referrer_id, referred_id, level");

      // Get commissions
      const { data: commissions } = await supabase
        .from("referral_commissions")
        .select("referrer_id, commission_amount");

      if (!profiles) return [];

      const nameMap: Record<string, string> = {};
      profiles.forEach((p) => { nameMap[p.user_id] = p.full_name; });

      const directRefs: Record<string, number> = {};
      const totalNetwork: Record<string, number> = {};
      referrals?.forEach((r) => {
        if (r.level === 1) directRefs[r.referrer_id] = (directRefs[r.referrer_id] || 0) + 1;
        totalNetwork[r.referrer_id] = (totalNetwork[r.referrer_id] || 0) + 1;
      });

      const totalCommission: Record<string, number> = {};
      commissions?.forEach((c) => {
        totalCommission[c.referrer_id] = (totalCommission[c.referrer_id] || 0) + Number(c.commission_amount);
      });

      // Only show users that have referrals
      const referrers = new Set([...(referrals?.map((r) => r.referrer_id) ?? [])]);
      return Array.from(referrers).map((uid) => ({
        user: nameMap[uid] || "Unknown",
        directRefs: directRefs[uid] || 0,
        totalNetwork: totalNetwork[uid] || 0,
        totalCommission: totalCommission[uid] || 0,
      })).sort((a, b) => b.directRefs - a.directRefs);
    },
  });

  return (
    <DashboardLayout isAdmin title="Referral Monitoring">
      <div className="space-y-6 animate-fade-in">
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/30">
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">User</th>
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">Direct Referrals</th>
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">Total Network</th>
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">Total Commission</th>
                </tr>
              </thead>
              <tbody>
                {referralData?.map((r, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-secondary/20 transition-colors">
                    <td className="py-3 px-4 font-medium">{r.user}</td>
                    <td className="py-3 px-4">{r.directRefs}</td>
                    <td className="py-3 px-4">{r.totalNetwork}</td>
                    <td className="py-3 px-4 font-semibold gold-gradient-text">${r.totalCommission.toFixed(2)}</td>
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

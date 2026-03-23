import { DashboardLayout } from "@/components/DashboardLayout";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export default function AdminReferralsPage() {
  const { data: referralData } = useQuery({
    queryKey: ["admin-referrals"],
    queryFn: async () => {
      const [profilesRes, referralsRes, commissionsRes] = await Promise.all([
        supabase.from("profiles").select("user_id, full_name"),
        supabase.from("referrals").select("referrer_id, referred_id, level"),
        supabase
          .from("referral_commissions")
          .select("referrer_id, commission_amount, level, status")
          .eq("status", "paid"),
      ]);

      const profiles = profilesRes.data || [];
      const referrals = referralsRes.data || [];
      const commissions = commissionsRes.data || [];

      const nameMap: Record<string, string> = {};
      profiles.forEach((p) => {
        nameMap[p.user_id] = p.full_name || "Unknown";
      });

      const directRefs: Record<string, number> = {};
      const verifiedRefs: Record<string, number> = {};
      const totalNetwork: Record<string, number> = {};

      referrals.forEach((r) => {
        if (r.level === 1) {
          directRefs[r.referrer_id] = (directRefs[r.referrer_id] || 0) + 1;
        }
        totalNetwork[r.referrer_id] = (totalNetwork[r.referrer_id] || 0) + 1;
      });

      const directEarnings: Record<string, number> = {};
      const indirectEarnings: Record<string, number> = {};

      commissions.forEach((c) => {
        if (c.level === 1) {
          directEarnings[c.referrer_id] =
            (directEarnings[c.referrer_id] || 0) + Number(c.commission_amount);
          verifiedRefs[c.referrer_id] = (verifiedRefs[c.referrer_id] || 0) + 1;
        } else if (c.level === 2) {
          indirectEarnings[c.referrer_id] =
            (indirectEarnings[c.referrer_id] || 0) + Number(c.commission_amount);
        }
      });

      const referrers = new Set([
        ...referrals.map((r) => r.referrer_id),
        ...commissions.map((c) => c.referrer_id),
      ]);

      return Array.from(referrers)
        .map((uid) => ({
          uid,
          user: nameMap[uid] || "Unknown",
          directRefs: directRefs[uid] || 0,
          verifiedRefs: verifiedRefs[uid] || 0,
          totalNetwork: totalNetwork[uid] || 0,
          directEarnings: directEarnings[uid] || 0,
          indirectEarnings: indirectEarnings[uid] || 0,
          totalEarnings:
            (directEarnings[uid] || 0) + (indirectEarnings[uid] || 0),
        }))
        .sort((a, b) => b.totalEarnings - a.totalEarnings);
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
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">Signed Up</th>
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">Verified</th>
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">Network</th>
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">Direct ($)</th>
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">Indirect ($)</th>
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">Total ($)</th>
                </tr>
              </thead>
              <tbody>
                {referralData?.map((r, i) => (
                  <tr
                    key={r.uid}
                    className="border-b border-border/50 hover:bg-secondary/20 transition-colors"
                    data-testid={`row-admin-referral-${i}`}
                  >
                    <td className="py-3 px-4 font-medium">{r.user}</td>
                    <td className="py-3 px-4 text-muted-foreground">{r.directRefs}</td>
                    <td className="py-3 px-4 text-green-500 font-medium">{r.verifiedRefs}</td>
                    <td className="py-3 px-4 text-muted-foreground">{r.totalNetwork}</td>
                    <td className="py-3 px-4">${r.directEarnings.toFixed(2)}</td>
                    <td className="py-3 px-4">${r.indirectEarnings.toFixed(2)}</td>
                    <td className="py-3 px-4 font-semibold gold-gradient-text">
                      ${r.totalEarnings.toFixed(2)}
                    </td>
                  </tr>
                ))}
                {(!referralData || referralData.length === 0) && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-muted-foreground text-sm">
                      No referral data yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

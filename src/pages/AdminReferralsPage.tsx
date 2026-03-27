import { DashboardLayout } from "@/components/DashboardLayout";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export default function AdminReferralsPage() {
  const { data: referralData } = useQuery({
    queryKey: ["admin-referrals"],
    queryFn: async () => {
      // TODO: Create getReferralStats or similar endpoint in API
      // For now, returning empty array
      return [];
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

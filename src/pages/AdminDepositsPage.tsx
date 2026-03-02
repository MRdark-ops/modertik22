import { DashboardLayout } from "@/components/DashboardLayout";
import { StatusBadge } from "@/components/StatusBadge";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export default function AdminDepositsPage() {
  const queryClient = useQueryClient();

  const { data: deposits } = useQuery({
    queryKey: ["admin-deposits"],
    queryFn: async () => {
      const { data } = await supabase
        .from("deposits")
        .select("id, amount, status, created_at, proof_url, user_id, profiles!inner(full_name)")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const handleAction = async (depositId: string, action: "approve" | "reject") => {
    const { error } = await supabase.functions.invoke("approve-deposit", {
      body: { deposit_id: depositId, action, admin_note: "" },
    });
    if (error) toast.error("Failed to process deposit");
    else {
      toast.success(`Deposit ${action}d`);
      queryClient.invalidateQueries({ queryKey: ["admin-deposits"] });
    }
  };

  return (
    <DashboardLayout isAdmin title="Deposit Management">
      <div className="space-y-6 animate-fade-in">
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/30">
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">User</th>
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">Amount</th>
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">Proof</th>
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">Date</th>
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">Status</th>
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {deposits?.map((d: any) => (
                  <tr key={d.id} className="border-b border-border/50 hover:bg-secondary/20 transition-colors">
                    <td className="py-3 px-4 font-medium">{d.profiles?.full_name}</td>
                    <td className="py-3 px-4 font-semibold">${Number(d.amount).toFixed(2)}</td>
                    <td className="py-3 px-4 text-primary text-xs underline cursor-pointer">{d.proof_url ? "View" : "-"}</td>
                    <td className="py-3 px-4 text-muted-foreground">{new Date(d.created_at).toLocaleDateString()}</td>
                    <td className="py-3 px-4"><StatusBadge status={d.status as any} /></td>
                    <td className="py-3 px-4">
                      {d.status === "pending" && (
                        <div className="flex gap-1">
                          <button onClick={() => handleAction(d.id, "approve")} className="px-2 py-1 text-xs rounded bg-success/10 text-success border border-success/20 hover:bg-success/20">Approve</button>
                          <button onClick={() => handleAction(d.id, "reject")} className="px-2 py-1 text-xs rounded bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/20">Reject</button>
                        </div>
                      )}
                    </td>
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

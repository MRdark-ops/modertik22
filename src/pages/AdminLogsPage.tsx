import { DashboardLayout } from "@/components/DashboardLayout";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export default function AdminLogsPage() {
  const { data: logs } = useQuery({
    queryKey: ["admin-logs"],
    queryFn: async () => {
      return await api.getAdminLogs(50);
    },
  });

  return (
    <DashboardLayout isAdmin title="Activity Logs">
      <div className="space-y-6 animate-fade-in">
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/30">
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">User</th>
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">Action</th>
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">Date & Time</th>
                </tr>
              </thead>
              <tbody>
                {logs?.map((log: any) => (
                  <tr key={log.id} className="border-b border-border/50 hover:bg-secondary/20 transition-colors">
                    <td className="py-3 px-4 font-medium">{log.full_name}</td>
                    <td className="py-3 px-4">
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        log.action.includes('rejected') || log.action.includes('failed') ? 'bg-destructive/10 text-destructive' :
                        log.action.includes('approved') ? 'bg-success/10 text-success' :
                        'bg-secondary text-foreground'
                      }`}>{log.action.replace(/_/g, " ")}</span>
                    </td>
                    <td className="py-3 px-4 text-muted-foreground">{new Date(log.created_at).toLocaleString()}</td>
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

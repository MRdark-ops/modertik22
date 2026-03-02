import { 
  LayoutDashboard, Wallet, ArrowDownToLine, ArrowUpFromLine, 
  Users, Shield, UserCog, FileText, Activity, LogOut, TrendingUp
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
} from "@/components/ui/sidebar";

const userItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Deposit", url: "/deposit", icon: ArrowDownToLine },
  { title: "Withdraw", url: "/withdraw", icon: ArrowUpFromLine },
  { title: "Referrals", url: "/referrals", icon: Users },
  { title: "Security", url: "/security", icon: Shield },
];

const adminItems = [
  { title: "Overview", url: "/admin", icon: LayoutDashboard },
  { title: "Users", url: "/admin/users", icon: UserCog },
  { title: "Deposits", url: "/admin/deposits", icon: ArrowDownToLine },
  { title: "Withdrawals", url: "/admin/withdrawals", icon: ArrowUpFromLine },
  { title: "Referrals", url: "/admin/referrals", icon: Users },
  { title: "Activity Logs", url: "/admin/logs", icon: Activity },
];

interface DashboardSidebarProps {
  isAdmin?: boolean;
}

export function DashboardSidebar({ isAdmin = false }: DashboardSidebarProps) {
  const items = isAdmin ? adminItems : userItems;
  const label = isAdmin ? "Admin Panel" : "Trading";
  const { signOut } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await signOut();
    navigate("/login");
  };

  return (
    <Sidebar className="border-r border-border bg-sidebar">
      <div className="p-4 flex items-center gap-3 border-b border-border">
        <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
          <TrendingUp className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h2 className="font-display text-lg font-bold gold-gradient-text">Global Trading</h2>
          <p className="text-xs text-muted-foreground">{isAdmin ? "Admin" : "Platform"}</p>
        </div>
      </div>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-muted-foreground text-xs uppercase tracking-wider">{label}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === "/dashboard" || item.url === "/admin"}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
                      activeClassName="bg-primary/10 text-primary border border-primary/20"
                    >
                      <item.icon className="w-4 h-4" />
                      <span className="text-sm font-medium">{item.title}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-auto pb-4">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-destructive hover:bg-destructive/10 transition-colors w-full"
                  >
                    <LogOut className="w-4 h-4" />
                    <span className="text-sm font-medium">Logout</span>
                  </button>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}

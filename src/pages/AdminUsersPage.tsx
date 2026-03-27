import { DashboardLayout } from "@/components/DashboardLayout";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Search, ShieldCheck, ShieldOff, Trash2, Users,
  CheckCircle2, Clock, DollarSign, TrendingUp, ArrowRight,
} from "lucide-react";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { toast } from "sonner";

const LEVEL_COLORS: Record<number, { text: string; bg: string; border: string; label: string }> = {
  2: { text: "text-violet-400", bg: "bg-violet-500/10", border: "border-violet-500/20", label: "Level 2" },
  3: { text: "text-amber-400",  bg: "bg-amber-500/10",  border: "border-amber-500/20",  label: "Level 3" },
  4: { text: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/20", label: "Level 4" },
  5: { text: "text-emerald-400",bg: "bg-emerald-500/10",border: "border-emerald-500/20",label: "Level 5" },
};

type DirectReferral = {
  user_id: string;
  full_name: string;
  joined_at: string;
  is_verified: boolean;
};

type IndirectReferral = {
  id: string;
  referred_id: string;
  full_name: string;
  level: number;
  commission_amount: number;
  created_at: string;
};

export default function AdminUsersPage() {
  const [search, setSearch] = useState("");
  const [selectedUser, setSelectedUser] = useState<{ id: string; name: string } | null>(null);
  const [activeTab, setActiveTab] = useState<"direct" | "indirect">("direct");
  const queryClient = useQueryClient();

  // ── Users list ─────────────────────────────────────────────────────────────
  const { data: users } = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => {
      return await api.getAdminUsers();
    },
  });

  // ── Direct referrals (Level 1) ──────────────────────────────────────────────
  const { data: directReferrals = [], isLoading: directLoading } = useQuery({
    queryKey: ["admin-direct-referrals", selectedUser?.id],
    queryFn: async () => {
      // Get all users whose referred_by = selectedUser.id
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, created_at")
        .eq("referred_by", selectedUser!.id)
        .order("created_at", { ascending: false });
      if (!profiles || profiles.length === 0) return [];

      const referredIds = profiles.map((p) => p.user_id);

      // Check which ones have paid commissions (deposit approved)
      const { data: commissions } = await supabase
        .from("referral_commissions")
        .select("referred_id")
        .in("referred_id", referredIds)
        .eq("referrer_id", selectedUser!.id)
        .eq("level", 1)
        .eq("status", "paid");

      const verifiedSet = new Set((commissions ?? []).map((c) => c.referred_id));

      return profiles.map((p): DirectReferral => ({
        user_id: p.user_id,
        full_name: p.full_name || "—",
        joined_at: p.created_at,
        is_verified: verifiedSet.has(p.user_id),
      }));
    },
    enabled: !!selectedUser,
  });

  // ── Indirect referrals (Levels 2-5) ─────────────────────────────────────────
  const { data: indirectReferrals = [], isLoading: indirectLoading } = useQuery({
    queryKey: ["admin-indirect-referrals", selectedUser?.id],
    queryFn: async () => {
      const { data: commissions } = await supabase
        .from("referral_commissions")
        .select("id, referred_id, level, commission_amount, created_at")
        .eq("referrer_id", selectedUser!.id)
        .in("level", [2, 3, 4, 5])
        .eq("status", "paid")
        .order("created_at", { ascending: false });
      if (!commissions || commissions.length === 0) return [];

      const referredIds = [...new Set(commissions.map((c) => c.referred_id))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", referredIds);

      const nameMap = new Map((profiles ?? []).map((p) => [p.user_id, p.full_name]));

      return commissions.map((c): IndirectReferral => ({
        id: c.id,
        referred_id: c.referred_id,
        full_name: nameMap.get(c.referred_id) || "—",
        level: c.level,
        commission_amount: Number(c.commission_amount),
        created_at: c.created_at,
      }));
    },
    enabled: !!selectedUser,
  });

  // ── User actions ────────────────────────────────────────────────────────────
  const handleUserAction = async (userId: string, action: "promote" | "demote" | "delete") => {
    const confirmMsg =
      action === "delete" ? "Are you sure you want to delete this user?"
      : action === "promote" ? "Do you want to promote this user to admin?"
      : "Do you want to demote this user from admin?";
    if (!confirm(confirmMsg)) return;

    try {
      if (action === "promote") {
        await api.promoteUserToAdmin(userId);
      } else if (action === "demote") {
        await api.demoteAdminToUser(userId);
      } else {
        throw new Error("User deletion not yet implemented in API");
      }
      
      const msgs = { promote: "User promoted successfully", demote: "User demoted successfully", delete: "User deleted" };
      toast.success(msgs[action]);
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    } catch (err: any) {
      toast.error(err.message || "Action failed");
    }
  };

  const openDialog = (user: { user_id: string; full_name: string }) => {
    setSelectedUser({ id: user.user_id, name: user.full_name || "User" });
    setActiveTab("direct");
  };

  const filtered = (users ?? []).filter(
    (u) =>
      u.full_name.toLowerCase().includes(search.toLowerCase()) ||
      u.referral_code.toLowerCase().includes(search.toLowerCase())
  );

  // ── Stats for dialog ────────────────────────────────────────────────────────
  const directVerified = directReferrals.filter((r) => r.is_verified).length;
  const directPending  = directReferrals.filter((r) => !r.is_verified).length;
  const indirectTotal  = indirectReferrals.length;
  const indirectEarned = indirectReferrals.reduce((s, r) => s + r.commission_amount, 0);

  // Group indirect by level
  const indirectByLevel = indirectReferrals.reduce<Record<number, IndirectReferral[]>>((acc, r) => {
    if (!acc[r.level]) acc[r.level] = [];
    acc[r.level].push(r);
    return acc;
  }, {});

  return (
    <DashboardLayout isAdmin title="User Management">
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search users..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-secondary border-border focus:border-primary h-10"
              data-testid="input-search-users"
            />
          </div>
          <span className="text-sm text-muted-foreground">{filtered.length} users</span>
        </div>

        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/30">
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">User</th>
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">Balance</th>
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">Referrals</th>
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">Joined</th>
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">Role</th>
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr key={u.id} className="border-b border-border/50 hover:bg-secondary/20 transition-colors" data-testid={`row-user-${u.user_id}`}>
                    <td className="py-3 px-4">
                      <p className="font-medium">{u.full_name || "Unnamed"}</p>
                      <p className="text-xs text-muted-foreground">{u.referral_code}</p>
                    </td>
                    <td className="py-3 px-4 font-semibold">${Number(u.balance).toFixed(2)}</td>
                    <td className="py-3 px-4">{u.referrals}</td>
                    <td className="py-3 px-4 text-muted-foreground">{new Date(u.created_at).toLocaleDateString()}</td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        u.role === "admin"
                          ? "bg-primary/10 text-primary border border-primary/20"
                          : "bg-secondary text-muted-foreground border border-border"
                      }`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex gap-1 flex-wrap">
                        <button
                          onClick={() => openDialog(u)}
                          className="px-2 py-1 text-xs rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 flex items-center gap-1"
                          data-testid={`button-view-referrals-${u.user_id}`}
                        >
                          <Users className="w-3 h-3" /> View
                        </button>
                        {u.role === "user" ? (
                          <button onClick={() => handleUserAction(u.user_id, "promote")}
                            className="px-2 py-1 text-xs rounded bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 flex items-center gap-1"
                            data-testid={`button-promote-${u.user_id}`}>
                            <ShieldCheck className="w-3 h-3" /> Promote
                          </button>
                        ) : (
                          <button onClick={() => handleUserAction(u.user_id, "demote")}
                            className="px-2 py-1 text-xs rounded bg-warning/10 text-warning border border-warning/20 hover:bg-warning/20 flex items-center gap-1"
                            data-testid={`button-demote-${u.user_id}`}>
                            <ShieldOff className="w-3 h-3" /> Demote
                          </button>
                        )}
                        <button onClick={() => handleUserAction(u.user_id, "delete")}
                          className="px-2 py-1 text-xs rounded bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/20 flex items-center gap-1"
                          data-testid={`button-delete-${u.user_id}`}>
                          <Trash2 className="w-3 h-3" /> Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── Referrals Detail Dialog ────────────────────────────────────────── */}
      <Dialog open={!!selectedUser} onOpenChange={(open) => { if (!open) setSelectedUser(null); }}>
        <DialogContent className="max-w-2xl bg-card border-border max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Users className="w-5 h-5 text-primary" />
              Referral Tree — {selectedUser?.name}
            </DialogTitle>
          </DialogHeader>

          {/* Summary cards */}
          <div className="grid grid-cols-4 gap-2 shrink-0">
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-center">
              <p className="text-lg font-bold text-blue-400">{directReferrals.length}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Direct Total</p>
            </div>
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 text-center">
              <p className="text-lg font-bold text-emerald-400">{directVerified}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Verified</p>
            </div>
            <div className="bg-violet-500/10 border border-violet-500/20 rounded-lg p-3 text-center">
              <p className="text-lg font-bold text-violet-400">{indirectTotal}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Indirect Total</p>
            </div>
            <div className="bg-primary/10 border border-primary/20 rounded-lg p-3 text-center">
              <p className="text-lg font-bold text-primary">${indirectEarned.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Indirect Earned</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 bg-secondary/50 p-1 rounded-lg shrink-0">
            <button
              onClick={() => setActiveTab("direct")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 text-xs font-medium rounded-md transition-all ${
                activeTab === "direct"
                  ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid="tab-direct"
            >
              <ArrowRight className="w-3 h-3" />
              Direct Referrals (L1)
              <span className={`ml-1 px-1.5 py-0.5 rounded-full text-xs ${activeTab === "direct" ? "bg-blue-500/30" : "bg-secondary"}`}>
                {directReferrals.length}
              </span>
            </button>
            <button
              onClick={() => setActiveTab("indirect")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 text-xs font-medium rounded-md transition-all ${
                activeTab === "indirect"
                  ? "bg-violet-500/20 text-violet-400 border border-violet-500/30"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid="tab-indirect"
            >
              <TrendingUp className="w-3 h-3" />
              Indirect Referrals (L2-L5)
              <span className={`ml-1 px-1.5 py-0.5 rounded-full text-xs ${activeTab === "indirect" ? "bg-violet-500/30" : "bg-secondary"}`}>
                {indirectTotal}
              </span>
            </button>
          </div>

          {/* Content area */}
          <div className="overflow-y-auto flex-1 min-h-0 rounded-lg border border-border">

            {/* ── DIRECT TAB ── */}
            {activeTab === "direct" && (
              directLoading ? (
                <div className="py-10 text-center text-muted-foreground text-sm animate-pulse">Loading...</div>
              ) : directReferrals.length === 0 ? (
                <div className="py-10 text-center text-muted-foreground text-sm">No direct referrals yet</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card z-10">
                    <tr className="border-b border-border bg-secondary/30">
                      <th className="text-left py-2.5 px-4 text-muted-foreground font-medium">#</th>
                      <th className="text-left py-2.5 px-4 text-muted-foreground font-medium">Name</th>
                      <th className="text-left py-2.5 px-4 text-muted-foreground font-medium">Joined</th>
                      <th className="text-left py-2.5 px-4 text-muted-foreground font-medium">Commission</th>
                      <th className="text-left py-2.5 px-4 text-muted-foreground font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {directReferrals.map((r, i) => (
                      <tr key={r.user_id} className="border-b border-border/50 hover:bg-secondary/20 transition-colors" data-testid={`row-direct-${r.user_id}`}>
                        <td className="py-2.5 px-4 text-muted-foreground">#{i + 1}</td>
                        <td className="py-2.5 px-4 font-medium">{r.full_name}</td>
                        <td className="py-2.5 px-4 text-muted-foreground text-xs">
                          {new Date(r.joined_at).toLocaleDateString()}
                        </td>
                        <td className="py-2.5 px-4">
                          {r.is_verified ? (
                            <span className="text-emerald-400 font-semibold text-xs flex items-center gap-1">
                              <DollarSign className="w-3 h-3" /> $2.50
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-4">
                          {r.is_verified ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                              <CheckCircle2 className="w-3 h-3" /> Verified
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
                              <Clock className="w-3 h-3" /> Pending
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border bg-secondary/20">
                      <td colSpan={2} className="py-2.5 px-4 text-xs text-muted-foreground">
                        {directVerified} verified · {directPending} pending
                      </td>
                      <td colSpan={3} className="py-2.5 px-4 text-right">
                        <span className="text-sm font-bold text-emerald-400">
                          Total: ${(directVerified * 2.50).toFixed(2)}
                        </span>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )
            )}

            {/* ── INDIRECT TAB ── */}
            {activeTab === "indirect" && (
              indirectLoading ? (
                <div className="py-10 text-center text-muted-foreground text-sm animate-pulse">Loading...</div>
              ) : indirectReferrals.length === 0 ? (
                <div className="py-10 text-center text-muted-foreground text-sm">
                  No indirect commissions yet — earned when downline members get deposits approved
                </div>
              ) : (
                <div className="divide-y divide-border/50">
                  {[2, 3, 4, 5].map((lvl) => {
                    const rows = indirectByLevel[lvl];
                    if (!rows || rows.length === 0) return null;
                    const clr = LEVEL_COLORS[lvl];
                    const lvlTotal = rows.reduce((s, r) => s + r.commission_amount, 0);
                    return (
                      <div key={lvl}>
                        {/* Level header */}
                        <div className={`flex items-center justify-between px-4 py-2 ${clr.bg} border-b ${clr.border}`}>
                          <span className={`text-xs font-bold ${clr.text} flex items-center gap-1.5`}>
                            <TrendingUp className="w-3 h-3" />
                            {clr.label} — Indirect Referrals
                          </span>
                          <span className={`text-xs font-semibold ${clr.text}`}>
                            {rows.length} users · ${lvlTotal.toFixed(2)} earned
                          </span>
                        </div>
                        {/* Level rows */}
                        <table className="w-full text-sm">
                          <tbody>
                            {rows.map((r, i) => (
                              <tr key={r.id} className="border-b border-border/30 hover:bg-secondary/20 transition-colors" data-testid={`row-indirect-${r.id}`}>
                                <td className="py-2 px-4 text-muted-foreground text-xs w-8">#{i + 1}</td>
                                <td className="py-2 px-4 font-medium text-xs">{r.full_name}</td>
                                <td className="py-2 px-4 text-muted-foreground text-xs">
                                  {new Date(r.created_at).toLocaleDateString()}
                                </td>
                                <td className="py-2 px-4 text-right">
                                  <span className={`text-xs font-bold ${clr.text} flex items-center justify-end gap-1`}>
                                    <DollarSign className="w-3 h-3" />
                                    ${r.commission_amount.toFixed(2)}
                                  </span>
                                </td>
                                <td className="py-2 px-4">
                                  <span className={`inline-flex items-center gap-1 text-xs font-medium ${clr.text} ${clr.bg} border ${clr.border} px-2 py-0.5 rounded-full`}>
                                    <CheckCircle2 className="w-3 h-3" /> Paid
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })}
                  {/* Grand total */}
                  <div className="flex items-center justify-between px-4 py-3 bg-secondary/20">
                    <span className="text-xs text-muted-foreground">Total indirect commissions</span>
                    <span className="text-sm font-black text-primary">${indirectEarned.toFixed(2)}</span>
                  </div>
                </div>
              )
            )}
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

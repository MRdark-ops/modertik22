import { DashboardLayout } from "@/components/DashboardLayout";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Search, ShieldCheck, ShieldOff, Trash2, Users, CheckCircle2, Clock } from "lucide-react";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type ReferredUser = {
  user_id: string;
  full_name: string;
  email: string;
  joined_at: string;
  is_verified: boolean;
};

export default function AdminUsersPage() {
  const [search, setSearch] = useState("");
  const [selectedUser, setSelectedUser] = useState<{ id: string; name: string } | null>(null);
  const queryClient = useQueryClient();

  const { data: users } = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, user_id, full_name, balance, referral_code, created_at")
        .order("created_at", { ascending: false });

      if (!profiles) return [];

      const { data: referrals } = await supabase
        .from("referrals")
        .select("referrer_id, level")
        .eq("level", 1);

      const refCounts: Record<string, number> = {};
      referrals?.forEach((r) => {
        refCounts[r.referrer_id] = (refCounts[r.referrer_id] || 0) + 1;
      });

      const { data: roles } = await supabase.from("user_roles").select("user_id, role");
      const roleMap: Record<string, string> = {};
      roles?.forEach((r) => { roleMap[r.user_id] = r.role; });

      return profiles.map((p) => ({
        ...p,
        referrals: refCounts[p.user_id] || 0,
        role: roleMap[p.user_id] || "user",
      }));
    },
  });

  // Fetch referrals for the selected user
  // Tries the edge function first (gets emails); falls back to direct table queries
  const { data: referredUsers = [], isLoading: referralsLoading } = useQuery({
    queryKey: ["user-referrals", selectedUser?.id],
    queryFn: async () => {
      // ── Attempt 1: edge function (returns emails too) ──────────────────
      const { data: fnData, error: fnError } = await supabase.functions.invoke(
        "get-user-referrals",
        { body: { referrer_user_id: selectedUser!.id } }
      );
      if (!fnError && Array.isArray(fnData)) {
        return fnData as ReferredUser[];
      }

      // ── Fallback: direct table queries (no email) ──────────────────────
      const { data: referrals, error: refErr } = await supabase
        .from("referrals")
        .select("referred_id, created_at")
        .eq("referrer_id", selectedUser!.id)
        .eq("level", 1)
        .order("created_at", { ascending: false });

      if (refErr) {
        toast.error("فشل تحميل الإحالات");
        return [];
      }
      if (!referrals || referrals.length === 0) return [];

      const referredIds = referrals.map((r) => r.referred_id);

      const [profilesRes, commissionsRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("user_id, full_name, created_at")
          .in("user_id", referredIds),
        supabase
          .from("referral_commissions")
          .select("referred_id")
          .in("referred_id", referredIds)
          .eq("level", 1)
          .eq("status", "paid"),
      ]);

      const profileMap = new Map(
        (profilesRes.data ?? []).map((p) => [p.user_id, p])
      );
      const verifiedSet = new Set(
        (commissionsRes.data ?? []).map((c) => c.referred_id)
      );

      return referrals.map((r) => ({
        user_id: r.referred_id,
        full_name: profileMap.get(r.referred_id)?.full_name ?? "",
        email: "",
        joined_at: profileMap.get(r.referred_id)?.created_at ?? r.created_at,
        is_verified: verifiedSet.has(r.referred_id),
      })) as ReferredUser[];
    },
    enabled: !!selectedUser,
  });

  const handleUserAction = async (userId: string, action: "promote" | "demote" | "delete") => {
    const confirmMsg =
      action === "delete"
        ? "هل أنت متأكد من حذف هذا المستخدم؟"
        : action === "promote"
        ? "هل تريد ترقية هذا المستخدم إلى أدمن؟"
        : "هل تريد تخفيض هذا المستخدم من أدمن؟";

    if (!confirm(confirmMsg)) return;

    const { error } = await supabase.functions.invoke("manage-user-role", {
      body: { target_user_id: userId, action },
    });

    if (error) {
      toast.error("فشلت العملية");
    } else {
      const msgs = { promote: "تمت الترقية بنجاح", demote: "تم التخفيض بنجاح", delete: "تم حذف المستخدم" };
      toast.success(msgs[action]);
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    }
  };

  const filtered = (users ?? []).filter(
    (u) =>
      u.full_name.toLowerCase().includes(search.toLowerCase()) ||
      u.referral_code.toLowerCase().includes(search.toLowerCase())
  );

  const verifiedCount = referredUsers.filter((r) => r.is_verified).length;
  const pendingCount = referredUsers.filter((r) => !r.is_verified).length;
  const hasEmails = referredUsers.some((r) => r.email);

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
                  <tr
                    key={u.id}
                    className="border-b border-border/50 hover:bg-secondary/20 transition-colors"
                    data-testid={`row-user-${u.user_id}`}
                  >
                    <td className="py-3 px-4">
                      <p className="font-medium">{u.full_name || "Unnamed"}</p>
                      <p className="text-xs text-muted-foreground">{u.referral_code}</p>
                    </td>
                    <td className="py-3 px-4 font-semibold">${Number(u.balance).toFixed(2)}</td>
                    <td className="py-3 px-4">{u.referrals}</td>
                    <td className="py-3 px-4 text-muted-foreground">
                      {new Date(u.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          u.role === "admin"
                            ? "bg-primary/10 text-primary border border-primary/20"
                            : "bg-secondary text-muted-foreground border border-border"
                        }`}
                      >
                        {u.role}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex gap-1 flex-wrap">
                        {u.referrals > 0 && (
                          <button
                            onClick={() =>
                              setSelectedUser({ id: u.user_id, name: u.full_name || "User" })
                            }
                            className="px-2 py-1 text-xs rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 flex items-center gap-1"
                            data-testid={`button-view-referrals-${u.user_id}`}
                          >
                            <Users className="w-3 h-3" /> View
                          </button>
                        )}
                        {u.role === "user" ? (
                          <button
                            onClick={() => handleUserAction(u.user_id, "promote")}
                            className="px-2 py-1 text-xs rounded bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 flex items-center gap-1"
                            data-testid={`button-promote-${u.user_id}`}
                          >
                            <ShieldCheck className="w-3 h-3" /> Promote
                          </button>
                        ) : (
                          <button
                            onClick={() => handleUserAction(u.user_id, "demote")}
                            className="px-2 py-1 text-xs rounded bg-warning/10 text-warning border border-warning/20 hover:bg-warning/20 flex items-center gap-1"
                            data-testid={`button-demote-${u.user_id}`}
                          >
                            <ShieldOff className="w-3 h-3" /> Demote
                          </button>
                        )}
                        <button
                          onClick={() => handleUserAction(u.user_id, "delete")}
                          className="px-2 py-1 text-xs rounded bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/20 flex items-center gap-1"
                          data-testid={`button-delete-${u.user_id}`}
                        >
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

      {/* Referrals Detail Dialog */}
      <Dialog
        open={!!selectedUser}
        onOpenChange={(open) => {
          if (!open) setSelectedUser(null);
        }}
      >
        <DialogContent className="max-w-2xl bg-card border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Users className="w-5 h-5 text-primary" />
              إحالات {selectedUser?.name}
            </DialogTitle>
          </DialogHeader>

          {/* Summary cards */}
          {!referralsLoading && referredUsers.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-secondary/50 rounded-lg p-3 text-center">
                <p className="text-xl font-bold text-foreground">{referredUsers.length}</p>
                <p className="text-xs text-muted-foreground mt-0.5">إجمالي الإحالات</p>
              </div>
              <div className="bg-secondary/50 rounded-lg p-3 text-center">
                <p className="text-xl font-bold text-green-500">{verifiedCount}</p>
                <p className="text-xs text-muted-foreground mt-0.5">موثّق (إيداع معتمد)</p>
              </div>
              <div className="bg-secondary/50 rounded-lg p-3 text-center">
                <p className="text-xl font-bold text-yellow-500">{pendingCount}</p>
                <p className="text-xs text-muted-foreground mt-0.5">في الانتظار</p>
              </div>
            </div>
          )}

          {/* Referrals table */}
          <div className="overflow-x-auto rounded-lg border border-border max-h-80 overflow-y-auto">
            {referralsLoading ? (
              <div className="py-10 text-center text-muted-foreground text-sm animate-pulse">
                جارٍ التحميل...
              </div>
            ) : referredUsers.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground text-sm">
                لا توجد إحالات بعد
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card z-10">
                  <tr className="border-b border-border bg-secondary/30">
                    <th className="text-left py-2.5 px-4 text-muted-foreground font-medium">#</th>
                    <th className="text-left py-2.5 px-4 text-muted-foreground font-medium">الاسم</th>
                    {hasEmails && (
                      <th className="text-left py-2.5 px-4 text-muted-foreground font-medium">الإيميل</th>
                    )}
                    <th className="text-left py-2.5 px-4 text-muted-foreground font-medium">تاريخ الانضمام</th>
                    <th className="text-left py-2.5 px-4 text-muted-foreground font-medium">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {referredUsers.map((r, i) => (
                    <tr
                      key={r.user_id}
                      className="border-b border-border/50 hover:bg-secondary/20 transition-colors"
                      data-testid={`row-referred-${r.user_id}`}
                    >
                      <td className="py-2.5 px-4 text-muted-foreground font-medium">#{i + 1}</td>
                      <td className="py-2.5 px-4 font-medium">{r.full_name || "—"}</td>
                      {hasEmails && (
                        <td className="py-2.5 px-4 text-muted-foreground font-mono text-xs">
                          {r.email || "—"}
                        </td>
                      )}
                      <td className="py-2.5 px-4 text-muted-foreground text-xs">
                        {new Date(r.joined_at).toLocaleDateString("ar-SA", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </td>
                      <td className="py-2.5 px-4">
                        {r.is_verified ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-green-500 bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded-full">
                            <CheckCircle2 className="w-3 h-3" /> موثّق
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-yellow-500 bg-yellow-500/10 border border-yellow-500/20 px-2 py-0.5 rounded-full">
                            <Clock className="w-3 h-3" /> في الانتظار
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

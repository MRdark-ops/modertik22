import { useState, useEffect, createContext, useContext, ReactNode, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  /** True until we know both the user AND their role */
  loading: boolean;
  isAdmin: boolean;
  profile: { full_name: string; referral_code: string; balance: number; referred_by?: string } | null;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  isAdmin: false,
  profile: null,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  // userLoading stays true until initializeAuth finishes (including fetchUserData)
  const [userLoading, setUserLoading] = useState(true);
  const [roleLoading, setRoleLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [profile, setProfile] = useState<AuthContextType["profile"]>(null);

  const fetchingRef = useRef(false);
  const lastFetchedUserIdRef = useRef<string | null>(null);
  const signedOutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── fetchUserData: fetch role + profile for a given userId ────────────────
  const fetchUserData = useCallback(async (userId: string) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setRoleLoading(true);
    try {
      const [rolesRes, profRes] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", userId),
        supabase.from("profiles")
          .select("full_name, referral_code, balance, referred_by")
          .eq("user_id", userId)
          .maybeSingle(),
      ]);
      setIsAdmin(rolesRes.data?.some((r) => r.role === "admin") ?? false);
      if (profRes.data) setProfile(profRes.data);
      lastFetchedUserIdRef.current = userId;
    } finally {
      fetchingRef.current = false;
      setRoleLoading(false);
    }
  }, []);

  // ── clearAuthState: reset everything on genuine logout ────────────────────
  const clearAuthState = useCallback(() => {
    setSession(null);
    setUser(null);
    setIsAdmin(false);
    setProfile(null);
    setRoleLoading(false);
    lastFetchedUserIdRef.current = null;
    fetchingRef.current = false;
  }, []);

  // ── attemptSessionRecovery: try to recover session after SIGNED_OUT ───────
  const attemptSessionRecovery = useCallback(async (isMounted: () => boolean) => {
    const { data: { session: s1 } } = await supabase.auth.getSession();
    if (!isMounted()) return;
    if (s1?.user) {
      setSession(s1);
      setUser(s1.user);
      if (lastFetchedUserIdRef.current !== s1.user.id) {
        fetchUserData(s1.user.id);
      }
      return;
    }

    try {
      const { data: { session: s2 } } = await supabase.auth.refreshSession();
      if (!isMounted()) return;
      if (s2?.user) {
        setSession(s2);
        setUser(s2.user);
        if (lastFetchedUserIdRef.current !== s2.user.id) {
          fetchUserData(s2.user.id);
        }
        return;
      }
    } catch {
      // no refresh token — genuine logout
    }

    if (!isMounted()) return;
    clearAuthState();
  }, [fetchUserData, clearAuthState]);

  useEffect(() => {
    let mounted = true;
    const isMounted = () => mounted;

    // ── Auth state listener ────────────────────────────────────────────────
    // IMPORTANT: Does NOT handle INITIAL_SESSION — that's done by initializeAuth below.
    // Handling INITIAL_SESSION here too would cause a redundant second fetchUserData
    // call that can reset isAdmin=false and redirect admins to /dashboard.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, newSession) => {
        if (!mounted) return;

        // Cancel any pending SIGNED_OUT timer when a positive event arrives
        if (event !== "SIGNED_OUT" && signedOutTimerRef.current) {
          clearTimeout(signedOutTimerRef.current);
          signedOutTimerRef.current = null;
        }

        // ── SIGNED_OUT: delayed recovery ──────────────────────────────────
        if (event === "SIGNED_OUT") {
          if (signedOutTimerRef.current) clearTimeout(signedOutTimerRef.current);
          signedOutTimerRef.current = setTimeout(() => {
            signedOutTimerRef.current = null;
            if (!mounted) return;
            attemptSessionRecovery(isMounted);
          }, 1000);
          return;
        }

        // ── SIGNED_IN / TOKEN_REFRESHED: user changed or token renewed ────
        // Skip INITIAL_SESSION — handled by initializeAuth
        if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
          setSession(newSession);
          setUser(newSession?.user ?? null);

          if (newSession?.user) {
            const uid = newSession.user.id;
            if (lastFetchedUserIdRef.current !== uid) {
              // Re-check inside the timeout to avoid redundant fetch if
              // initializeAuth has already completed by then
              setTimeout(() => {
                if (mounted && lastFetchedUserIdRef.current !== uid) {
                  fetchUserData(uid);
                }
              }, 0);
            }
          } else {
            clearAuthState();
          }
        }

        // ── USER_UPDATED: force re-fetch of profile/role ──────────────────
        if (event === "USER_UPDATED" && newSession?.user) {
          setSession(newSession);
          setUser(newSession.user);
          // Force re-fetch by resetting the ref
          lastFetchedUserIdRef.current = null;
          setTimeout(() => {
            if (mounted) fetchUserData(newSession.user!.id);
          }, 0);
        }
      }
    );

    // ── Initial session load ───────────────────────────────────────────────
    // This is the ONLY place we handle INITIAL_SESSION.
    // It awaits fetchUserData before setting userLoading=false, so ProtectedRoute
    // never sees loading=false + isAdmin=false for a logged-in admin.
    const initializeAuth = async () => {
      try {
        const { data: { session: initialSession } } = await supabase.auth.getSession();
        if (!mounted) return;

        setSession(initialSession);
        setUser(initialSession?.user ?? null);

        if (initialSession?.user) {
          await fetchUserData(initialSession.user.id);
        }
      } catch {
        // getSession failed — user stays as null
      } finally {
        if (mounted) setUserLoading(false);
      }
    };

    initializeAuth();

    return () => {
      mounted = false;
      subscription.unsubscribe();
      if (signedOutTimerRef.current) clearTimeout(signedOutTimerRef.current);
    };
  }, [fetchUserData, clearAuthState, attemptSessionRecovery]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const loading = userLoading || roleLoading;

  return (
    <AuthContext.Provider value={{
      user,
      session,
      loading,
      isAdmin,
      profile,
      signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

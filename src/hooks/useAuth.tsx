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
  // Three-state user: undefined = unknown, null = no session, User = logged in
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [session, setSession] = useState<Session | null>(null);
  // userLoading: true until we've done the initial getSession()
  const [userLoading, setUserLoading] = useState(true);
  // roleLoading: true while fetching isAdmin / profile data
  const [roleLoading, setRoleLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [profile, setProfile] = useState<AuthContextType["profile"]>(null);

  const initializedRef = useRef(false);
  const fetchingRef = useRef(false);
  const lastFetchedUserIdRef = useRef<string | null>(null);
  // Track a pending SIGNED_OUT timer so we can cancel it if SIGNED_IN follows
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
  // Called with a delay to allow Supabase auto-refresh to complete first.
  const attemptSessionRecovery = useCallback(async (isMounted: () => boolean) => {
    // 1. Try getSession() — returns current session from storage
    const { data: { session: s1 } } = await supabase.auth.getSession();
    if (!isMounted()) return;
    if (s1?.user) {
      setSession(s1);
      setUser(s1.user);
      // Re-fetch role only if user changed
      if (lastFetchedUserIdRef.current !== s1.user.id) {
        fetchUserData(s1.user.id);
      }
      return;
    }

    // 2. Fallback: try refreshSession() — forces a network refresh attempt
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
      // refreshSession throws if no refresh token exists — treat as genuine logout
    }

    if (!isMounted()) return;
    // 3. Genuine logout — no session recoverable
    clearAuthState();
  }, [fetchUserData, clearAuthState]);

  useEffect(() => {
    let mounted = true;
    const isMounted = () => mounted;

    // ── Auth state listener ────────────────────────────────────────────────
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, newSession) => {
        if (!mounted) return;

        // Cancel any pending SIGNED_OUT timer when a positive event arrives
        if (event !== "SIGNED_OUT" && signedOutTimerRef.current) {
          clearTimeout(signedOutTimerRef.current);
          signedOutTimerRef.current = null;
        }

        if (event === "SIGNED_OUT") {
          // Delay before acting — gives Supabase time to auto-refresh the token.
          // If TOKEN_REFRESHED fires within 1 s, the timer above cancels this.
          if (signedOutTimerRef.current) clearTimeout(signedOutTimerRef.current);
          signedOutTimerRef.current = setTimeout(() => {
            signedOutTimerRef.current = null;
            if (!mounted) return;
            attemptSessionRecovery(isMounted);
          }, 1000);
          return;
        }

        if (event === "TOKEN_REFRESHED" || event === "SIGNED_IN" || event === "INITIAL_SESSION") {
          setSession(newSession);
          setUser(newSession?.user ?? null);

          if (newSession?.user) {
            const uid = newSession.user.id;
            // Only re-fetch role/profile if user actually changed
            if (lastFetchedUserIdRef.current !== uid) {
              setTimeout(() => {
                if (mounted) fetchUserData(uid);
              }, 0);
            }
          } else {
            clearAuthState();
          }
        }

        // USER_UPDATED: refresh profile data
        if (event === "USER_UPDATED" && newSession?.user) {
          setSession(newSession);
          setUser(newSession.user);
          const uid = newSession.user.id;
          setTimeout(() => {
            if (mounted) fetchUserData(uid);
          }, 0);
        }
      }
    );

    // ── Initial session load ───────────────────────────────────────────────
    const initializeAuth = async () => {
      if (initializedRef.current) return;
      initializedRef.current = true;
      try {
        const { data: { session: initialSession } } = await supabase.auth.getSession();
        if (!mounted) return;

        setSession(initialSession);
        setUser(initialSession?.user ?? null);

        if (initialSession?.user) {
          await fetchUserData(initialSession.user.id);
        }
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

  // loading = true until we know the user AND their role
  const loading = userLoading || roleLoading;
  // Treat undefined user (still loading) same as logged-in for the purpose of the context value
  const resolvedUser = user === undefined ? null : user;

  return (
    <AuthContext.Provider value={{
      user: resolvedUser,
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

import { useState, useEffect, createContext, useContext, ReactNode, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isAdmin: boolean;
  profile: { full_name: string; referral_code: string; balance: number } | null;
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
  const [loading, setLoading] = useState(true);
  const [roleLoading, setRoleLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [profile, setProfile] = useState<AuthContextType["profile"]>(null);
  const initializedRef = useRef(false);
  const fetchingRef = useRef(false);
  const lastSessionUserIdRef = useRef<string | null>(null);

  const fetchUserData = useCallback(async (userId: string) => {
    // Prevent concurrent fetches
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setRoleLoading(true);
    try {
      const [rolesRes, profRes] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", userId),
        supabase.from("profiles").select("full_name, referral_code, balance").eq("user_id", userId).maybeSingle(),
      ]);
      setIsAdmin(rolesRes.data?.some((r) => r.role === "admin") ?? false);
      if (profRes.data) setProfile(profRes.data);
    } finally {
      fetchingRef.current = false;
      setRoleLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    // Set up auth state listener — does NOT control loading
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, newSession) => {
        if (!isMounted) return;

        // Guard against transient SIGNED_OUT events during refresh throttling.
        if (event === "SIGNED_OUT" && !newSession) {
          void (async () => {
            const { data: { session: recoveredSession } } = await supabase.auth.getSession();
            if (!isMounted) return;

            if (recoveredSession?.user) {
              setSession(recoveredSession);
              setUser(recoveredSession.user);
              return;
            }

            setSession(null);
            setUser(null);
            lastSessionUserIdRef.current = null;
            setIsAdmin(false);
            setProfile(null);
            setRoleLoading(false);
          })();
          return;
        }

        setSession(newSession);
        setUser(newSession?.user ?? null);

        if (newSession?.user) {
          const nextUserId = newSession.user.id;
          const userChanged = lastSessionUserIdRef.current !== nextUserId;
          lastSessionUserIdRef.current = nextUserId;

          // Prevent admin/user redirect race by marking role as loading immediately
          if (event === "SIGNED_IN" || userChanged) {
            setRoleLoading(true);
            setTimeout(() => {
              if (isMounted) fetchUserData(nextUserId);
            }, 0);
          }
        } else {
          lastSessionUserIdRef.current = null;
          setIsAdmin(false);
          setProfile(null);
          setRoleLoading(false);
        }
      }
    );

    // Initial load — fetch session AND user data BEFORE setting loading=false
    const initializeAuth = async () => {
      if (initializedRef.current) return;
      initializedRef.current = true;
      try {
        const { data: { session: initialSession } } = await supabase.auth.getSession();
        if (!isMounted) return;

        setSession(initialSession);
        setUser(initialSession?.user ?? null);

        if (initialSession?.user) {
          await fetchUserData(initialSession.user.id);
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    initializeAuth();

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [fetchUserData]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, loading: loading || roleLoading, isAdmin, profile, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

import { useState, useEffect, createContext, useContext, ReactNode, useRef, useCallback } from "react";
import * as api from "@/lib/api";

interface User {
  id: string;
  email: string;
}

interface Profile {
  full_name: string;
  referral_code: string;
  balance: number;
  referred_by?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  profile: Profile | null;
  signOut: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, full_name: string, referral_code?: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  isAdmin: false,
  profile: null,
  signOut: async () => {},
  login: async () => {},
  register: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const fetchingRef = useRef(false);

  // Fetch user data
  const fetchUserData = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;

    try {
      const data = await api.getMe();
      setUser(data.user);
      setProfile(data.profile);
      setIsAdmin(data.isAdmin);
    } catch (error: any) {
      const isEdgeError = error?.message?.includes('Edge Function');
      const isApprovalError = error?.message?.includes('Approval failed');

      console.error('Auth verification failed:', error);

      if (!isEdgeError && !isApprovalError) {
        api.logout();
      }

      setUser(null);
      setProfile(null);
      setIsAdmin(false);
    } finally {
      fetchingRef.current = false;
      setLoading(false);
    }
  }, []);

  // Initialize auth on mount
  useEffect(() => {
    fetchUserData();
  }, [fetchUserData]);

  const handleLogin = async (email: string, password: string) => {
    try {
      const data = await api.login(email, password);
      setUser(data.user);
      setProfile(data.profile);
      setIsAdmin(data.isAdmin || false);
    } catch (error) {
      console.error('Login request failed:', error);
      throw error;
    }
  };

  const handleRegister = async (email: string, password: string, full_name: string, referral_code?: string) => {
    try {
      const data = await api.register(email, password, full_name, referral_code);
      setUser(data.user);
      setProfile(data.profile);
      setIsAdmin(false);
    } catch (error) {
      console.error('Registration request failed:', error);
      throw error;
    }
  };

  const handleSignOut = async () => {
    api.logout();
    setUser(null);
    setProfile(null);
    setIsAdmin(false);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAdmin,
        profile,
        signOut: handleSignOut,
        login: handleLogin,
        register: handleRegister,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

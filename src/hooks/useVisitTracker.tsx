import { useEffect, useRef } from "react";
import * as api from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

export function useVisitTracker() {
  const tracked = useRef(false);
  const { user } = useAuth();

  useEffect(() => {
    if (tracked.current) return;
    tracked.current = true;

    // TODO: Implement site visit tracking in backend API if needed
    // This monitored user page visits in Supabase but is not critical
  }, [user]);
}

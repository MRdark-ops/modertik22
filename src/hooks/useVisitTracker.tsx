import { useEffect, useRef } from "react";
import * as api from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

export function useVisitTracker() {
  const tracked = useRef(false);
  const { user } = useAuth();

  useEffect(() => {
    if (tracked.current) return;
    tracked.current = true;

    // Site visit tracking is handled by the backend API autonomously
  }, [user]);
}

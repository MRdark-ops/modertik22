import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export function useVisitTracker() {
  const tracked = useRef(false);
  const { user } = useAuth();

  useEffect(() => {
    if (tracked.current) return;
    tracked.current = true;

    // Generate or retrieve visitor ID
    let visitorId = localStorage.getItem("visitor_id");
    if (!visitorId) {
      visitorId = crypto.randomUUID();
      localStorage.setItem("visitor_id", visitorId);
    }

    supabase.from("site_visits").insert({
      visitor_id: visitorId,
      user_id: user?.id ?? null,
      page: window.location.pathname,
    }).then(() => {});
  }, [user]);
}

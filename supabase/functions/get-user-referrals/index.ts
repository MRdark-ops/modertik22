import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Authenticate caller
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(authHeader.replace("Bearer ", ""));

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Only admins can call this
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin");

    if (!roles || roles.length === 0) {
      return new Response(JSON.stringify({ error: "Forbidden: admin only" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { referrer_user_id } = await req.json();

    if (!referrer_user_id) {
      return new Response(JSON.stringify({ error: "referrer_user_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get all direct referrals (level=1) for this user
    const { data: referrals, error: refError } = await supabaseAdmin
      .from("referrals")
      .select("referred_id, created_at")
      .eq("referrer_id", referrer_user_id)
      .eq("level", 1)
      .order("created_at", { ascending: false });

    if (refError) {
      return new Response(JSON.stringify({ error: refError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!referrals || referrals.length === 0) {
      return new Response(JSON.stringify([]), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const referredIds = referrals.map((r) => r.referred_id);

    // Get profiles (names)
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("user_id, full_name, created_at")
      .in("user_id", referredIds);

    const profileMap = new Map(
      (profiles ?? []).map((p) => [p.user_id, { full_name: p.full_name, created_at: p.created_at }])
    );

    // Get auth user emails using admin API
    const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers({
      perPage: 1000,
    });

    const emailMap = new Map(
      (authUsers?.users ?? [])
        .filter((u) => referredIds.includes(u.id))
        .map((u) => [u.id, u.email ?? ""])
    );

    // Check verification status from referral_commissions
    const { data: commissions } = await supabaseAdmin
      .from("referral_commissions")
      .select("referred_id")
      .in("referred_id", referredIds)
      .eq("level", 1)
      .eq("status", "paid");

    const verifiedSet = new Set((commissions ?? []).map((c) => c.referred_id));

    // Assemble response
    const result = referrals.map((r) => {
      const prof = profileMap.get(r.referred_id);
      return {
        user_id: r.referred_id,
        full_name: prof?.full_name ?? "",
        email: emailMap.get(r.referred_id) ?? "",
        joined_at: prof?.created_at ?? r.created_at,
        is_verified: verifiedSet.has(r.referred_id),
      };
    });

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("get-user-referrals error:", err instanceof Error ? err.message : String(err));
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://modertin.lovable.app",
  "https://id-preview--61efc4ae-bed6-4fa9-9299-7ce90d249e3f.lovable.app",
  "http://localhost:5173",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  };
}

const FLAT_REFERRAL_BONUS = 2.50; // flat $2.50 per direct referral

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify caller is admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check admin role
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

    const { deposit_id, action, admin_note } = await req.json();

    if (!deposit_id || !["approve", "reject"].includes(action)) {
      return new Response(JSON.stringify({ error: "Invalid request" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get the deposit
    const { data: deposit, error: depError } = await supabaseAdmin
      .from("deposits")
      .select("*")
      .eq("id", deposit_id)
      .single();

    if (depError || !deposit) {
      return new Response(JSON.stringify({ error: "Deposit not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (deposit.status !== "pending") {
      return new Response(JSON.stringify({ error: "Deposit already processed" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const newStatus = action === "approve" ? "approved" : "rejected";

    // Update deposit status
    await supabaseAdmin
      .from("deposits")
      .update({ status: newStatus, admin_note: admin_note || null })
      .eq("id", deposit_id);

    if (action === "approve") {
      // Add to user balance
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("balance")
        .eq("user_id", deposit.user_id)
        .single();

      const newBalance = (parseFloat(profile?.balance || "0")) + parseFloat(deposit.amount);
      await supabaseAdmin
        .from("profiles")
        .update({ balance: newBalance })
        .eq("user_id", deposit.user_id);

      // Check if this is the FIRST approved deposit for this user
      const { count: previousApproved } = await supabaseAdmin
        .from("deposits")
        .select("id", { count: "exact", head: true })
        .eq("user_id", deposit.user_id)
        .eq("status", "approved")
        .neq("id", deposit_id);

      // Only pay referral bonus on FIRST deposit
      if ((previousApproved ?? 0) === 0) {
        const { data: directReferrer } = await supabaseAdmin
          .from("referrals")
          .select("referrer_id")
          .eq("referred_id", deposit.user_id)
          .eq("level", 1)
          .single();

        if (directReferrer) {
          // Create commission record
          await supabaseAdmin.from("referral_commissions").insert({
            referrer_id: directReferrer.referrer_id,
            referred_id: deposit.user_id,
            deposit_id: deposit_id,
            level: 1,
            rate: 0,
            commission_amount: FLAT_REFERRAL_BONUS,
            status: "paid",
          });

          // Credit referrer balance
          const { data: refProfile } = await supabaseAdmin
            .from("profiles")
            .select("balance")
            .eq("user_id", directReferrer.referrer_id)
            .single();

          if (refProfile) {
            await supabaseAdmin
              .from("profiles")
              .update({ balance: parseFloat(refProfile.balance) + FLAT_REFERRAL_BONUS })
              .eq("user_id", directReferrer.referrer_id);
          }
        }
      }

      // Log activity
      await supabaseAdmin.from("activity_logs").insert({
        user_id: deposit.user_id,
        action: "deposit_approved",
        details: { deposit_id, amount: deposit.amount, approved_by: user.id },
      });
    } else {
      await supabaseAdmin.from("activity_logs").insert({
        user_id: deposit.user_id,
        action: "deposit_rejected",
        details: { deposit_id, amount: deposit.amount, rejected_by: user.id, note: admin_note },
      });
    }

    return new Response(JSON.stringify({ success: true, status: newStatus }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("approve-deposit error:", {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      timestamp: new Date().toISOString(),
    });
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

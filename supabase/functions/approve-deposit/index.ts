import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://modertin.lovable.app",
  "https://id-preview--61efc4ae-bed6-4fa9-9299-7ce90d249e3f.lovable.app",
  "http://localhost:5173",
  "http://localhost:5000",
  "https://975f647a-d90d-472a-9cb2-7f4d7e0aa4b6-00-3w57mlcdfw9wo.riker.replit.dev",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  };
}

// Tier-based indirect reward amounts based on position in direct referrer's downline
// Position 0 = 1st verified referral → $2.00, 1 = 2nd → $1.50, etc.
const INDIRECT_REWARD_TIERS: number[] = [2.00, 1.50, 1.00, 0.50];
const INDIRECT_REWARD_DEFAULT = 0.50;
const DIRECT_REWARD = 2.50;

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
      // Credit deposit amount to user balance
      const { data: userProfile } = await supabaseAdmin
        .from("profiles")
        .select("balance, referred_by")
        .eq("user_id", deposit.user_id)
        .single();

      const newBalance = (parseFloat(userProfile?.balance || "0")) + parseFloat(deposit.amount);
      await supabaseAdmin
        .from("profiles")
        .update({ balance: newBalance })
        .eq("user_id", deposit.user_id);

      // Log deposit approval
      await supabaseAdmin.from("activity_logs").insert({
        user_id: deposit.user_id,
        action: "deposit_approved",
        details: { deposit_id, amount: deposit.amount, approved_by: user.id },
      });

      // ─── Referral Reward Logic ────────────────────────────────────────────
      // Rewards are ONLY granted on the first approved deposit for this user.
      // Direct referrer earns $2.50. Grand-referrer earns tiered indirect reward.
      if (userProfile?.referred_by) {
        // Check if referral reward has already been granted for this user
        const { data: existingCommission } = await supabaseAdmin
          .from("referral_commissions")
          .select("id")
          .eq("referred_id", deposit.user_id)
          .eq("level", 1)
          .eq("status", "paid")
          .maybeSingle();

        if (!existingCommission) {
          const directReferrerId = userProfile.referred_by;

          // Grant $2.50 direct referral reward
          await supabaseAdmin.from("referral_commissions").insert({
            referrer_id: directReferrerId,
            referred_id: deposit.user_id,
            deposit_id: deposit.id,
            level: 1,
            rate: 0,
            commission_amount: DIRECT_REWARD,
            status: "paid",
          });

          const { data: referrerProfile } = await supabaseAdmin
            .from("profiles")
            .select("balance, referred_by")
            .eq("user_id", directReferrerId)
            .single();

          await supabaseAdmin
            .from("profiles")
            .update({ balance: parseFloat(referrerProfile?.balance || "0") + DIRECT_REWARD })
            .eq("user_id", directReferrerId);

          await supabaseAdmin.from("activity_logs").insert({
            user_id: directReferrerId,
            action: "referral_direct_reward",
            details: {
              referred_user_id: deposit.user_id,
              amount: DIRECT_REWARD,
              deposit_id: deposit.id,
            },
          });

          // ─── Indirect (Tier) Reward to Grand-Referrer ────────────────────
          if (referrerProfile?.referred_by) {
            const grandReferrerId = referrerProfile.referred_by;

            // Count how many of the direct referrer's level-1 referrals
            // were verified BEFORE this one (exclude current to get prior count)
            const { count: priorCount } = await supabaseAdmin
              .from("referral_commissions")
              .select("id", { count: "exact", head: true })
              .eq("referrer_id", directReferrerId)
              .eq("level", 1)
              .eq("status", "paid")
              .neq("referred_id", deposit.user_id);

            // 0-based position: 0 = this is the 1st referral getting verified → $2.00
            const position = priorCount ?? 0;
            const indirectAmount =
              position < INDIRECT_REWARD_TIERS.length
                ? INDIRECT_REWARD_TIERS[position]
                : INDIRECT_REWARD_DEFAULT;

            await supabaseAdmin.from("referral_commissions").insert({
              referrer_id: grandReferrerId,
              referred_id: deposit.user_id,
              deposit_id: deposit.id,
              level: 2,
              rate: 0,
              commission_amount: indirectAmount,
              status: "paid",
            });

            const { data: grandProfile } = await supabaseAdmin
              .from("profiles")
              .select("balance")
              .eq("user_id", grandReferrerId)
              .single();

            await supabaseAdmin
              .from("profiles")
              .update({ balance: parseFloat(grandProfile?.balance || "0") + indirectAmount })
              .eq("user_id", grandReferrerId);

            await supabaseAdmin.from("activity_logs").insert({
              user_id: grandReferrerId,
              action: "referral_indirect_reward",
              details: {
                indirect_via: directReferrerId,
                referred_user_id: deposit.user_id,
                amount: indirectAmount,
                downline_position: position + 1,
                deposit_id: deposit.id,
              },
            });
          }
        }
      }
      // ─────────────────────────────────────────────────────────────────────
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

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Reward constants ────────────────────────────────────────────────────────
// Direct referrer always earns $2.50 (level 1).
// Grand-referrer earns a tiered amount based on how many of the
// direct referrer's level-1 referrals have already been verified.
const DIRECT_REWARD = 2.50;
const INDIRECT_REWARD_TIERS: number[] = [2.00, 1.50, 1.00, 0.50];
const INDIRECT_REWARD_DEFAULT = 0.50;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── Auth: caller must be authenticated ───────────────────────────────────
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

    // ── Auth: caller must be admin ────────────────────────────────────────────
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

    // ── Parse & validate request ──────────────────────────────────────────────
    const { deposit_id, action, admin_note } = await req.json();

    if (!deposit_id || !["approve", "reject", "delete", "retry_commissions"].includes(action)) {
      return new Response(JSON.stringify({ error: "Invalid request" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Fetch deposit ─────────────────────────────────────────────────────────
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

    // ── DELETE branch ─────────────────────────────────────────────────────────
    if (action === "delete") {
      // Delete the proof file from storage if it exists
      if (deposit.proof_url) {
        await supabaseAdmin.storage
          .from("deposit-proofs")
          .remove([deposit.proof_url]);
      }

      const { error: delError } = await supabaseAdmin
        .from("deposits")
        .delete()
        .eq("id", deposit_id);

      if (delError) {
        return new Response(JSON.stringify({ error: "Failed to delete deposit" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await supabaseAdmin.from("activity_logs").insert({
        user_id: deposit.user_id,
        action: "deposit_deleted",
        details: {
          deposit_id,
          amount: deposit.amount,
          previous_status: deposit.status,
          deleted_by: user.id,
        },
      });

      return new Response(JSON.stringify({ success: true, status: "deleted" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── RETRY COMMISSIONS branch ────────────────────────────────────────────
    if (action === "retry_commissions") {
      if (deposit.status !== "approved") {
        return new Response(
          JSON.stringify({ error: "Can only retry commissions for approved deposits" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Get user profile to check for referrer
      const { data: userProfile } = await supabaseAdmin
        .from("profiles")
        .select("referred_by")
        .eq("user_id", deposit.user_id)
        .single();

      if (!userProfile?.referred_by) {
        return new Response(
          JSON.stringify({ success: true, message: "User has no referrer", commissions_paid: 0 }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Check if commissions already exist for this deposit
      const { data: existingCommissions } = await supabaseAdmin
        .from("referral_commissions")
        .select("id")
        .eq("deposit_id", deposit.id)
        .eq("status", "paid");

      if (existingCommissions && existingCommissions.length > 0) {
        return new Response(
          JSON.stringify({ success: true, message: "Commissions already paid", commissions_paid: existingCommissions.length }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Run commission logic (same as approve branch)
      const directReferrerId = userProfile.referred_by;
      let commissionsPaid = 0;

      // Grant $2.50 direct referral commission
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
        .update({
          balance: parseFloat(referrerProfile?.balance || "0") + DIRECT_REWARD,
        })
        .eq("user_id", directReferrerId);

      await supabaseAdmin.from("activity_logs").insert({
        user_id: directReferrerId,
        action: "referral_direct_reward_retry",
        details: {
          referred_user_id: deposit.user_id,
          amount: DIRECT_REWARD,
          deposit_id: deposit.id,
        },
      });
      commissionsPaid++;

      // Grant tiered indirect reward to grand-referrer (level 2)
      if (referrerProfile?.referred_by) {
        const grandReferrerId = referrerProfile.referred_by;

        const { count: priorCount } = await supabaseAdmin
          .from("referral_commissions")
          .select("id", { count: "exact", head: true })
          .eq("referrer_id", directReferrerId)
          .eq("level", 1)
          .eq("status", "paid")
          .not("deposit_id", "is", null)
          .neq("referred_id", deposit.user_id);

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
          .update({
            balance: parseFloat(grandProfile?.balance || "0") + indirectAmount,
          })
          .eq("user_id", grandReferrerId);

        await supabaseAdmin.from("activity_logs").insert({
          user_id: grandReferrerId,
          action: "referral_indirect_reward_retry",
          details: {
            indirect_via: directReferrerId,
            referred_user_id: deposit.user_id,
            amount: indirectAmount,
            downline_position: position + 1,
            deposit_id: deposit.id,
          },
        });
        commissionsPaid++;
      }

      return new Response(
        JSON.stringify({ success: true, message: "Commissions paid successfully", commissions_paid: commissionsPaid }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (deposit.status !== "pending") {
      return new Response(
        JSON.stringify({ error: "Deposit already processed" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ── Update deposit status ─────────────────────────────────────────────────
    const newStatus = action === "approve" ? "approved" : "rejected";

    await supabaseAdmin
      .from("deposits")
      .update({ status: newStatus, admin_note: admin_note || null })
      .eq("id", deposit_id);

    // ── APPROVED branch ───────────────────────────────────────────────────────
    if (action === "approve") {
      // 1. Credit the deposited amount to the user's balance
      const { data: userProfile } = await supabaseAdmin
        .from("profiles")
        .select("balance, referred_by")
        .eq("user_id", deposit.user_id)
        .single();

      const newBalance =
        parseFloat(userProfile?.balance || "0") +
        parseFloat(deposit.amount);

      await supabaseAdmin
        .from("profiles")
        .update({ balance: newBalance })
        .eq("user_id", deposit.user_id);

      // 2. Log approval
      await supabaseAdmin.from("activity_logs").insert({
        user_id: deposit.user_id,
        action: "deposit_approved",
        details: {
          deposit_id,
          amount: deposit.amount,
          approved_by: user.id,
        },
      });

      // ── Referral reward logic ────────────────────────────────────────────
      // Rewards are ONLY granted once, tied to the first approved deposit.
      // Any signup bonuses (deposit_id IS NULL) that the old trigger may have
      // created are voided first so the referrer receives the correct amount
      // exactly once — linked to this deposit.
      // ────────────────────────────────────────────────────────────────────
      if (userProfile?.referred_by) {
        const directReferrerId = userProfile.referred_by;

        // Check if a DEPOSIT-LINKED commission already exists for this user
        const { data: existingDepositCommission } = await supabaseAdmin
          .from("referral_commissions")
          .select("id")
          .eq("referred_id", deposit.user_id)
          .eq("level", 1)
          .eq("status", "paid")
          .not("deposit_id", "is", null)
          .maybeSingle();

        if (!existingDepositCommission) {
          // ── Void any erroneous signup bonus (deposit_id IS NULL) ──────────
          // Old handle_new_user triggers may have inserted a $2.50 commission
          // with deposit_id = NULL at signup time. Remove it and refund
          // the referrer's balance so the correct amount is given once here.
          const { data: signupBonus } = await supabaseAdmin
            .from("referral_commissions")
            .select("id, commission_amount")
            .eq("referred_id", deposit.user_id)
            .eq("level", 1)
            .is("deposit_id", null)
            .maybeSingle();

          if (signupBonus) {
            await supabaseAdmin
              .from("referral_commissions")
              .delete()
              .eq("id", signupBonus.id);

            // Safely deduct the incorrectly-credited signup bonus
            const { data: referrerNow } = await supabaseAdmin
              .from("profiles")
              .select("balance")
              .eq("user_id", directReferrerId)
              .single();

            const correctedBalance = Math.max(
              0,
              parseFloat(referrerNow?.balance || "0") -
                parseFloat(signupBonus.commission_amount)
            );

            await supabaseAdmin
              .from("profiles")
              .update({ balance: correctedBalance })
              .eq("user_id", directReferrerId);

            await supabaseAdmin.from("activity_logs").insert({
              user_id: directReferrerId,
              action: "referral_signup_bonus_voided",
              details: {
                referred_user_id: deposit.user_id,
                voided_amount: signupBonus.commission_amount,
                reason: "Replaced by deposit-linked commission",
              },
            });
          }

          // ── Grant $2.50 direct referral commission ────────────────────────
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
            .update({
              balance:
                parseFloat(referrerProfile?.balance || "0") + DIRECT_REWARD,
            })
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

          // ── Grant tiered indirect reward to grand-referrer (level 2) ─────
          if (referrerProfile?.referred_by) {
            const grandReferrerId = referrerProfile.referred_by;

            // Count verified level-1 referrals for the direct referrer
            // BEFORE this one (determines tier position)
            const { count: priorCount } = await supabaseAdmin
              .from("referral_commissions")
              .select("id", { count: "exact", head: true })
              .eq("referrer_id", directReferrerId)
              .eq("level", 1)
              .eq("status", "paid")
              .not("deposit_id", "is", null)
              .neq("referred_id", deposit.user_id);

            // position 0 → 1st verified referral → $2.00
            // position 1 → 2nd verified referral → $1.50  ...etc.
            const position = priorCount ?? 0;
            const indirectAmount =
              position < INDIRECT_REWARD_TIERS.length
                ? INDIRECT_REWARD_TIERS[position]
                : INDIRECT_REWARD_DEFAULT;

            // Void any erroneous indirect signup bonus (level=2, deposit_id IS NULL)
            const { data: oldIndirect } = await supabaseAdmin
              .from("referral_commissions")
              .select("id, commission_amount")
              .eq("referred_id", deposit.user_id)
              .eq("level", 2)
              .is("deposit_id", null)
              .maybeSingle();

            if (oldIndirect) {
              await supabaseAdmin
                .from("referral_commissions")
                .delete()
                .eq("id", oldIndirect.id);

              const { data: grandNow } = await supabaseAdmin
                .from("profiles")
                .select("balance")
                .eq("user_id", grandReferrerId)
                .single();

              await supabaseAdmin
                .from("profiles")
                .update({
                  balance: Math.max(
                    0,
                    parseFloat(grandNow?.balance || "0") -
                      parseFloat(oldIndirect.commission_amount)
                  ),
                })
                .eq("user_id", grandReferrerId);
            }

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
              .update({
                balance:
                  parseFloat(grandProfile?.balance || "0") + indirectAmount,
              })
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
      // ── REJECTED branch ───────────────────────────────────────────────────
      await supabaseAdmin.from("activity_logs").insert({
        user_id: deposit.user_id,
        action: "deposit_rejected",
        details: {
          deposit_id,
          amount: deposit.amount,
          rejected_by: user.id,
          note: admin_note,
        },
      });
    }

    return new Response(
      JSON.stringify({ success: true, status: newStatus }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
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

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

// ─── Reward constants ────────────────────────────────────────────────────────
const DIRECT_REWARD = 2.5;
const INDIRECT_REWARD_TIERS: number[] = [2.0, 1.5, 1.0, 0.5];
const INDIRECT_REWARD_DEFAULT = 0.5;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({ error: "Server configuration error: missing Supabase credentials" });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  try {
    // ── Auth: caller must be authenticated ───────────────────────────────────
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (authError || !user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // ── Auth: caller must be admin ────────────────────────────────────────────
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin");

    if (!roles || roles.length === 0) {
      return res.status(403).json({ error: "Forbidden: admin only" });
    }

    // ── Parse & validate request ──────────────────────────────────────────────
    const { deposit_id, action, admin_note } = req.body;

    if (!deposit_id || !["approve", "reject", "delete", "retry_commissions"].includes(action)) {
      return res.status(400).json({ error: "Invalid request" });
    }

    // ── Fetch deposit ─────────────────────────────────────────────────────────
    const { data: deposit, error: depError } = await supabaseAdmin
      .from("deposits")
      .select("*")
      .eq("id", deposit_id)
      .single();

    if (depError || !deposit) {
      return res.status(404).json({ error: "Deposit not found" });
    }

    // ── DELETE branch ─────────────────────────────────────────────────────────
    if (action === "delete") {
      if (deposit.proof_url) {
        await supabaseAdmin.storage.from("deposit-proofs").remove([deposit.proof_url]);
      }

      const { error: delError } = await supabaseAdmin
        .from("deposits")
        .delete()
        .eq("id", deposit_id);

      if (delError) {
        return res.status(500).json({ error: "Failed to delete deposit" });
      }

      await supabaseAdmin.from("activity_logs").insert({
        user_id: deposit.user_id,
        action: "deposit_deleted",
        details: { deposit_id, amount: deposit.amount, previous_status: deposit.status, deleted_by: user.id },
      });

      return res.json({ success: true, status: "deleted" });
    }

    // ── RETRY COMMISSIONS branch ────────────────────────────────────────────
    if (action === "retry_commissions") {
      if (deposit.status !== "approved") {
        return res.status(400).json({ error: "Can only retry commissions for approved deposits" });
      }

      const { data: userProfile } = await supabaseAdmin
        .from("profiles")
        .select("referred_by")
        .eq("user_id", deposit.user_id)
        .single();

      if (!userProfile?.referred_by) {
        return res.json({ success: true, message: "User has no referrer", commissions_paid: 0 });
      }

      const { data: existingCommissions } = await supabaseAdmin
        .from("referral_commissions")
        .select("id")
        .eq("deposit_id", deposit.id)
        .eq("status", "paid");

      if (existingCommissions && existingCommissions.length > 0) {
        return res.json({ success: true, message: "Commissions already paid", commissions_paid: existingCommissions.length });
      }

      const directReferrerId = userProfile.referred_by;
      let commissionsPaid = 0;

      // Grant direct referral commission
      const { error: insertError } = await supabaseAdmin.from("referral_commissions").insert({
        referrer_id: directReferrerId,
        referred_id: deposit.user_id,
        deposit_id: deposit.id,
        level: 1,
        rate: 0,
        commission_amount: DIRECT_REWARD,
        status: "paid",
      });

      if (insertError) {
        console.error("Insert commission error:", insertError);
        return res.status(500).json({ error: "Failed to insert commission: " + insertError.message });
      }

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
        action: "referral_direct_reward_retry",
        details: { referred_user_id: deposit.user_id, amount: DIRECT_REWARD, deposit_id: deposit.id },
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
        const indirectAmount = position < INDIRECT_REWARD_TIERS.length
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

      return res.json({ success: true, message: "Commissions paid successfully", commissions_paid: commissionsPaid });
    }

    // ── Check pending status for approve/reject ───────────────────────────────
    if (deposit.status !== "pending") {
      return res.status(400).json({ error: "Deposit already processed" });
    }

    const newStatus = action === "approve" ? "approved" : "rejected";

    await supabaseAdmin
      .from("deposits")
      .update({ status: newStatus, admin_note: admin_note || null })
      .eq("id", deposit_id);

    // ── APPROVED branch ───────────────────────────────────────────────────────
    if (action === "approve") {
      const { data: userProfile } = await supabaseAdmin
        .from("profiles")
        .select("balance, referred_by")
        .eq("user_id", deposit.user_id)
        .single();

      const newBalance = parseFloat(userProfile?.balance || "0") + parseFloat(deposit.amount);

      await supabaseAdmin
        .from("profiles")
        .update({ balance: newBalance })
        .eq("user_id", deposit.user_id);

      await supabaseAdmin.from("activity_logs").insert({
        user_id: deposit.user_id,
        action: "deposit_approved",
        details: { deposit_id, amount: deposit.amount, approved_by: user.id },
      });

      // ── Referral reward logic ────────────────────────────────────────────
      if (userProfile?.referred_by) {
        const directReferrerId = userProfile.referred_by;

        const { data: existingDepositCommission } = await supabaseAdmin
          .from("referral_commissions")
          .select("id")
          .eq("referred_id", deposit.user_id)
          .eq("level", 1)
          .eq("status", "paid")
          .not("deposit_id", "is", null)
          .maybeSingle();

        if (!existingDepositCommission) {
          // Void any erroneous signup bonus
          const { data: signupBonus } = await supabaseAdmin
            .from("referral_commissions")
            .select("id, commission_amount")
            .eq("referred_id", deposit.user_id)
            .eq("level", 1)
            .is("deposit_id", null)
            .maybeSingle();

          if (signupBonus) {
            await supabaseAdmin.from("referral_commissions").delete().eq("id", signupBonus.id);

            const { data: referrerNow } = await supabaseAdmin
              .from("profiles")
              .select("balance")
              .eq("user_id", directReferrerId)
              .single();

            const correctedBalance = Math.max(0, parseFloat(referrerNow?.balance || "0") - parseFloat(signupBonus.commission_amount));

            await supabaseAdmin.from("profiles").update({ balance: correctedBalance }).eq("user_id", directReferrerId);

            await supabaseAdmin.from("activity_logs").insert({
              user_id: directReferrerId,
              action: "referral_signup_bonus_voided",
              details: { referred_user_id: deposit.user_id, voided_amount: signupBonus.commission_amount, reason: "Replaced by deposit-linked commission" },
            });
          }

          // Grant direct referral commission
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
            details: { referred_user_id: deposit.user_id, amount: DIRECT_REWARD, deposit_id: deposit.id },
          });

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
            const indirectAmount = position < INDIRECT_REWARD_TIERS.length
              ? INDIRECT_REWARD_TIERS[position]
              : INDIRECT_REWARD_DEFAULT;

            // Void old indirect bonus
            const { data: oldIndirect } = await supabaseAdmin
              .from("referral_commissions")
              .select("id, commission_amount")
              .eq("referred_id", deposit.user_id)
              .eq("level", 2)
              .is("deposit_id", null)
              .maybeSingle();

            if (oldIndirect) {
              await supabaseAdmin.from("referral_commissions").delete().eq("id", oldIndirect.id);

              const { data: grandNow } = await supabaseAdmin
                .from("profiles")
                .select("balance")
                .eq("user_id", grandReferrerId)
                .single();

              await supabaseAdmin
                .from("profiles")
                .update({ balance: Math.max(0, parseFloat(grandNow?.balance || "0") - parseFloat(oldIndirect.commission_amount)) })
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
    } else {
      // ── REJECTED branch ───────────────────────────────────────────────────
      await supabaseAdmin.from("activity_logs").insert({
        user_id: deposit.user_id,
        action: "deposit_rejected",
        details: { deposit_id, amount: deposit.amount, rejected_by: user.id, note: admin_note },
      });
    }

    return res.json({ success: true, status: newStatus });
  } catch (err) {
    console.error("admin/deposit error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

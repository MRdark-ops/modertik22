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

    const { withdrawal_id, action, admin_note } = await req.json();

    if (!withdrawal_id || !["approve", "reject", "in_progress", "completed"].includes(action)) {
      return new Response(JSON.stringify({ error: "Invalid request" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: withdrawal, error: wError } = await supabaseAdmin
      .from("withdrawals")
      .select("*")
      .eq("id", withdrawal_id)
      .single();

    if (wError || !withdrawal) {
      return new Response(JSON.stringify({ error: "Withdrawal not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate state transitions
    const validTransitions: Record<string, string[]> = {
      pending: ["approved", "rejected"],
      approved: ["in_progress"],
      in_progress: ["completed"],
    };

    const statusMap: Record<string, string> = {
      approve: "approved",
      reject: "rejected",
      in_progress: "in_progress",
      completed: "completed",
    };

    const newStatus = statusMap[action];
    const allowed = validTransitions[withdrawal.status] || [];

    if (!allowed.includes(newStatus)) {
      return new Response(JSON.stringify({ error: `Cannot transition from ${withdrawal.status} to ${newStatus}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabaseAdmin
      .from("withdrawals")
      .update({ status: newStatus, admin_note: admin_note || null })
      .eq("id", withdrawal_id);

    if (action === "reject") {
      // Refund balance
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("balance")
        .eq("user_id", withdrawal.user_id)
        .single();

      if (profile) {
        await supabaseAdmin
          .from("profiles")
          .update({ balance: parseFloat(profile.balance) + parseFloat(withdrawal.amount) })
          .eq("user_id", withdrawal.user_id);
      }
    }

    await supabaseAdmin.from("activity_logs").insert({
      user_id: withdrawal.user_id,
      action: `withdrawal_${action === "approve" ? "approved" : action === "reject" ? "rejected" : action}`,
      details: { withdrawal_id, amount: withdrawal.amount, processed_by: user.id, note: admin_note },
    });

    return new Response(JSON.stringify({ success: true, status: newStatus }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("approve-withdrawal error:", {
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

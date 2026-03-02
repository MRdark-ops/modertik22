import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function base32Decode(encoded: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0;
  const output: number[] = [];
  for (const char of encoded.toUpperCase()) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(output);
}

async function generateHOTP(secret: Uint8Array, counter: bigint): Promise<string> {
  const counterBuf = new ArrayBuffer(8);
  const view = new DataView(counterBuf);
  view.setBigUint64(0, counter);
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, counterBuf);
  const hmac = new Uint8Array(sig);
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff)) % 1000000;
  return code.toString().padStart(6, "0");
}

async function verifyTOTP(secret: string, code: string, window = 1): Promise<boolean> {
  const secretBytes = base32Decode(secret);
  const now = BigInt(Math.floor(Date.now() / 1000 / 30));
  for (let i = -window; i <= window; i++) {
    const expected = await generateHOTP(secretBytes, now + BigInt(i));
    if (expected === code) return true;
  }
  return false;
}

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { email, password, totp_code } = await req.json();

    // Validate inputs
    if (!email || typeof email !== "string" || !password || typeof password !== "string") {
      return new Response(JSON.stringify({ error: "Email and password required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (email.length > 255 || password.length > 128) {
      return new Response(JSON.stringify({ error: "Invalid input" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Rate limiting: check recent failed attempts
    const cutoff = new Date(Date.now() - LOCKOUT_MINUTES * 60 * 1000).toISOString();
    const { count: failedCount } = await supabaseAdmin
      .from("login_attempts")
      .select("id", { count: "exact", head: true })
      .eq("email", normalizedEmail)
      .eq("success", false)
      .gte("created_at", cutoff);

    if ((failedCount ?? 0) >= MAX_ATTEMPTS) {
      return new Response(JSON.stringify({ 
        error: `Too many login attempts. Please try again after ${LOCKOUT_MINUTES} minutes.` 
      }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Step 1: Authenticate with password
    const tempClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!
    );

    const { data: signInData, error: signInError } = await tempClient.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

    if (signInError || !signInData.user) {
      // Log failed attempt
      await supabaseAdmin.from("login_attempts").insert({
        email: normalizedEmail,
        success: false,
      });

      return new Response(JSON.stringify({ error: "Invalid email or password" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = signInData.user.id;

    // Step 2: Check if 2FA is required
    const { data: totp } = await supabaseAdmin
      .from("user_totp")
      .select("totp_secret, is_enabled")
      .eq("user_id", userId)
      .single();

    if (totp?.is_enabled) {
      if (!totp_code) {
        await tempClient.auth.signOut();
        return new Response(JSON.stringify({ requires_totp: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (typeof totp_code !== "string" || !/^\d{6}$/.test(totp_code)) {
        await tempClient.auth.signOut();
        return new Response(JSON.stringify({ error: "Invalid TOTP code format" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const valid = await verifyTOTP(totp.totp_secret, totp_code);
      if (!valid) {
        await tempClient.auth.signOut();

        await supabaseAdmin.from("activity_logs").insert({
          user_id: userId,
          action: "2fa_failed_attempt",
          details: { timestamp: new Date().toISOString() },
        });

        // Count as failed attempt
        await supabaseAdmin.from("login_attempts").insert({
          email: normalizedEmail,
          success: false,
        });

        return new Response(JSON.stringify({ error: "Invalid verification code" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await supabaseAdmin.from("activity_logs").insert({
        user_id: userId,
        action: "2fa_verified",
        details: { timestamp: new Date().toISOString() },
      });
    }

    // Log successful login
    await supabaseAdmin.from("login_attempts").insert({
      email: normalizedEmail,
      success: true,
    });

    // Step 3: Check if user is admin
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const isAdmin = roles?.some((r: { role: string }) => r.role === "admin") ?? false;

    // Step 4: Return session tokens
    return new Response(JSON.stringify({
      session: {
        access_token: signInData.session.access_token,
        refresh_token: signInData.session.refresh_token,
        expires_in: signInData.session.expires_in,
        expires_at: signInData.session.expires_at,
        token_type: signInData.session.token_type,
      },
      user: {
        id: signInData.user.id,
        email: signInData.user.email,
      },
      is_admin: isAdmin,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("auth-with-totp error:", err instanceof Error ? err.message : String(err));
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

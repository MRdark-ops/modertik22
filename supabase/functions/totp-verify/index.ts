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

async function normalizeTime(startTime: number, minMs: number) {
  const elapsed = Date.now() - startTime;
  if (elapsed < minMs) {
    await new Promise(resolve => setTimeout(resolve, minMs - elapsed));
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const MIN_RESPONSE_TIME = 200; // Normalize timing to prevent enumeration

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { email, code } = await req.json();

    if (!email || !code || typeof code !== "string" || !/^\d{6}$/.test(code)) {
      await normalizeTime(startTime, MIN_RESPONSE_TIME);
      return new Response(JSON.stringify({ error: "Email and valid 6-digit code required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use getUserByEmail instead of listing all users
    const { data: { user: targetUser }, error: userErr } = await supabaseAdmin.auth.admin.getUserByEmail(email);

    if (userErr || !targetUser) {
      await normalizeTime(startTime, MIN_RESPONSE_TIME);
      return new Response(JSON.stringify({ error: "Invalid code" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: totp } = await supabaseAdmin
      .from("user_totp")
      .select("totp_secret, is_enabled")
      .eq("user_id", targetUser.id)
      .single();

    if (!totp?.is_enabled) {
      await normalizeTime(startTime, MIN_RESPONSE_TIME);
      return new Response(JSON.stringify({ verified: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const valid = await verifyTOTP(totp.totp_secret, code);
    if (!valid) {
      await supabaseAdmin.from("activity_logs").insert({
        user_id: targetUser.id,
        action: "2fa_failed_attempt",
        details: { timestamp: new Date().toISOString() },
      });

      await normalizeTime(startTime, MIN_RESPONSE_TIME);
      return new Response(JSON.stringify({ error: "Invalid verification code" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabaseAdmin.from("activity_logs").insert({
      user_id: targetUser.id,
      action: "2fa_verified",
      details: { timestamp: new Date().toISOString() },
    });

    await normalizeTime(startTime, MIN_RESPONSE_TIME);
    return new Response(JSON.stringify({ verified: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("totp-verify error:", err);
    await normalizeTime(startTime, MIN_RESPONSE_TIME);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

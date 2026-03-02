import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function base32Encode(buffer: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0, output = "";
  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

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

  const key = await crypto.subtle.importKey(
    "raw", secret, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, counterBuf);
  const hmac = new Uint8Array(sig);

  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  ) % 1000000;

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { action, code } = body;

    if (action === "setup") {
      const { data: existing } = await supabaseAdmin
        .from("user_totp")
        .select("is_enabled")
        .eq("user_id", user.id)
        .single();

      if (existing?.is_enabled) {
        return new Response(JSON.stringify({ error: "2FA is already enabled" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const bytes = new Uint8Array(20);
      crypto.getRandomValues(bytes);
      const secret = base32Encode(bytes);
      const issuer = "GlobalTrading";
      const otpauthUri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(user.email || "user")}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

      await supabaseAdmin.from("user_totp").upsert({
        user_id: user.id,
        totp_secret: secret,
        is_enabled: false,
      }, { onConflict: "user_id" });

      return new Response(JSON.stringify({ secret, otpauth_uri: otpauthUri }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "enable") {
      if (!code || typeof code !== "string" || !/^\d{6}$/.test(code)) {
        return new Response(JSON.stringify({ error: "Invalid code format" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: totp } = await supabaseAdmin
        .from("user_totp")
        .select("totp_secret, is_enabled")
        .eq("user_id", user.id)
        .single();

      if (!totp) {
        return new Response(JSON.stringify({ error: "Setup 2FA first" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (totp.is_enabled) {
        return new Response(JSON.stringify({ error: "2FA is already enabled" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const valid = await verifyTOTP(totp.totp_secret, code);
      if (!valid) {
        return new Response(JSON.stringify({ error: "Invalid code. Please try again." }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await supabaseAdmin.from("user_totp").update({ is_enabled: true }).eq("user_id", user.id);

      await supabaseAdmin.from("activity_logs").insert({
        user_id: user.id,
        action: "2fa_enabled",
        details: { timestamp: new Date().toISOString() },
      });

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "disable") {
      if (!code || typeof code !== "string" || !/^\d{6}$/.test(code)) {
        return new Response(JSON.stringify({ error: "Invalid code format" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: totp } = await supabaseAdmin
        .from("user_totp")
        .select("totp_secret, is_enabled")
        .eq("user_id", user.id)
        .single();

      if (!totp?.is_enabled) {
        return new Response(JSON.stringify({ error: "2FA is not enabled" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const valid = await verifyTOTP(totp.totp_secret, code);
      if (!valid) {
        return new Response(JSON.stringify({ error: "Invalid code" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await supabaseAdmin.from("user_totp").delete().eq("user_id", user.id);

      await supabaseAdmin.from("activity_logs").insert({
        user_id: user.id,
        action: "2fa_disabled",
        details: { timestamp: new Date().toISOString() },
      });

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "status") {
      const { data: totp } = await supabaseAdmin
        .from("user_totp")
        .select("is_enabled")
        .eq("user_id", user.id)
        .single();

      return new Response(JSON.stringify({ enabled: totp?.is_enabled ?? false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("totp-setup error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB — supports high-res mobile photos

// Magic bytes for common formats. HEIC/HEIF use ISO BMFF container (ftyp at offset 4)
// and are identified separately below.
const IMAGE_SIGNATURES: Record<string, number[]> = {
  "image/png":  [0x89, 0x50, 0x4e, 0x47],
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/webp": [0x52, 0x49, 0x46, 0x46], // RIFF header
};

/** Returns true if the file is an HEIC/HEIF image (ISO BMFF ftyp box). */
function isHeicBytes(bytes: Uint8Array): boolean {
  // ftyp box: size (4 bytes) + "ftyp" at offset 4
  if (bytes.length < 12) return false;
  const ftyp = bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
  if (!ftyp) return false;
  // Brands at offset 8–11: heic, heix, hevc, mif1, msf1, etc.
  const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  return ["heic", "heix", "hevc", "mif1", "msf1", "avif"].includes(brand);
}

function detectMimeType(bytes: Uint8Array): string | null {
  if (isHeicBytes(bytes)) return "image/heic";
  for (const [mime, sig] of Object.entries(IMAGE_SIGNATURES)) {
    if (sig.every((b, i) => bytes[i] === b)) {
      if (mime === "image/webp") {
        // Also verify "WEBP" at offset 8
        if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
          return mime;
        }
        continue;
      }
      return mime;
    }
  }
  return null;
}

Deno.serve(async (req) => {
  console.log("upload-deposit-proof called, method:", req.method);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Authenticate user
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

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return new Response(JSON.stringify({ error: "No file provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Server-side size validation
    if (file.size > MAX_FILE_SIZE) {
      return new Response(JSON.stringify({ error: "File must be under 5MB" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Server-side MIME type validation (allow common mobile types too)
    let normalizedType = file.type === "image/jpg" ? "image/jpeg" : file.type;
    
    // If MIME type is empty (common on Android camera), infer from extension
    if (!normalizedType) {
      const fileExt = file.name?.split(".").pop()?.toLowerCase();
      const extToMime: Record<string, string> = {
        png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
        webp: "image/webp", heic: "image/heic", heif: "image/heif",
      };
      normalizedType = extToMime[fileExt || ""] || "";
    }

    if (!ALLOWED_MIME_TYPES.includes(normalizedType)) {
      return new Response(JSON.stringify({ error: `File type "${file.type || "unknown"}" is not allowed. Only PNG, JPEG, WebP, and HEIC images are accepted.` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Read file bytes and validate against magic bytes
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const detectedMime = detectMimeType(bytes);

    // For HEIC/HEIF, the detected MIME will be "image/heic" if the ftyp box is present.
    // If detection returns null but the declared MIME is heic/heif, allow it through
    // (some mobile apps don't write the full ISO BMFF container we check).
    const isHeicDeclared = normalizedType === "image/heic" || normalizedType === "image/heif";
    if (!detectedMime && !isHeicDeclared) {
      return new Response(JSON.stringify({ error: "File content does not match a valid image format" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Prefer the detected MIME; fall back to the declared MIME
    const finalMime = detectedMime || normalizedType;

    // Generate safe file path with UUID and correct extension
    const mimeToExt: Record<string, string> = {
      "image/png": "png", "image/jpeg": "jpg",
      "image/webp": "webp", "image/heic": "heic", "image/heif": "heif",
    };
    const ext = mimeToExt[finalMime] || "jpg";
    const filePath = `${user.id}/${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from("deposit-proofs")
      .upload(filePath, bytes, { contentType: finalMime });

    if (uploadError) {
      console.error("Storage upload error:", JSON.stringify(uploadError));
      return new Response(JSON.stringify({ error: "Upload failed: " + uploadError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ path: filePath }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("upload-deposit-proof error:", {
      message: err instanceof Error ? err.message : String(err),
      timestamp: new Date().toISOString(),
    });
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

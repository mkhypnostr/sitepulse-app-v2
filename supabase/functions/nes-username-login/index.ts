import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

function readAdminKey() {
  const secretKeysJson = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeysJson) {
    try {
      const secretKeys = JSON.parse(secretKeysJson) as Record<string, string>;
      if (secretKeys.default) return secretKeys.default;
    } catch {
      // Eski proje anahtarına geri dön.
    }
  }
  const legacyKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!legacyKey) throw new Error("Sunucu anahtarı yapılandırılmamış.");
  return legacyKey;
}

const admin = createClient(SUPABASE_URL, readAdminKey(), {
  auth: { autoRefreshToken: false, persistSession: false },
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function normalizeUsername(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function validUsername(value: string) {
  return /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])$/.test(value);
}

function invalidCredentials() {
  // Kullanıcı adı bulunup bulunmadığını dışarıya açıklamayın.
  return json({ error: "Kullanıcı adı veya şifre hatalı." }, 401);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST kullanın." }, 405);

  let body: { username?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Geçersiz istek." }, 400);
  }

  const username = normalizeUsername(body.username);
  const password = typeof body.password === "string" ? body.password : "";
  if (!validUsername(username) || !password || password.length > 128)
    return invalidCredentials();

  const { data: loginProfile, error: profileError } = await admin
    .from("user_login_profiles")
    .select("user_id")
    .ilike("username", username)
    .maybeSingle();

  if (profileError || !loginProfile) return invalidCredentials();

  const { data: userResult, error: userError } =
    await admin.auth.admin.getUserById(loginProfile.user_id);
  const email = userResult.user?.email;
  if (userError || !email) return invalidCredentials();

  const publishableKey =
    req.headers.get("apikey") || Deno.env.get("SUPABASE_ANON_KEY");
  if (!publishableKey)
    return json({ error: "Giriş yapılandırması eksik." }, 500);

  const authResponse = await fetch(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: { apikey: publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    },
  );

  if (!authResponse.ok) return invalidCredentials();
  const session = await authResponse.json();
  if (!session.access_token || !session.refresh_token)
    return invalidCredentials();

  return json({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
});

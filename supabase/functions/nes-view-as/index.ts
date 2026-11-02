import { createClient } from "npm:@supabase/supabase-js@2.110.7";

// Panel önizleme: yönetici bir taşeronun veya müşterinin panelini o kişinin
// gözünden görmek için tek kullanımlık giriş anahtarı ister.
//
// - Yalnız yönetici çağırabilir; hedef yalnız taşeron veya müşteri olabilir
//   (yönetici/teknik ofis hesapları önizlenemez).
// - Anahtar, Supabase'in kısa ömürlü, tek kullanımlık giriş bağlantısıdır;
//   e-posta gönderilmez, yalnız çağıran yöneticiye döner.
// - Her istek view_as_log tablosuna yazılır (kim, kimi, ne zaman).
// - Önizleme sekmesi tarayıcıda salt okunurdur (src/lib/preview-mode.ts).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Kötüye kullanım sınırı: bir yönetici 10 dakikada en fazla 20 önizleme.
const WINDOW_MS = 10 * 60 * 1000;
const LIMIT = 20;

function readAdminKey() {
  const secretKeysJson = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeysJson) {
    try {
      const keys = JSON.parse(secretKeysJson) as Record<string, string>;
      if (keys.default) return keys.default;
    } catch {
      // Eski anahtara geri dön.
    }
  }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!legacy) throw new Error("Sunucu anahtarı yapılandırılmamış.");
  return legacy;
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
      "Cache-Control": "no-store",
    },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST kullanın." }, 405);

  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer "))
    return json({ error: "Oturum gerekli." }, 401);
  const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userError } = await db.auth.getUser(
    authorization.slice("Bearer ".length).trim(),
  );
  if (userError || !userData.user)
    return json({ error: "Geçersiz oturum." }, 401);
  const { data: callerRole } = await db.rpc("get_my_app_role");
  if (callerRole !== "admin")
    return json({ error: "Panel önizleme yalnız yöneticiye açık." }, 403);

  let body: { user_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Geçersiz istek." }, 400);
  }
  const targetId = typeof body.user_id === "string" ? body.user_id : "";
  if (!UUID_RE.test(targetId))
    return json({ error: "Kullanıcı seçilmedi." }, 400);
  if (targetId === userData.user.id)
    return json({ error: "Kendi panelinizi zaten görüyorsunuz." }, 400);

  const { count } = await admin
    .from("view_as_log")
    .select("id", { count: "exact", head: true })
    .eq("admin_id", userData.user.id)
    .gte("created_at", new Date(Date.now() - WINDOW_MS).toISOString());
  if ((count ?? 0) >= LIMIT)
    return json(
      { error: "Çok sık önizleme açıldı; biraz sonra deneyin." },
      429,
    );

  const { data: roles } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", targetId);
  const roleSet = new Set((roles ?? []).map((r) => String(r.role)));
  if (roleSet.has("admin") || roleSet.has("technical_office"))
    return json(
      { error: "Yönetici ve teknik ofis hesapları önizlenemez." },
      403,
    );
  const role = roleSet.has("contractor")
    ? "contractor"
    : roleSet.has("customer")
      ? "customer"
      : null;
  if (!role)
    return json(
      { error: "Bu kullanıcının taşeron veya müşteri rolü yok." },
      400,
    );

  const { data: target, error: targetError } =
    await admin.auth.admin.getUserById(targetId);
  const email = target?.user?.email;
  if (targetError || !email)
    return json({ error: "Kullanıcının giriş hesabı bulunamadı." }, 404);
  if (
    target.user.banned_until &&
    new Date(target.user.banned_until) > new Date()
  )
    return json({ error: "Bu hesap kapalı." }, 400);

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) {
    console.error("Önizleme anahtarı üretilemedi:", linkError?.message);
    return json({ error: "Önizleme açılamadı." }, 500);
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("full_name")
    .eq("id", targetId)
    .maybeSingle();

  const { error: logError } = await admin.from("view_as_log").insert({
    admin_id: userData.user.id,
    target_user_id: targetId,
    target_role: role,
  });
  if (logError) {
    // Kayıt tutulamıyorsa önizleme de açılmaz.
    console.error("Önizleme kaydı yazılamadı:", logError.message);
    return json({ error: "Önizleme açılamadı." }, 500);
  }

  return json({
    token_hash: tokenHash,
    role,
    name: String(profile?.full_name ?? "").trim() || email.split("@")[0],
  });
});

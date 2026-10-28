import { createClient } from "npm:@supabase/supabase-js@2.110.7";

// Şifremi unuttum.
//
// Giriş ekranından kullanıcı adı veya e-posta ile çağrılır (oturum yok,
// verify_jwt kapalı). Hesap bulunursa Supabase'den tek kullanımlık şifre
// yenileme anahtarı üretilir ve bağlantı, bildirim e-postalarıyla aynı Resend
// hesabından NES adına gönderilir. Yanıt her durumda aynıdır; hesabın var olup
// olmadığı dışarıya açıklanmaz.
//
// Taşeron hesapları (@accounts.nesgrup.com) gerçek bir e-posta kutusuna sahip
// olmadığı için bu yoldan yenilenmez; şifreleri yönetici "Ekip ve Yetkiler"
// ekranından yeniler.
//
// Kötüye kullanım sınırı: aynı hesaba 5 dakikada en fazla 1, aynı ağ
// adresinden 1 saatte en fazla 5 istek.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const RESEND_FROM_EMAIL =
  Deno.env.get("RESEND_FROM_EMAIL") || "NES Enerji <onboarding@resend.dev>";
const APP_URL = (Deno.env.get("APP_URL") || "https://app.nesgrup.com").replace(
  /\/$/,
  "",
);
const SYNTHETIC_DOMAIN = "@accounts.nesgrup.com";
const USER_WINDOW_MS = 5 * 60 * 1000;
const IP_WINDOW_MS = 60 * 60 * 1000;
const IP_LIMIT = 5;

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

// Her durumda aynı yanıt.
const GENERIC = {
  ok: true,
  message:
    "Bu bilgilerle kayıtlı bir hesap varsa, hesabın e-posta adresine şifre yenileme bağlantısı gönderildi.",
};

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function clientIp(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for") || "";
  return (
    forwarded.split(",")[0].trim() || req.headers.get("cf-connecting-ip") || ""
  );
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function findUser(identifier: string) {
  if (identifier.includes("@")) {
    const email = identifier.toLowerCase();
    // Az sayıda kullanıcı olduğu için sayfalı liste yeterli.
    for (let page = 1; page <= 10; page += 1) {
      const { data, error } = await admin.auth.admin.listUsers({
        page,
        perPage: 200,
      });
      if (error) return null;
      const match = data.users.find((u) => u.email?.toLowerCase() === email);
      if (match) return match;
      if (data.users.length < 200) break;
    }
    return null;
  }
  if (!/^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])$/.test(identifier)) return null;
  const { data: profile } = await admin
    .from("user_login_profiles")
    .select("user_id")
    .ilike("username", identifier)
    .maybeSingle();
  if (!profile) return null;
  const { data } = await admin.auth.admin.getUserById(profile.user_id);
  return data.user ?? null;
}

function emailHtml(name: string, link: string) {
  const greeting = name ? `Merhaba ${escapeHtml(name)},` : "Merhaba,";
  return `<!doctype html><html lang="tr"><body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0;">
<tr><td style="background:#f8fafc;padding:18px 24px;border-bottom:1px solid #e2e8f0;font-size:16px;font-weight:800;color:#0f172a;letter-spacing:0.03em;">NES ENERJİ</td></tr>
<tr><td style="padding:28px 24px 8px;">
<h1 style="margin:0 0 12px;font-size:19px;font-weight:800;color:#0f172a;">Şifre yenileme</h1>
<p style="margin:0 0 14px;font-size:14px;line-height:22px;color:#0f172a;">${greeting}</p>
<p style="margin:0 0 18px;font-size:14px;line-height:22px;color:#0f172a;">NES Enerji İş Takip hesabınız için şifre yenileme talebi aldık. Yeni şifrenizi belirlemek için aşağıdaki düğmeye basın. Bağlantı <strong>1 saat</strong> geçerlidir ve yalnız bir kez kullanılabilir.</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:#1d4ed8;">
<a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;">Yeni şifre belirle</a>
</td></tr></table>
<p style="margin:18px 0 0;font-size:12px;line-height:18px;color:#64748b;">Bu talebi siz yapmadıysanız bu e-postayı dikkate almayın; şifreniz değişmez.</p>
</td></tr>
<tr><td style="padding:20px 24px 28px;"><p style="margin:0;font-size:12px;line-height:18px;color:#64748b;">Bu otomatik bir e-postadır, NES Enerji İş Takip tarafından gönderildi.</p></td></tr>
</table></td></tr></table></body></html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST kullanın." }, 405);

  let body: { identifier?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Geçersiz istek." }, 400);
  }
  const identifier =
    typeof body.identifier === "string"
      ? body.identifier.trim().toLowerCase()
      : "";
  if (!identifier || identifier.length > 160) return json(GENERIC);

  const ipHash = await sha256(`nes-recovery:${clientIp(req)}`);
  const now = Date.now();

  const { count: ipCount } = await admin
    .from("password_recovery_requests")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", new Date(now - IP_WINDOW_MS).toISOString());
  if ((ipCount ?? 0) >= IP_LIMIT) return json(GENERIC);

  const user = await findUser(identifier);
  const email = user?.email?.toLowerCase() ?? "";
  const eligible = Boolean(user && email && !email.endsWith(SYNTHETIC_DOMAIN));

  if (eligible && user) {
    const { count: userCount } = await admin
      .from("password_recovery_requests")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("sent", true)
      .gte("created_at", new Date(now - USER_WINDOW_MS).toISOString());
    if ((userCount ?? 0) > 0) {
      await admin
        .from("password_recovery_requests")
        .insert({ user_id: user.id, ip_hash: ipHash, sent: false });
      return json(GENERIC);
    }
  }

  let sent = false;
  if (eligible && user && RESEND_API_KEY) {
    const { data: linkData, error: linkError } =
      await admin.auth.admin.generateLink({ type: "recovery", email });
    const tokenHash = linkData?.properties?.hashed_token;
    if (linkError || !tokenHash) {
      console.error("Yenileme anahtarı üretilemedi:", linkError?.message);
    } else {
      const link = `${APP_URL}/sifre-yenile?token_hash=${encodeURIComponent(tokenHash)}`;
      const { data: profile } = await admin
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: RESEND_FROM_EMAIL,
          to: email,
          subject: "NES Enerji — Şifre yenileme",
          html: emailHtml(String(profile?.full_name ?? "").trim(), link),
        }),
      });
      sent = response.ok;
      if (!response.ok) {
        console.error(
          "Şifre yenileme e-postası gönderilemedi:",
          response.status,
          (await response.text()).slice(0, 300),
        );
      }
    }
  }

  await admin.from("password_recovery_requests").insert({
    user_id: eligible && user ? user.id : null,
    ip_hash: ipHash,
    sent,
  });

  return json(GENERIC);
});

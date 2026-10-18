import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.7";

// Teklif bağlantısını ya da keşif föyünü (PDF eki) e-postayla gönderir.
// Kullanıcı uygulamada alıcı, konu ve mesajı görüp "Gönder"e bastığında
// çalışır. Yanıtlar gönderen kullanıcının e-postasına gelir (reply-to).
// Yetki: teklif → finans yetkisi (yönetici); keşif → yönetici + teknik ofis.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const RESEND_FROM_EMAIL =
  Deno.env.get("RESEND_FROM_EMAIL") || "NES Enerji <onboarding@resend.dev>";
const RESEND_REPLY_TO = Deno.env.get("RESEND_REPLY_TO") || "info@nesgrup.com";
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
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

const esc = (v: string) =>
  v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const EMAIL_RE = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/;

type Body = {
  kind?: "offer" | "survey";
  offer_id?: string;
  to?: string[];
  cc?: string[];
  subject?: string;
  message?: string;
  link?: { url: string; label: string } | null;
  attachment?: {
    filename: string;
    content_base64: string;
    type: string;
  } | null;
};

function emailHtml(opts: {
  message: string;
  link: Body["link"];
  sender: string;
  origin: string;
}) {
  const paragraphs = opts.message
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="margin:0 0 14px;line-height:1.6">${esc(p).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");
  const button = opts.link
    ? `<p style="margin:22px 0"><a href="${esc(opts.link.url)}" style="display:inline-block;background:#0b4ea2;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px">${esc(opts.link.label)}</a></p><p style="margin:0 0 14px;font-size:12px;color:#6b7780">Düğme açılmazsa: ${esc(opts.link.url)}</p>`
    : "";
  return `<!doctype html><html lang="tr"><body style="margin:0;background:#f2f4f5;font-family:Arial,Helvetica,sans-serif;color:#1f2933">
<div style="max-width:600px;margin:0 auto;padding:24px">
<div style="background:#ffffff;border-radius:12px;padding:28px">
<img src="${esc(opts.origin)}/nes-enerji-logo.png" alt="NES Enerji" style="height:42px;margin-bottom:18px">
${paragraphs}${button}
<p style="margin:22px 0 0;line-height:1.5">Saygılarımızla,<br><b>${esc(opts.sender)}</b><br>NES Enerji · nesgrup.com · 0 (554) 610 24 16</p>
</div>
<p style="font-size:11px;color:#8a949b;text-align:center;margin-top:14px">Bu e-postayı yanıtlayarak bize doğrudan ulaşabilirsiniz.</p>
</div></body></html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Yalnız POST." }, 405);
  if (!RESEND_API_KEY)
    return json({ error: "E-posta gönderimi yapılandırılmamış." }, 503);

  const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: { Authorization: req.headers.get("Authorization") ?? "" },
    },
    auth: { persistSession: false },
  });
  const { data: auth, error: authError } = await db.auth.getUser();
  if (authError || !auth.user) return json({ error: "Oturum gerekli." }, 401);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Geçersiz istek." }, 400);
  }
  const kind = body.kind === "offer" ? "offer" : "survey";
  const permission =
    kind === "offer" ? "can_manage_finance" : "can_manage_projects";
  const { data: allowed } = await db.rpc(permission, {
    target_user_id: auth.user.id,
  });
  if (!allowed) return json({ error: "Bu gönderim için yetkiniz yok." }, 403);

  const clean = (list: unknown) =>
    (Array.isArray(list) ? list : [])
      .map((v) => String(v).trim().toLowerCase())
      .filter(Boolean);
  const to = clean(body.to);
  const cc = clean(body.cc);
  if (to.length === 0) return json({ error: "Alıcı e-postası yazın." }, 400);
  if (to.length + cc.length > 8)
    return json({ error: "En fazla 8 alıcı." }, 400);
  const bad = [...to, ...cc].find((e) => !EMAIL_RE.test(e));
  if (bad) return json({ error: `Geçersiz e-posta: ${bad}` }, 400);

  const subject = String(body.subject ?? "")
    .trim()
    .slice(0, 200);
  const message = String(body.message ?? "")
    .trim()
    .slice(0, 5000);
  if (!subject) return json({ error: "Konu yazın." }, 400);

  let link: Body["link"] = null;
  if (body.link?.url) {
    try {
      const u = new URL(body.link.url);
      if (u.protocol !== "https:") throw new Error();
      link = {
        url: u.toString(),
        label: String(body.link.label || "Teklifi görüntüle").slice(0, 60),
      };
    } catch {
      return json({ error: "Bağlantı geçersiz." }, 400);
    }
  }

  const attachments: { filename: string; content: string }[] = [];
  if (body.attachment?.content_base64) {
    const size = Math.floor((body.attachment.content_base64.length * 3) / 4);
    if (size > MAX_ATTACHMENT_BYTES)
      return json({ error: "Ek dosya 8 MB'tan büyük." }, 400);
    const filename = String(body.attachment.filename || "belge.pdf")
      .replace(/[^\wçğıöşüÇĞİÖŞÜ .-]+/g, "_")
      .slice(0, 120);
    attachments.push({ filename, content: body.attachment.content_base64 });
  }

  const { data: profile } = await db
    .from("profiles")
    .select("full_name")
    .eq("id", auth.user.id)
    .maybeSingle();
  const sender = profile?.full_name || "NES Enerji";
  const replyTo = auth.user.email?.endsWith("@nesgrup.com")
    ? auth.user.email
    : RESEND_REPLY_TO;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to,
      cc: cc.length ? cc : undefined,
      reply_to: replyTo,
      subject,
      html: emailHtml({
        message,
        link,
        sender,
        origin: "https://app.nesgrup.com",
      }),
      attachments: attachments.length ? attachments : undefined,
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    console.error("Resend hatası", response.status, detail);
    return json({ error: `E-posta gönderilemedi (${response.status}).` }, 502);
  }
  const result = (await response.json().catch(() => ({}))) as { id?: string };

  // Teklif e-postayla gittiyse taslak durumu "gönderildi" olur.
  if (kind === "offer" && body.offer_id) {
    await db
      .from("offers")
      .update({ status: "sent" })
      .eq("id", body.offer_id)
      .eq("status", "draft");
  }
  return json({ success: true, id: result.id ?? null });
});

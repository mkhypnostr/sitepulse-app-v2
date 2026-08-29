import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Bu fonksiyon yalnızca Postgres tetikleyicileri tarafından, aynı
// veritabanındaki vault.secrets içinde saklanan paylaşılan bir anahtarla
// çağrılır (bkz. supabase/migrations/20260808100000_whatsapp_notification_system.sql).
// send-notification-email ile aynı paylaşılan anahtarı (notification_webhook_secret)
// kullanır — ikisi de yalnızca dahili tetikleyici çağrıları için var.
const WEBHOOK_SECRET = Deno.env.get("NOTIFICATION_WEBHOOK_SECRET");
// Account SID kendi başına gizli olmasa da GitHub secret-scanning bunu bir
// Twilio kimliği olarak tanıyıp push'u engelliyor; bu yüzden koda gömmek
// yerine diğer Twilio değerleriyle birlikte secret olarak tutuluyor.
const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
// Twilio WhatsApp sandbox numarası; kendi onaylı WhatsApp gönderen numaranız
// olduğunda TWILIO_WHATSAPP_FROM secret'ını değiştirin.
const TWILIO_WHATSAPP_FROM =
  Deno.env.get("TWILIO_WHATSAPP_FROM") || "whatsapp:+14155238886";

type Recipient = { phone: string; name?: string | null };

type NotificationPayload = {
  message: string;
  recipients: Recipient[];
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

// Profil numaraları E.164 saklanıyor; teknik servis formunda müşterinin
// 05xx xxx xx xx biçiminde giriş yapması da desteklenir.
function toWhatsAppAddress(rawPhone: string): string | null {
  let digits = rawPhone.trim().replace(/\D/g, "");

  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) {
    digits = `90${digits.slice(1)}`;
  } else if (digits.length === 10 && digits.startsWith("5")) {
    digits = `90${digits}`;
  }

  if (!/^\d{8,15}$/.test(digits) || digits.startsWith("0")) return null;
  return `whatsapp:+${digits}`;
}

// Loglarda tam numarayı göstermemek için: ülke kodu + ilk 2, son 2 hane
// görünür kalır, ortası yıldızlanır. Örn. whatsapp:+905061457588 -> +9050******88
function maskAddress(address: string): string {
  const digits = address.replace(/\D/g, "");
  if (digits.length < 6) return "***";
  const start = digits.slice(0, 4);
  const end = digits.slice(-2);
  const stars = "*".repeat(Math.max(digits.length - 6, 0));
  return `+${start}${stars}${end}`;
}

async function sendViaTwilio(toAddress: string, body: string) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    throw new Error(
      "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN yapılandırılmamış.",
    );
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const form = new URLSearchParams({
    From: TWILIO_WHATSAPP_FROM,
    To: toAddress,
    Body: body,
  });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  const responseText = await response.text();

  if (!response.ok) {
    console.error("Twilio API hatası:", {
      to: maskAddress(toAddress),
      status: response.status,
      body: responseText,
    });
    throw new Error(`Twilio API hatası (${response.status}): ${responseText}`);
  }

  // Twilio 201 döndürse bile mesaj kuyruğa alınmış olabilir; sid/status ve
  // varsa error_code/error_message'ı ayrıca logla — "200 ama aslında
  // gitmedi" durumlarını (örn. sandbox oturumu kapanmış) görünür kılmak için.
  let parsed: {
    sid?: string;
    status?: string;
    error_code?: unknown;
    error_message?: unknown;
  } = {};
  try {
    parsed = JSON.parse(responseText);
  } catch {
    // Twilio her zaman JSON döner; parse edilemezse ham metni logla.
  }
  console.log("Twilio mesajı kabul edildi:", {
    to: maskAddress(toAddress),
    sid: parsed.sid ?? null,
    status: parsed.status ?? null,
    error_code: parsed.error_code ?? null,
    error_message: parsed.error_message ?? null,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST kullanın." }, 405);

  if (
    !WEBHOOK_SECRET ||
    req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET
  ) {
    return json({ error: "Yetkisiz." }, 401);
  }
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    console.error(
      "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN yapılandırılmamış; WhatsApp mesajı gönderilemedi.",
    );
    return json({ error: "WhatsApp gönderimi yapılandırılmamış." }, 500);
  }

  let payload: NotificationPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Geçersiz istek gövdesi." }, 400);
  }

  const message =
    typeof payload.message === "string" ? payload.message.trim() : "";
  const recipients = Array.isArray(payload.recipients)
    ? payload.recipients
    : [];
  console.log(`WhatsApp bildirim isteği alındı: ${recipients.length} alıcı.`);
  if (!message || recipients.length === 0)
    return json({ sent: 0, failed: 0, errors: [] });

  const results = await Promise.allSettled(
    recipients.map(async (recipient) => {
      const address =
        typeof recipient?.phone === "string"
          ? toWhatsAppAddress(recipient.phone)
          : null;
      if (!address)
        throw new Error(`Geçersiz telefon numarası: ${recipient?.phone}`);
      await sendViaTwilio(address, message);
    }),
  );

  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failures.length > 0) {
    for (const failure of failures) {
      console.error("WhatsApp bildirimi gönderilemedi:", failure.reason);
    }
  }

  return json({
    sent: recipients.length - failures.length,
    failed: failures.length,
    errors: failures.map((failure) => String(failure.reason)),
  });
});

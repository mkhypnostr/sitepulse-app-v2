import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Bu fonksiyon yalnızca veritabanı tetikleyicileri tarafından, Vault ve Edge
// Function secret'larında ortak tutulan anahtarla çağrılır.
const WEBHOOK_SECRET = Deno.env.get("NOTIFICATION_WEBHOOK_SECRET");
const META_ACCESS_TOKEN = Deno.env.get("META_WHATSAPP_ACCESS_TOKEN");
const META_PHONE_NUMBER_ID = Deno.env.get("META_WHATSAPP_PHONE_NUMBER_ID");
const META_GRAPH_VERSION =
  Deno.env.get("META_WHATSAPP_GRAPH_VERSION") || "v26.0";
const META_TEMPLATE_LANGUAGE =
  Deno.env.get("META_WHATSAPP_TEMPLATE_LANGUAGE") || "tr";

const templateNames = {
  technical_service_created:
    Deno.env.get("META_WHATSAPP_TEMPLATE_TECHNICAL_SERVICE_CREATED") ||
    "nes_teknik_servis_yeni",
  technical_service_updated:
    Deno.env.get("META_WHATSAPP_TEMPLATE_TECHNICAL_SERVICE_UPDATED") ||
    "nes_teknik_servis_guncelleme",
} as const;

type EventName = keyof typeof templateNames;
type Recipient = { phone: string; name?: string | null };
type NotificationPayload = {
  event: EventName;
  parameters: unknown[];
  recipients: Recipient[];
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function toE164Digits(rawPhone: string): string | null {
  let digits = rawPhone.trim().replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);

  if (digits.length === 11 && digits.startsWith("0")) {
    digits = "90" + digits.slice(1);
  } else if (digits.length === 10 && digits.startsWith("5")) {
    digits = "90" + digits;
  }

  if (!/^\d{8,15}$/.test(digits) || digits.startsWith("0")) return null;
  return digits;
}

function maskPhone(digits: string) {
  if (digits.length < 6) return "***";
  return (
    "+" +
    digits.slice(0, 4) +
    "*".repeat(Math.max(digits.length - 6, 0)) +
    digits.slice(-2)
  );
}

function normalizeParameter(value: unknown) {
  if (value == null) return "—";
  const text = String(value).trim();
  return (text || "—").slice(0, 1024);
}

async function sendViaMeta(
  to: string,
  event: EventName,
  parameters: string[],
) {
  const url =
    "https://graph.facebook.com/" +
    META_GRAPH_VERSION +
    "/" +
    META_PHONE_NUMBER_ID +
    "/messages";
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + META_ACCESS_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "template",
      template: {
        name: templateNames[event],
        language: { code: META_TEMPLATE_LANGUAGE },
        components: [
          {
            type: "body",
            parameters: parameters.map((text) => ({ type: "text", text })),
          },
        ],
      },
    }),
  });

  const responseText = await response.text();
  let parsed: {
    messages?: Array<{ id?: string }>;
    error?: {
      message?: string;
      code?: number;
      error_subcode?: number;
      fbtrace_id?: string;
    };
  } = {};

  try {
    parsed = JSON.parse(responseText);
  } catch {
    // Meta normalde JSON döndürür; ham yanıt telefon veya token içerebileceği
    // için loglara yazılmaz.
  }

  if (!response.ok) {
    console.error("Meta WhatsApp API hatası:", {
      to: maskPhone(to),
      event,
      status: response.status,
      code: parsed.error?.code ?? null,
      subcode: parsed.error?.error_subcode ?? null,
      message: parsed.error?.message ?? "Yanıt ayrıştırılamadı",
      trace: parsed.error?.fbtrace_id ?? null,
    });
    throw new Error("Meta WhatsApp API hatası (" + response.status + ").");
  }

  console.log("Meta WhatsApp şablon mesajı kabul edildi:", {
    to: maskPhone(to),
    event,
    template: templateNames[event],
    message_id: parsed.messages?.[0]?.id ?? null,
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

  if (!META_ACCESS_TOKEN || !META_PHONE_NUMBER_ID) {
    console.error(
      "META_WHATSAPP_ACCESS_TOKEN / META_WHATSAPP_PHONE_NUMBER_ID yapılandırılmamış.",
    );
    return json({ error: "Meta WhatsApp gönderimi yapılandırılmamış." }, 500);
  }

  if (!/^v\d+\.\d+$/.test(META_GRAPH_VERSION)) {
    return json({ error: "Geçersiz Meta Graph API sürümü." }, 500);
  }

  let payload: NotificationPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Geçersiz istek gövdesi." }, 400);
  }

  if (
    typeof payload?.event !== "string" ||
    !(payload.event in templateNames)
  ) {
    return json({ error: "Desteklenmeyen bildirim olayı." }, 400);
  }

  const recipients = Array.isArray(payload.recipients)
    ? payload.recipients.slice(0, 20)
    : [];
  const parameters = Array.isArray(payload.parameters)
    ? payload.parameters.map(normalizeParameter)
    : [];

  if (recipients.length === 0 || parameters.length === 0) {
    return json({ sent: 0, failed: 0, errors: [] });
  }

  const uniqueRecipients = new Map<string, Recipient>();
  for (const recipient of recipients) {
    if (typeof recipient?.phone !== "string") continue;
    const phone = toE164Digits(recipient.phone);
    if (phone && !uniqueRecipients.has(phone)) {
      uniqueRecipients.set(phone, recipient);
    }
  }

  const targets = [...uniqueRecipients.keys()];
  const results = await Promise.allSettled(
    targets.map((phone) =>
      sendViaMeta(phone, payload.event as EventName, parameters),
    ),
  );

  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  for (const failure of failures) {
    console.error("Meta WhatsApp bildirimi gönderilemedi:", String(failure.reason));
  }

  return json({
    sent: targets.length - failures.length,
    failed: failures.length,
    invalid_recipients: recipients.length - targets.length,
    errors: failures.map(() => "Mesaj gönderilemedi."),
  });
});

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Bu fonksiyon yalnızca Postgres tetikleyicileri/pg_cron tarafından, aynı
// veritabanındaki vault.secrets içinde saklanan paylaşılan bir anahtarla
// çağrılır (bkz. supabase/migrations/20260807130000_notification_email_system.sql).
// Tarayıcıdan veya normal kullanıcı JWT'siyle çağrılmak üzere tasarlanmamıştır,
// bu yüzden verify_jwt kapalı ve yetkilendirme bu paylaşılan anahtarla yapılır.
const WEBHOOK_SECRET = Deno.env.get("NOTIFICATION_WEBHOOK_SECRET");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "NES Enerji <onboarding@resend.dev>";
// Ayarlanırsa e-postalarda gerçek NES Enerji logosu (PNG) gösterilir; aksi halde
// marka renkleriyle metin tabanlı bir başlık kullanılır (dış görsele bağımlı değildir).
const PUBLIC_APP_URL = Deno.env.get("PUBLIC_APP_URL");

const BRAND = {
  darkBg: "#0c0c14",
  cardBg: "#111120",
  border: "#1a1a28",
  primary: "#1d4ed8",
  text: "#0f172a",
  muted: "#64748b",
};

type Recipient = { email: string; name?: string | null };

type NotificationPayload = {
  event_type: "task_assigned" | "task_overdue" | "approval_pending" | "approval_decision";
  recipients: Recipient[];
  data: Record<string, unknown>;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderLogoHeader(): string {
  if (PUBLIC_APP_URL) {
    return `<img src="${escapeHtml(PUBLIC_APP_URL)}/nes-enerji-logo.png" alt="NES Enerji" height="32" style="display:block;height:32px;width:auto;" />`;
  }
  return `<span style="font-size:20px;font-weight:900;color:#ffffff;letter-spacing:-0.01em;">NES ENERJİ</span>`;
}

function renderShell(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="tr">
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0;">
            <tr>
              <td style="background:${BRAND.darkBg};padding:20px 24px;">
                ${renderLogoHeader()}
              </td>
            </tr>
            <tr>
              <td style="padding:28px 24px 8px;">
                <h1 style="margin:0 0 12px;font-size:19px;font-weight:800;color:${BRAND.text};">${escapeHtml(title)}</h1>
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 24px 28px;">
                <p style="margin:0;font-size:12px;line-height:18px;color:${BRAND.muted};">
                  Bu otomatik bir bildirimdir, NES Enerji Saha Operasyon Sistemi tarafından gönderildi.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 14px;font-size:14px;line-height:22px;color:${BRAND.text};">${text}</p>`;
}

function infoRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:6px 0;font-size:12px;font-weight:700;color:${BRAND.muted};text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(label)}</td>
  </tr>
  <tr>
    <td style="padding:0 0 12px;font-size:15px;font-weight:700;color:${BRAND.text};">${escapeHtml(value)}</td>
  </tr>`;
}

function buildEmail(
  eventType: NotificationPayload["event_type"],
  recipient: Recipient,
  data: Record<string, unknown>,
): { subject: string; html: string } {
  const greetingName = recipient.name?.trim();
  const greeting = greetingName ? `Merhaba ${escapeHtml(greetingName)},` : "Merhaba,";
  const taskName = String(data.taskName ?? "Görev");

  switch (eventType) {
    case "task_assigned": {
      const date = data.date ? String(data.date) : null;
      const subject = `Size yeni bir görev atandı: ${taskName}`;
      const html = renderShell(
        "Yeni görev atandı",
        `${paragraph(greeting)}${paragraph(
          `Size yeni bir görev atandı: <strong>${escapeHtml(taskName)}</strong>${
            date ? `, tarih: <strong>${escapeHtml(date)}</strong>` : ""
          }.`,
        )}`,
      );
      return { subject, html };
    }
    case "task_overdue": {
      const contractorName = String(data.contractorName ?? "Atanmamış");
      const subject = `Geciken görev: ${taskName}`;
      const html = renderShell(
        "Geciken görev uyarısı",
        `${paragraph(greeting)}${paragraph(
          `Aşağıdaki görevin planlanan tarihi geçti ve henüz tamamlanmadı:`,
        )}<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${infoRow("Görev", taskName)}
          ${infoRow("Taşeron", contractorName)}
        </table>`,
      );
      return { subject, html };
    }
    case "approval_pending": {
      const subject = `Onay bekleyen kayıt: ${taskName}`;
      const html = renderShell(
        "Onay bekleyen kayıt",
        `${paragraph(greeting)}${paragraph(
          `Onayınızı bekleyen yeni bir kayıt var: <strong>${escapeHtml(taskName)}</strong>.`,
        )}${paragraph("Onay Merkezi üzerinden inceleyip karar verebilirsiniz.")}`,
      );
      return { subject, html };
    }
    case "approval_decision": {
      const approved = data.decision === "approved";
      const note = data.note ? String(data.note) : null;
      const subject = approved ? `Kaydınız onaylandı: ${taskName}` : `Revizyon istendi: ${taskName}`;
      const html = renderShell(
        approved ? "Kaydınız onaylandı" : "Revizyon istendi",
        `${paragraph(greeting)}${paragraph(
          approved
            ? `<strong>${escapeHtml(taskName)}</strong> kaydınız onaylandı.`
            : `<strong>${escapeHtml(taskName)}</strong> kaydınız revizyon için geri gönderildi.`,
        )}${note ? paragraph(`<em>Not:</em> ${escapeHtml(note)}`) : ""}`,
      );
      return { subject, html };
    }
    default:
      return { subject: taskName, html: renderShell(taskName, paragraph(greeting)) };
  }
}

async function sendViaResend(to: string, subject: string, html: string) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: RESEND_FROM_EMAIL, to, subject, html }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend API hatası (${response.status}): ${body}`);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST kullanın." }, 405);

  if (!WEBHOOK_SECRET || req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return json({ error: "Yetkisiz." }, 401);
  }
  if (!RESEND_API_KEY) {
    console.error("RESEND_API_KEY yapılandırılmamış; e-posta gönderilemedi.");
    return json({ error: "E-posta gönderimi yapılandırılmamış." }, 500);
  }

  let payload: NotificationPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Geçersiz istek gövdesi." }, 400);
  }

  const recipients = Array.isArray(payload.recipients) ? payload.recipients : [];
  const validRecipients = recipients.filter(
    (item): item is Recipient => typeof item?.email === "string" && item.email.includes("@"),
  );
  if (validRecipients.length === 0) return json({ sent: 0 });

  const results = await Promise.allSettled(
    validRecipients.map(async (recipient) => {
      const { subject, html } = buildEmail(payload.event_type, recipient, payload.data ?? {});
      await sendViaResend(recipient.email, subject, html);
    }),
  );

  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length > 0) {
    for (const failure of failures) {
      console.error("Bildirim e-postası gönderilemedi:", (failure as PromiseRejectedResult).reason);
    }
  }

  return json({ sent: validRecipients.length - failures.length, failed: failures.length });
});

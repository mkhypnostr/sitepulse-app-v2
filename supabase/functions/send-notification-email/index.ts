import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Bu fonksiyon yalnızca Postgres tetikleyicileri/pg_cron tarafından, aynı
// veritabanındaki vault.secrets içinde saklanan paylaşılan bir anahtarla
// çağrılır (bkz. supabase/migrations/20260807130000_notification_email_system.sql).
// Tarayıcıdan veya normal kullanıcı JWT'siyle çağrılmak üzere tasarlanmamıştır,
// bu yüzden verify_jwt kapalı ve yetkilendirme bu paylaşılan anahtarla yapılır.
const WEBHOOK_SECRET = Deno.env.get("NOTIFICATION_WEBHOOK_SECRET");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
// nesgrup.com domaini Resend'de doğrulanana kadar bildirim@nesgrup.com'dan
// gönderim Resend tarafından reddedilir. Bu yüzden varsayılan (secret
// ayarlanmamışken) gönderici Resend'in kendi doğrulanmış test adresidir;
// bildirim@nesgrup.com yalnızca RESEND_FROM_EMAIL secret'ı Supabase'de
// gerçekten ayarlandığında kullanılır (domain doğrulandıktan sonra).
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "NES Enerji <onboarding@resend.dev>";
const RESEND_REPLY_TO = Deno.env.get("RESEND_REPLY_TO") || "info@nesgrup.com";
// Kalıcı, herkese açık HTTPS logo URL'i — projenin kendi Supabase Storage
// public bucket'ında barındırılıyor (bkz.
// supabase/migrations/20260809110000_brand_assets_public_bucket.sql).
// LOGO_URL secret'ı ayarlanırsa (ör. kendi domaininize taşındığınızda) onu kullanır.
// NOT: Storage'daki SVG'nin kendisinde beyaz, yuvarlak köşeli bir arka plan
// (rx=108'lik <rect fill="#ffffff">) gömülü; e-posta header'ının zemini de
// açık renk olduğundan bu neredeyse görünmez ama bazı istemcilerde hafif bir
// "kapsül" kenarı sezilebiliyor. Bu, imaj dosyasının kendisinde; burada
// yükseklik/genişlik ayarıyla giderilemez — asıl düzeltme SVG'nin şeffaf
// zeminli bir sürümle Storage'da değiştirilmesini gerektirir.
const LOGO_URL =
  Deno.env.get("LOGO_URL") ||
  "https://nyfocdnlbknxpxbeeapj.supabase.co/storage/v1/object/public/brand-assets/nes-enerji-logo.svg";

const TIME_ZONE = "Europe/Istanbul";

const BRAND = {
  headerBg: "#f8fafc",
  cardBg: "#111120",
  border: "#1a1a28",
  primary: "#1d4ed8",
  text: "#0f172a",
  muted: "#64748b",
};

type Recipient = { email: string; name?: string | null };

type NotificationPayload = {
  // work_order_assigned / work_order_overdue: work_orders kaynaklı atama ve
  // gecikme bildirimleri — metinde yalnızca "iş emri" geçer.
  // task_assigned / task_overdue: project_tasks ve operational_tasks kaynaklı
  // bildirimler — metinde "görev" geçmeye devam eder. Ayrım event_type
  // üzerinden yapılır, tüm bildirimlerin ortak metni değiştirilmez.
  event_type:
    | "task_assigned"
    | "task_overdue"
    | "work_order_assigned"
    | "work_order_overdue"
    | "approval_pending"
    | "approval_decision";
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

// Postgres tarafı artık önceden biçimlendirilmiş metin yerine ham ISO 8601
// zaman damgası gönderiyor; biçimlendirme burada, Europe/Istanbul saat
// diliminde yapılıyor (veritabanı/oturum saat dilimine bağımlı olmadan).
function formatIstanbul(iso: unknown): string | null {
  if (typeof iso !== "string" || !iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

// Tablo tabanlı düzen: Outlook masaüstü (Word render motoru) flexbox/inline-block
// hizalamayı desteklemiyor, bu yüzden logo + "NES ENERJİ" yazısı tek satırlık bir
// <table> ile yan yana ve dikeyde ortalanmış olarak yerleştirilir. Görsele hem HTML
// width/height özniteliği hem eşleşen inline stil verilir; bazı istemciler stil
// etiketlerini/CSS'i kırptığı için yalnızca birine güvenmek logonun gerilip
// bozulmasına yol açabilir.
function renderLogoHeader(): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td style="vertical-align:middle;padding:0;">
        <img
          src="${escapeHtml(LOGO_URL)}"
          alt="NES Enerji"
          width="91"
          height="28"
          style="display:block;width:91px;height:28px;border:0;outline:none;text-decoration:none;"
        />
      </td>
      <td style="vertical-align:middle;padding:0 0 0 10px;">
        <span style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:16px;font-weight:800;color:${BRAND.text};letter-spacing:0.03em;white-space:nowrap;">NES ENERJİ</span>
      </td>
    </tr>
  </table>`;
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
              <td style="background:${BRAND.headerBg};padding:18px 24px;border-bottom:1px solid #e2e8f0;">
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
  const isWorkOrderEvent = eventType === "work_order_assigned" || eventType === "work_order_overdue";
  const taskName = String(data.taskName ?? (isWorkOrderEvent ? "İş Emri" : "Görev"));

  switch (eventType) {
    case "task_assigned": {
      // Atama zamanı (bildirimin tetiklendiği an) ile planlanan başlangıç/
      // bitiş ayrı alanlar olarak gösterilir — birbirine karıştırılmaz.
      const assignedAt = formatIstanbul(data.assignedAt);
      const plannedStart = formatIstanbul(data.plannedStart);
      const plannedEnd = formatIstanbul(data.plannedEnd);
      const subject = `Size yeni bir görev atandı: ${taskName}`;
      const html = renderShell(
        "Yeni görev atandı",
        `${paragraph(greeting)}${paragraph(
          `Size yeni bir görev atandı: <strong>${escapeHtml(taskName)}</strong>.`,
        )}<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${assignedAt ? infoRow("Atama Zamanı", assignedAt) : ""}
          ${plannedStart ? infoRow("Planlanan Başlangıç", plannedStart) : ""}
          ${plannedEnd ? infoRow("Planlanan Bitiş", plannedEnd) : ""}
        </table>`,
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
    case "work_order_assigned": {
      // Alıcı bağlamına göre metin: iş emrinin gerçek sorumlusuna/atanan
      // kişiye "size atandı" dili; sorumlu olmayan adminlere "X'e atandı"
      // dili. Aynı kişi hem admin hem atanansa (recipients listesi çağıran
      // tarafta zaten tekilleştirilmiş olur, bkz. Deno.serve) bu karşılaştırma
      // isAssignee=true verir ve atanan kişi metni kullanılır.
      const assigneeEmail = typeof data.assigneeEmail === "string" ? data.assigneeEmail.trim().toLowerCase() : "";
      const isAssignee = assigneeEmail !== "" && recipient.email.trim().toLowerCase() === assigneeEmail;
      const assigneeName = data.assigneeName ? String(data.assigneeName) : "İlgili kullanıcı";
      const assignedAt = formatIstanbul(data.assignedAt);
      const plannedStart = formatIstanbul(data.plannedStart);
      const plannedEnd = formatIstanbul(data.plannedEnd);
      const location = data.location ? String(data.location) : null;
      const subject = isAssignee ? `Size yeni iş emri atandı: ${taskName}` : `Yeni iş emri atandı: ${taskName}`;
      const description = isAssignee
        ? `Size yeni bir iş emri atandı: <strong>${escapeHtml(taskName)}</strong>.`
        : `<strong>${escapeHtml(assigneeName)}</strong> adlı kullanıcıya yeni bir iş emri atandı: <strong>${escapeHtml(taskName)}</strong>.`;
      const html = renderShell(
        "Yeni iş emri atandı",
        `${paragraph(greeting)}${paragraph(description)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${assignedAt ? infoRow("Atama Zamanı", assignedAt) : ""}
          ${plannedStart ? infoRow("Planlanan Başlangıç", plannedStart) : ""}
          ${plannedEnd ? infoRow("Planlanan Bitiş", plannedEnd) : ""}
          ${location ? infoRow("Lokasyon", location) : ""}
        </table>`,
      );
      return { subject, html };
    }
    case "work_order_overdue": {
      const contractorName = String(data.contractorName ?? "Atanmamış");
      const subject = `Geciken iş emri: ${taskName}`;
      const html = renderShell(
        "Geciken iş emri uyarısı",
        `${paragraph(greeting)}${paragraph(
          `Aşağıdaki iş emrinin planlanan tarihi geçti ve henüz tamamlanmadı:`,
        )}<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${infoRow("İş Emri", taskName)}
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
    body: JSON.stringify({ from: RESEND_FROM_EMAIL, to, subject, html, reply_to: RESEND_REPLY_TO }),
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
  // Aynı kullanıcıya (aynı e-posta) çift bildirim gitmemesi için, çağıran
  // taraf farklı roller nedeniyle aynı adresi birden fazla kez eklemiş olsa
  // bile burada büyük/küçük harf duyarsız şekilde tekilleştirilir.
  const seenEmails = new Set<string>();
  const validRecipients = recipients.filter((item): item is Recipient => {
    if (typeof item?.email !== "string" || !item.email.includes("@")) return false;
    const key = item.email.trim().toLowerCase();
    if (seenEmails.has(key)) return false;
    seenEmails.add(key);
    return true;
  });
  if (validRecipients.length === 0) return json({ sent: 0 });

  const results = await Promise.allSettled(
    validRecipients.map(async (recipient) => {
      const { subject, html } = buildEmail(payload.event_type, recipient, payload.data ?? {});
      await sendViaResend(recipient.email, subject, html);
    }),
  );

  const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failures.length > 0) {
    for (const failure of failures) {
      console.error("Bildirim e-postası gönderilemedi:", failure.reason);
    }
  }

  return json({
    sent: validRecipients.length - failures.length,
    failed: failures.length,
    errors: failures.map((failure) => String(failure.reason)),
  });
});

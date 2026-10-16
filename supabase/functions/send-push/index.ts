import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import webpush from "npm:web-push@3.6.7";

// Telefona/bilgisayara anlık bildirim (web push).
//
// Yalnızca veritabanındaki send_push_notification() tarafından, e-posta
// bildirimleriyle aynı paylaşılan anahtarla (NOTIFICATION_WEBHOOK_SECRET)
// çağrılır; tarayıcıdan çağrılmak üzere tasarlanmadı (verify_jwt kapalı).
// Abonelikler push_subscriptions tablosundan okunur; tarayıcının "artık yok"
// dediği (404/410) abonelikler silinir.
//
// VAPID özel anahtarı Vault'ta ('push_vapid_private_key'); isteğe bağlı
// VAPID_PRIVATE_KEY / VAPID_SUBJECT ortam değişkenleri önceliklidir.

const WEBHOOK_SECRET = Deno.env.get("NOTIFICATION_WEBHOOK_SECRET");
// Genel anahtar gizli değildir (uygulamadaki src/lib/push.ts ile aynı).
const VAPID_PUBLIC_KEY =
  Deno.env.get("VAPID_PUBLIC_KEY") ||
  "BLJ8dRTa4pZZ7FlyAHKvJi_N9egy-0yTr9l44txDJUGIRSYkUmcgbpU5YxSp69JcNhHMSyonCQPkTb33yxhbOe0";
// Özel anahtar: önce ortam değişkeni, yoksa Vault (get_push_vapid_private_key).
let VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? null;
const VAPID_SUBJECT =
  Deno.env.get("VAPID_SUBJECT") || "mailto:info@nesgrup.com";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Payload = {
  event_type: string;
  user_ids: string[];
  data?: Record<string, unknown>;
};

type Message = { title: string; body: string; url: string; tag: string };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function text(value: unknown, fallback: string) {
  const s = typeof value === "string" ? value.trim() : "";
  return s || fallback;
}

/** E-posta bildirimleriyle aynı olay türleri; kısa telefon metni. */
function buildMessage(
  eventType: string,
  data: Record<string, unknown>,
): Message {
  const isWorkOrder = eventType.startsWith("work_order");
  const name = text(data.taskName, isWorkOrder ? "İş emri" : "Görev");
  switch (eventType) {
    case "task_assigned":
      return {
        title: "Yeni görev",
        body: name,
        url: "/tasks",
        tag: `task-${name}`,
      };
    case "task_overdue":
      return {
        title: "Geciken görev",
        body: `${name}${data.contractorName ? ` · ${text(data.contractorName, "")}` : ""}`,
        url: "/tasks",
        tag: `overdue-${name}`,
      };
    case "work_order_assigned":
      return {
        title: "Yeni iş emri",
        body: name,
        url: "/tasks",
        tag: `wo-${name}`,
      };
    case "work_order_overdue":
      return {
        title: "Geciken iş emri",
        body: `${name}${data.contractorName ? ` · ${text(data.contractorName, "")}` : ""}`,
        url: "/tasks",
        tag: `wo-overdue-${name}`,
      };
    case "approval_pending":
      return {
        title: "Onay bekleyen kayıt",
        body: name,
        url: "/approvals",
        tag: `approval-${name}`,
      };
    case "approval_decision": {
      const approved = data.decision === "approved";
      return {
        title: approved ? "Kaydınız onaylandı" : "Revizyon istendi",
        body: name,
        url: "/approvals",
        tag: `decision-${name}`,
      };
    }
    case "test":
      return {
        title: "NES Enerji",
        body: "Bildirimler bu cihazda açık. Görev, onay ve gecikmeler buraya gelecek.",
        url: "/profile",
        tag: "test",
      };
    default:
      return {
        title: "NES Enerji",
        body: name,
        url: "/dashboard",
        tag: eventType,
      };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST kullanın." }, 405);
  if (
    !WEBHOOK_SECRET ||
    req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET
  ) {
    return json({ error: "Yetkisiz." }, 401);
  }
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  if (!VAPID_PRIVATE_KEY) {
    const { data } = await admin.rpc("get_push_vapid_private_key");
    VAPID_PRIVATE_KEY = typeof data === "string" && data ? data : null;
  }
  if (!VAPID_PRIVATE_KEY) {
    console.error("VAPID özel anahtarı yok; bildirim gönderilemedi.");
    return json({ error: "Bildirim yapılandırılmamış." }, 500);
  }

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Geçersiz istek gövdesi." }, 400);
  }
  const userIds = Array.isArray(payload.user_ids)
    ? payload.user_ids.filter((id) => typeof id === "string")
    : [];
  if (userIds.length === 0) return json({ sent: 0 });

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  const { data: subs, error } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth, failure_count")
    .in("user_id", userIds);
  if (error) {
    console.error("Abonelikler okunamadı:", error.message);
    return json({ error: "Abonelikler okunamadı." }, 500);
  }

  const message = buildMessage(payload.event_type, payload.data ?? {});
  const body = JSON.stringify(message);
  let sent = 0;
  const gone: string[] = [];
  const failed: { id: string; count: number }[] = [];
  const succeeded: string[] = [];

  await Promise.allSettled(
    (subs ?? []).map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
          { TTL: 60 * 60 * 24, urgency: "high" },
        );
        sent += 1;
        succeeded.push(sub.id);
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) gone.push(sub.id);
        else {
          failed.push({ id: sub.id, count: sub.failure_count + 1 });
          console.error(
            "Bildirim gönderilemedi:",
            status,
            String(err).slice(0, 300),
          );
        }
      }
    }),
  );

  if (gone.length)
    await admin.from("push_subscriptions").delete().in("id", gone);
  if (succeeded.length) {
    await admin
      .from("push_subscriptions")
      .update({ last_success_at: new Date().toISOString(), failure_count: 0 })
      .in("id", succeeded);
  }
  for (const item of failed) {
    // Arka arkaya 10 hata veren abonelik bırakılır.
    if (item.count >= 10)
      await admin.from("push_subscriptions").delete().eq("id", item.id);
    else
      await admin
        .from("push_subscriptions")
        .update({ failure_count: item.count })
        .eq("id", item.id);
  }

  return json({ sent, removed: gone.length, failed: failed.length });
});

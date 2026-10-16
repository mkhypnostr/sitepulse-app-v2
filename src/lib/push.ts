// Telefona/bilgisayara anlık bildirim (web push) — tarayıcı tarafı.
//
// Akış: service worker (/sw.js) kaydedilir → kullanıcı izin verir →
// tarayıcıdan abonelik alınır → save_push_subscription ile veritabanına
// yazılır. Gönderimi sunucudaki send-push fonksiyonu yapar.
//
// iPhone/iPad: bildirim yalnız uygulama Safari'den "Ana Ekrana Ekle" ile
// kurulup oradan açıldığında çalışır (iOS 16.4+).

import { supabase } from "@/integrations/supabase/client";

/** VAPID genel anahtarı (gizli değildir; özel anahtar yalnız sunucuda). */
export const VAPID_PUBLIC_KEY =
  "BLJ8dRTa4pZZ7FlyAHKvJi_N9egy-0yTr9l44txDJUGIRSYkUmcgbpU5YxSp69JcNhHMSyonCQPkTb33yxhbOe0";

export type PushState = "unsupported" | "ios-install" | "denied" | "off" | "on";

const isBrowser = () => typeof window !== "undefined";

export function isIos() {
  if (!isBrowser()) return false;
  const ua = navigator.userAgent;
  return (
    /iPhone|iPad|iPod/.test(ua) ||
    (ua.includes("Macintosh") && navigator.maxTouchPoints > 1)
  );
}

export function isStandalone() {
  if (!isBrowser()) return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function supported() {
  return (
    isBrowser() &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export async function registerServiceWorker() {
  if (!isBrowser() || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    return null;
  }
}

async function currentSubscription() {
  const registration = await registerServiceWorker();
  if (!registration || !("pushManager" in registration)) return null;
  return registration.pushManager.getSubscription();
}

export async function getPushState(): Promise<PushState> {
  if (isIos() && !isStandalone()) return "ios-install";
  if (!supported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const subscription = await currentSubscription();
  return subscription && Notification.permission === "granted" ? "on" : "off";
}

function base64UrlToBytes(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

async function store(subscription: PushSubscription) {
  const json = subscription.toJSON();
  const { error } = await supabase.rpc("save_push_subscription", {
    p_endpoint: subscription.endpoint,
    p_p256dh: json.keys?.p256dh ?? "",
    p_auth: json.keys?.auth ?? "",
    p_user_agent: navigator.userAgent.slice(0, 400),
  });
  if (error) throw error;
}

/** İzin ister, abone olur ve aboneliği kaydeder. */
export async function enablePush(): Promise<PushState> {
  const state = await getPushState();
  if (state === "unsupported" || state === "ios-install") return state;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return permission === "denied" ? "denied" : "off";
  }
  const registration = await registerServiceWorker();
  if (!registration) return "unsupported";
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBytes(VAPID_PUBLIC_KEY),
    }));
  await store(subscription);
  return "on";
}

export async function disablePush(): Promise<PushState> {
  const subscription = await currentSubscription();
  if (subscription) {
    await supabase.rpc("delete_push_subscription", {
      p_endpoint: subscription.endpoint,
    });
    await subscription.unsubscribe();
  }
  return "off";
}

/** Oturum açıkken mevcut aboneliği tekrar kaydeder (hesap değişimi vb.). */
export async function refreshPushSubscription() {
  if (!supported() || Notification.permission !== "granted") return;
  const subscription = await currentSubscription();
  if (subscription) await store(subscription).catch(() => undefined);
}

export async function sendTestPush() {
  const { data, error } = await supabase.rpc("send_test_push");
  if (error) throw error;
  return Number(data ?? 0);
}

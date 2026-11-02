// Panel önizleme ("onun gözünden gör").
//
// Yönetici, bir taşeronun veya müşterinin panelini ayrı bir sekmede o
// kişinin gerçek oturumuyla açar; ekranda tam olarak onun gördüğü veri
// (Supabase RLS aynen geçerli) görünür. Güvenlik için:
//
// - Önizleme oturumu yalnız o sekmede (sessionStorage) tutulur; yöneticinin
//   kendi oturumuna (localStorage) dokunulmaz. Sekme kapanınca biter.
// - Sekme salt okunurdur: veri değiştiren her istek (kayıt, güncelleme,
//   silme, işlem fonksiyonları, dosya yükleme, şifre/e-posta değişikliği)
//   tarayıcıda engellenir ve sunucuya hiç gitmez.
// - Çıkış yalnız bu oturumu kapatır (scope=local); kişinin kendi
//   cihazlarındaki oturumları açık kalır.
// - Önizleme 30 dakika sonra kendiliğinden kapanır.

export const PREVIEW_PATH = "/onizleme";
export const PREVIEW_MINUTES = 30;
const FLAG_KEY = "nes-preview";
const STORAGE_PREFIX = "nes-preview:";

export type PreviewInfo = {
  name: string;
  role: "customer" | "contractor";
  expiresAt: number;
};

const hasWindow = () => typeof window !== "undefined";

function readFlag(): Partial<PreviewInfo> | null {
  try {
    const raw = window.sessionStorage.getItem(FLAG_KEY);
    return raw ? (JSON.parse(raw) as Partial<PreviewInfo>) : null;
  } catch {
    return null;
  }
}

/**
 * Bu sekme bir önizleme sekmesi mi? Önizleme sayfası açıldığında işaret
 * konur; sekme içinde başka sayfalara geçilse de korunur.
 */
export function isPreviewTab(): boolean {
  if (!hasWindow()) return false;
  if (readFlag()) return true;
  if (window.location.pathname === PREVIEW_PATH) {
    try {
      window.sessionStorage.setItem(FLAG_KEY, JSON.stringify({}));
    } catch {
      // sessionStorage yoksa önizleme açılmaz (bkz. previewSupported).
    }
    return Boolean(readFlag());
  }
  return false;
}

/** Önizleme yalnız sekmeye özel depolama varsa güvenle açılabilir. */
export function previewSupported(): boolean {
  if (!hasWindow()) return false;
  try {
    const key = `${STORAGE_PREFIX}probe`;
    window.sessionStorage.setItem(key, "1");
    window.sessionStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function previewInfo(): PreviewInfo | null {
  if (!hasWindow()) return null;
  const flag = readFlag();
  if (!flag?.name || !flag.role || !flag.expiresAt) return null;
  return flag as PreviewInfo;
}

export function startPreview(info: Omit<PreviewInfo, "expiresAt">) {
  const value: PreviewInfo = {
    ...info,
    expiresAt: Date.now() + PREVIEW_MINUTES * 60_000,
  };
  window.sessionStorage.setItem(FLAG_KEY, JSON.stringify(value));
  return value;
}

export function previewExpired(): boolean {
  const info = previewInfo();
  return Boolean(info && Date.now() > info.expiresAt);
}

/** Supabase oturumu için sekmeye özel depolama. */
export const previewStorage = {
  getItem: (key: string) =>
    hasWindow() ? window.sessionStorage.getItem(STORAGE_PREFIX + key) : null,
  setItem: (key: string, value: string) => {
    if (hasWindow()) window.sessionStorage.setItem(STORAGE_PREFIX + key, value);
  },
  removeItem: (key: string) => {
    if (hasWindow()) window.sessionStorage.removeItem(STORAGE_PREFIX + key);
  },
};

/** Uygulamanın kendi küçük önbellekleri (rol vb.) için doğru depolama. */
export function appStorage(): Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
> {
  return isPreviewTab() ? previewStorage : window.localStorage;
}

// ---------------------------------------------------------------- salt okunur
const READ_RPC = /^(get_|list_|can_|has_|is_|search_|count_)/;
const READ_FUNCTIONS = new Set(["resolve-map-location"]);

function blocked(message = "Önizleme modunda değişiklik yapılamaz.") {
  return new Response(
    JSON.stringify({
      message,
      error: message,
      code: "preview_read_only",
      details: null,
      hint: null,
    }),
    {
      status: 403,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    },
  );
}

/** İsteğin önizlemede serbest olup olmadığı; serbestse (gerekirse
 * değiştirilmiş) adresi döndürür, değilse null. Dışa açık: testte kullanılır. */
export function previewRequestUrl(
  rawUrl: string,
  method: string,
): string | null {
  const m = method.toUpperCase();
  const read = m === "GET" || m === "HEAD" || m === "OPTIONS";
  let url: URL;
  try {
    url = new URL(rawUrl, hasWindow() ? window.location.origin : undefined);
  } catch {
    return null;
  }
  const path = url.pathname;

  if (path.startsWith("/auth/v1/")) {
    const rest = path.slice("/auth/v1/".length);
    if (rest === "token" || rest === "verify") return url.toString();
    if (rest === "user") return read ? url.toString() : null;
    if (rest === "logout") {
      // Kişinin diğer cihazlarındaki oturumları kapatmamak için.
      url.searchParams.set("scope", "local");
      return url.toString();
    }
    return read ? url.toString() : null;
  }
  if (previewExpired()) return null;

  if (path.startsWith("/rest/v1/rpc/")) {
    const name = path.slice("/rest/v1/rpc/".length);
    return READ_RPC.test(name) ? url.toString() : null;
  }
  if (path.startsWith("/rest/v1/")) return read ? url.toString() : null;
  if (path.startsWith("/functions/v1/")) {
    const name = path.slice("/functions/v1/".length).split("/")[0];
    return READ_FUNCTIONS.has(name) ? url.toString() : null;
  }
  if (path.startsWith("/storage/v1/")) {
    if (read) return url.toString();
    // İmzalı adres üretme ve listeleme POST ile yapılır ama veri değiştirmez.
    if (
      path.startsWith("/storage/v1/object/sign/") ||
      path.startsWith("/storage/v1/object/list/")
    )
      return url.toString();
    return null;
  }
  return read ? url.toString() : null;
}

/** Önizleme sekmesinde veri değiştiren istekleri ağa çıkmadan durdurur. */
export function previewFetch(base: typeof fetch): typeof fetch {
  return (input, init) => {
    if (!isPreviewTab()) return base(input, init);
    const isRequest =
      typeof Request !== "undefined" && input instanceof Request;
    const rawUrl = isRequest ? input.url : String(input);
    const method = init?.method ?? (isRequest ? input.method : "GET");
    const allowed = previewRequestUrl(rawUrl, method);
    if (!allowed) {
      return Promise.resolve(
        blocked(
          previewExpired()
            ? "Önizleme süresi doldu. Sekmeyi kapatıp yeniden açın."
            : undefined,
        ),
      );
    }
    if (allowed === rawUrl) return base(input, init);
    return base(isRequest ? new Request(allowed, input) : allowed, init);
  };
}

import { createClient } from "npm:@supabase/supabase-js@2.110.7";
import { getDocumentProxy } from "npm:unpdf@1.8.1";

// Zeybek Elektrik fiyat listesi: otomatik alma.
//
// Zeybek Elektrik A.Ş. (üretici; boru, kablo kanalı/tavası, pano, rack kabinet)
// fiyat listesini zeybekgrup.com'da PDF olarak yayınlar (yılda 2-3 kez). Bu
// fonksiyon sitenin herkese açık medya listesinden en yeni "fiyat listesi"
// PDF'ini bulur; yeni bir liste varsa indirir, satırları (ürün kodu, adı,
// birim fiyat, para birimi) çıkarır ve supplier_price_items tablosuna yazar.
// Listede "Fiyatlarımızda K.D.V. dahil değildir" yazar; fiyatlar KDV hariçtir.
// Ardından apply_supplier_prices() kataloğa bağlı kalemlerin alış fiyatını
// (liste fiyatı − bayi iskontosu) günceller.
//
// Çağıranlar:
// - Veritabanındaki günlük zamanlanmış görev (request_supplier_price_sync),
//   paylaşılan anahtarla (x-webhook-secret = NOTIFICATION_WEBHOOK_SECRET).
// - Fiyat Kütüphanesi ekranındaki "Şimdi kontrol et" düğmesi (yönetici oturumu).
//
// Gövde: { mode?: "check" | "dry_run", force?: boolean, pages?: number[] }
// - check (varsayılan): liste değişmediyse hiçbir şey yazmaz.
// - dry_run: yazmadan ayrıştırma sonucunu ve örnekleri döndürür (yönetici).
// - force: liste aynı olsa da yeniden işler.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("NOTIFICATION_WEBHOOK_SECRET");
const SUPPLIER = "zeybek";
const SITE = "https://www.zeybekgrup.com";
const MEDIA_API = `${SITE}/wp-json/wp/v2/media?search=fiyat&per_page=30&orderby=date&order=desc&_fields=source_url,date,title,mime_type`;
// Ayrıştırma bundan az kalem verirse liste bozuk/değişmiş sayılır; eski
// fiyatların üzerine yazılmaz.
const MIN_ITEMS = 300;
const USER_AGENT =
  "NES-Enerji-Fiyat/1.0 (+https://app.nesgrup.com; fiyat listesi kontrolu, gunde 1 istek)";

function readServiceKey() {
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

const admin = createClient(SUPABASE_URL, readServiceKey(), {
  auth: { autoRefreshToken: false, persistSession: false },
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info, x-webhook-secret",
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

// ---------------------------------------------------------------- liste bulma
type ListInfo = { url: string; name: string; publishedAt: string | null };

async function findLatestList(): Promise<ListInfo> {
  const response = await fetch(MEDIA_API, {
    headers: { accept: "application/json", "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok)
    throw new Error(`zeybekgrup.com liste sorgusu ${response.status}`);
  const media = (await response.json()) as {
    source_url?: string;
    date?: string;
    mime_type?: string;
    title?: { rendered?: string };
  }[];
  const lists = media
    .filter((m) => {
      const title = m.title?.rendered ?? "";
      return (
        typeof m.source_url === "string" &&
        m.source_url.startsWith(`${SITE}/`) &&
        /\.pdf$/i.test(m.source_url) &&
        /zeybek/i.test(title) &&
        /fiyat/i.test(title)
      );
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const latest = lists[0];
  if (!latest?.source_url)
    throw new Error("zeybekgrup.com'da fiyat listesi PDF'i bulunamadı.");
  const title = latest.title?.rendered ?? latest.source_url;
  const match = /(20\d\d)\s*[-/_ ]\s*(\d{1,2})/.exec(title);
  return {
    url: latest.source_url,
    name: match ? `${match[1]}/${match[2]}` : title.slice(0, 60),
    publishedAt: latest.date ? `${latest.date}+03:00` : null,
  };
}

// ---------------------------------------------------------------- ayrıştırma
type Token = { x: number; y: number; s: string };
type Price = Token & { value: number; currency: "TRY" | "USD" | "EUR" };
export type ParsedItem = {
  code: string;
  name: string;
  section: string | null;
  list_price: number;
  currency: "TRY" | "USD" | "EUR";
  page: number;
};

const CODE_RE = /^(?:ZB|ZEY)\.[A-Za-z0-9./_\-]+$/;
// Kablo tavası tablolarında kod değişkenli yazılır (ZEY.90.A-H, ZEY.AK.A-T-H,
// ZEY.RED.A/B-H): A genişlik, T sac kalınlığı, H yükseklik. Bu satırlarda kod,
// tablodaki değerlerle tamamlanır (ör. ZEY.90.100-50).
const PLACEHOLDER_RE = /^(.*\.)(A(?:\/B)?)(-T)?-H$/;
const NUM = String.raw`\d{1,3}(?:\.\d{3})*,\d{2,3}`;
const TRY_INLINE = new RegExp(`^(${NUM})\\s*¨$`);
const NUM_ONLY = new RegExp(`^(${NUM})$`);
const USD_RE = new RegExp(`^\\$\\s?(${NUM})$`);
const EUR_INLINE = new RegExp(`^(${NUM})\\s*€$`);

const toNumber = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));

function pagePrices(tokens: Token[]): Price[] {
  const prices: Price[] = [];
  const near = (t: Token, mark: string) =>
    tokens.some(
      (o) =>
        o !== t &&
        o.s.trim() === mark &&
        Math.abs(o.y - t.y) <= 2 &&
        o.x > t.x &&
        o.x - t.x <= 45,
    );
  for (const t of tokens) {
    const s = t.s.trim();
    let m = TRY_INLINE.exec(s);
    if (m) {
      prices.push({ ...t, value: toNumber(m[1]), currency: "TRY" });
      continue;
    }
    m = USD_RE.exec(s);
    if (m) {
      prices.push({ ...t, value: toNumber(m[1]), currency: "USD" });
      continue;
    }
    m = EUR_INLINE.exec(s);
    if (m) {
      prices.push({ ...t, value: toNumber(m[1]), currency: "EUR" });
      continue;
    }
    m = NUM_ONLY.exec(s);
    if (m) {
      if (near(t, "¨"))
        prices.push({ ...t, value: toNumber(m[1]), currency: "TRY" });
      else if (near(t, "€"))
        prices.push({ ...t, value: toNumber(m[1]), currency: "EUR" });
    }
  }
  return prices;
}

function pageTitle(tokens: Token[]) {
  const top = tokens
    .filter((t) => t.y >= 790 && /[A-ZÇĞİÖŞÜ]{3,}/.test(t.s))
    .sort((a, b) => b.y - a.y || a.x - b.x)[0];
  return top ? top.s.trim().slice(0, 120) : null;
}

const codeText = (t: Token) => t.s.replace(/\s+/g, "");
const isCode = (t: Token) => CODE_RE.test(codeText(t));
const plain = (s: string) => s.trim().replace(",", ".");

/** Değişkenli kodlu (A-H) tablo satırları: her fiyat sütunu ayrı bir ürün. */
function parseMatrixRows(
  tokens: Token[],
  prices: Price[],
  used: Set<Price>,
  section: string | null,
  page: number,
): ParsedItem[] {
  const items: ParsedItem[] = [];
  const headers = tokens
    .filter((t) => /^Ürün Kodu$/i.test(t.s.trim()))
    .sort((a, b) => b.y - a.y);
  const rows = tokens.filter((t) => {
    const m = PLACEHOLDER_RE.exec(codeText(t));
    return m && isCode(t);
  });
  for (const code of rows) {
    const m = PLACEHOLDER_RE.exec(codeText(code))!;
    const header = headers.filter((h) => h.y > code.y).at(-1);
    if (!header) continue;
    const below = headers.find((h) => h.y < header.y);
    const blockBottom = below ? below.y : 0;
    const headerRow = tokens.filter((t) => Math.abs(t.y - header.y) <= 3);
    const colsOf = (re: RegExp) =>
      headerRow
        .filter((t) => re.test(t.s))
        .map((t) => t.x)
        .sort((a, b) => a - b);
    const hCols = colsOf(/Yükseklik-H/i);
    const tCols = colsOf(/Kalınlığı-T/i);
    const aCol = colsOf(/Genişlik-A/i)[0];
    const priceCols = colsOf(/Birim Fiyat/i);
    const rowPrices = prices
      .filter((p) => !used.has(p) && Math.abs(p.y - code.y) <= 3)
      .sort((a, b) => a.x - b.x);
    if (!rowPrices.length || hCols.length !== priceCols.length) continue;
    const near = (x: number, re: RegExp, maxDy: number) =>
      tokens
        .filter(
          (t) =>
            Math.abs(t.x - x) <= 10 &&
            t.y < header.y &&
            t.y > blockBottom &&
            Math.abs(t.y - code.y) <= maxDy &&
            re.test(t.s.trim()),
        )
        .sort((a, b) => Math.abs(a.y - code.y) - Math.abs(b.y - code.y))[0];
    const name =
      tokens
        .filter(
          (t) =>
            Math.abs(t.y - code.y) <= 3 &&
            t.x > code.x &&
            /[A-Za-zÇĞİÖŞÜçğıöşü]{3,}/.test(t.s) &&
            !isCode(t),
        )
        .sort((a, b) => a.x - b.x)[0]
        ?.s.trim() ?? "";
    let width: string | undefined;
    if (m[2] === "A/B") {
      width =
        aCol !== undefined
          ? near(aCol, /^\d{2,4}\/\d{2,4}$/, 3)?.s.trim()
          : undefined;
    } else {
      width = /^(\d{2,4})\s*mm/i.exec(name)?.[1];
    }
    if (!width) continue;
    rowPrices.forEach((price) => {
      // Fiyatın hangi sütun grubuna (H değeri) ait olduğu: en yakın fiyat sütunu.
      const i = priceCols.reduce(
        (best, x, k) =>
          Math.abs(price.x - x) < Math.abs(price.x - priceCols[best])
            ? k
            : best,
        0,
      );
      const h = near(hCols[i], /^\d{2,3}$/, 400)?.s.trim();
      const t = m[3] ? near(tCols[i] ?? -999, /^\d(?:,\d)?$/, 3)?.s : null;
      if (!h || (m[3] && !t)) return;
      used.add(price);
      const parts = [width, ...(m[3] ? [plain(t!)] : []), h];
      items.push({
        code: `${m[1]}${parts.join("-")}`,
        name: `${name} · H ${h} mm${m[3] ? ` · ${plain(t!)} mm sac` : ""}`
          .replace(/\s+/g, " ")
          .slice(0, 200),
        section,
        list_price: Math.round(price.value * 1000) / 1000,
        currency: price.currency,
        page,
      });
    });
  }
  return items;
}

export function parsePage(tokens: Token[], page: number): ParsedItem[] {
  const prices = pagePrices(tokens);
  const codes = tokens.filter(
    (t) => isCode(t) && !PLACEHOLDER_RE.test(codeText(t)),
  );
  const section = pageTitle(tokens);
  const used = new Set<Price>();
  const items: ParsedItem[] = parseMatrixRows(
    tokens,
    prices,
    used,
    section,
    page,
  );
  for (const code of codes) {
    let best: Price | null = null;
    for (const p of prices) {
      if (used.has(p) || p.x <= code.x) continue;
      const dy = Math.abs(p.y - code.y);
      if (dy > 4) continue;
      if (
        !best ||
        dy < Math.abs(best.y - code.y) ||
        (dy === Math.abs(best.y - code.y) && p.x - code.x < best.x - code.x)
      )
        best = p;
    }
    if (!best || !(best.value > 0)) continue;
    used.add(best);
    const row = tokens
      .filter(
        (t) =>
          t !== code &&
          Math.abs(t.y - code.y) <= 3 &&
          t.x > code.x &&
          t.x < best!.x &&
          t.s.trim(),
      )
      .sort((a, b) => a.x - b.x);
    const named = row.find(
      (t) =>
        /[A-Za-zÇĞİÖŞÜçğıöşü]{3,}/.test(t.s) &&
        t.s.trim().length >= 6 &&
        !isCode(t),
    );
    const name = named
      ? named.s.trim()
      : [section, ...row.map((t) => t.s.trim())]
          .filter(Boolean)
          .join(" ")
          .trim();
    items.push({
      code: codeText(code),
      name: (name || codeText(code)).replace(/\s+/g, " ").slice(0, 200),
      section,
      list_price: Math.round(best.value * 1000) / 1000,
      currency: best.currency,
      page,
    });
  }
  return items;
}

async function parsePdf(url: string) {
  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`PDF indirilemedi (${response.status})`);
  const pdf = await getDocumentProxy(
    new Uint8Array(await response.arrayBuffer()),
  );
  const byCode = new Map<string, ParsedItem>();
  const pages: { page: number; codes: number; items: number }[] = [];
  let vatNoteFound = false;
  for (let p = 1; p <= pdf.numPages; p++) {
    const content = await (await pdf.getPage(p)).getTextContent();
    const tokens: Token[] = (
      content.items as { str?: string; transform?: number[] }[]
    )
      .filter((i) => typeof i.str === "string" && i.str.trim() && i.transform)
      .map((i) => ({
        x: Math.round(i.transform![4]),
        y: Math.round(i.transform![5]),
        s: i.str!,
      }));
    if (tokens.some((t) => /K\.?D\.?V\.?\s*dahil\s*de[ğg]ildir/i.test(t.s)))
      vatNoteFound = true;
    const parsed = parsePage(tokens, p);
    for (const item of parsed)
      if (!byCode.has(item.code)) byCode.set(item.code, item);
    const codeCount = tokens.filter(isCode).length;
    if (codeCount || parsed.length)
      pages.push({ page: p, codes: codeCount, items: parsed.length });
  }
  return {
    numPages: pdf.numPages,
    items: [...byCode.values()],
    pages,
    vatNoteFound,
  };
}

// ---------------------------------------------------------------- yetki
async function callerKind(req: Request): Promise<"cron" | "admin" | null> {
  const secret = req.headers.get("x-webhook-secret");
  if (WEBHOOK_SECRET && secret && secret === WEBHOOK_SECRET) return "cron";
  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return null;
  const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error } = await db.auth.getUser(
    authorization.slice("Bearer ".length).trim(),
  );
  if (error || !userData.user) return null;
  const { data: role } = await db.rpc("get_my_app_role");
  return role === "admin" ? "admin" : null;
}

async function setStatus(
  status: "ok" | "error" | "unchanged",
  message: string,
) {
  await admin
    .from("supplier_settings")
    .update({
      last_checked_at: new Date().toISOString(),
      last_check_status: status,
      last_check_message: message.slice(0, 500),
    })
    .eq("supplier", SUPPLIER);
}

// ---------------------------------------------------------------- sunucu
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST kullanın." }, 405);

  const caller = await callerKind(req);
  if (!caller) return json({ error: "Bu işlem yalnız yöneticiye açık." }, 403);

  const body = (await req.json().catch(() => ({}))) as {
    mode?: string;
    force?: boolean;
    /** dry_run: yalnız bu sayfaların kalemlerini döndür (kontrol için). */
    pages?: number[];
  };
  const dryRun = body.mode === "dry_run";
  if (dryRun && caller !== "admin" && caller !== "cron")
    return json({ error: "Yetkisiz." }, 403);

  let list: ListInfo;
  try {
    list = await findLatestList();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!dryRun) await setStatus("error", message);
    return json({ ok: false, error: message }, 502);
  }

  if (!dryRun && !body.force) {
    const { data: existing } = await admin
      .from("supplier_price_lists")
      .select("id, item_count")
      .eq("supplier", SUPPLIER)
      .eq("source_url", list.url)
      .eq("status", "ok")
      .maybeSingle();
    if (existing) {
      const message = `Liste güncel (${list.name}, ${existing.item_count} kalem).`;
      await setStatus("unchanged", message);
      return json({ ok: true, changed: false, list: list.name, message });
    }
  }

  let parsed: Awaited<ReturnType<typeof parsePdf>>;
  try {
    parsed = await parsePdf(list.url);
  } catch (error) {
    const message = `${list.name} okunamadı: ${error instanceof Error ? error.message : String(error)}`;
    if (!dryRun) await setStatus("error", message);
    return json({ ok: false, error: message }, 502);
  }

  const byCurrency = parsed.items.reduce<Record<string, number>>((a, i) => {
    a[i.currency] = (a[i.currency] ?? 0) + 1;
    return a;
  }, {});

  if (dryRun) {
    return json({
      ok: true,
      dry_run: true,
      list,
      numPages: parsed.numPages,
      itemCount: parsed.items.length,
      byCurrency,
      vatNoteFound: parsed.vatNoteFound,
      pages: parsed.pages,
      samples: Array.isArray(body.pages)
        ? parsed.items.filter((i) => body.pages!.includes(i.page))
        : parsed.items.filter((_, i) => i % 40 === 0),
    });
  }

  if (parsed.items.length < MIN_ITEMS || !parsed.vatNoteFound) {
    const message = `${list.name} beklenen biçimde değil (${parsed.items.length} kalem${parsed.vatNoteFound ? "" : ", KDV notu yok"}); eski fiyatlar korundu.`;
    await admin.from("supplier_price_lists").upsert(
      {
        supplier: SUPPLIER,
        list_name: list.name,
        source_url: list.url,
        published_at: list.publishedAt,
        item_count: parsed.items.length,
        status: "error",
        error: message,
        imported_at: new Date().toISOString(),
      },
      { onConflict: "supplier,source_url" },
    );
    await setStatus("error", message);
    return json({ ok: false, error: message }, 422);
  }

  const { data: listRow, error: listError } = await admin
    .from("supplier_price_lists")
    .upsert(
      {
        supplier: SUPPLIER,
        list_name: list.name,
        source_url: list.url,
        published_at: list.publishedAt,
        item_count: parsed.items.length,
        status: "ok",
        error: null,
        imported_at: new Date().toISOString(),
      },
      { onConflict: "supplier,source_url" },
    )
    .select("id")
    .single();
  if (listError || !listRow) {
    const message = `Liste kaydedilemedi: ${listError?.message ?? "?"}`;
    await setStatus("error", message);
    return json({ ok: false, error: message }, 500);
  }

  const now = new Date().toISOString();
  for (let i = 0; i < parsed.items.length; i += 500) {
    const chunk = parsed.items.slice(i, i + 500).map((item) => ({
      supplier: SUPPLIER,
      code: item.code,
      name: item.name,
      section: item.section,
      list_price: item.list_price,
      currency: item.currency,
      page: item.page,
      list_id: listRow.id,
      is_current: true,
      updated_at: now,
    }));
    const { error } = await admin
      .from("supplier_price_items")
      .upsert(chunk, { onConflict: "supplier,code" });
    if (error) {
      const message = `Fiyatlar yazılamadı: ${error.message}`;
      await setStatus("error", message);
      return json({ ok: false, error: message }, 500);
    }
  }
  await admin
    .from("supplier_price_items")
    .update({ is_current: false })
    .eq("supplier", SUPPLIER)
    .neq("list_id", listRow.id);

  const { data: updated, error: applyError } = await admin.rpc(
    "apply_supplier_prices",
    { p_supplier: SUPPLIER },
  );
  const message = `${list.name} alındı: ${parsed.items.length} kalem; ${applyError ? "katalog güncellenemedi" : `kataloğa bağlı ${updated ?? 0} kalemin fiyatı güncellendi`}.`;
  await setStatus(applyError ? "error" : "ok", message);
  return json({
    ok: !applyError,
    changed: true,
    list: list.name,
    itemCount: parsed.items.length,
    byCurrency,
    catalogUpdated: updated ?? 0,
    message,
  });
});

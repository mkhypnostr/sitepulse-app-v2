// enerjipazari.com.tr (IdeaSoft) kategori sayfalarından güncel liste fiyatı.
// Sitede TL fiyatlar KDV dahil gösterilir; katalogda KDV hariç USD tutulur
// (20261014180000_offer_catalog_enerjipazari.sql). Çevirmede sitenin kendi
// sayfada yayımladığı USD kuru kullanılır, böylece sitedeki "USD + KDV"
// fiyatıyla aynı sonuç çıkar.

export const ENERJIPAZARI_BASE = "https://www.enerjipazari.com.tr";

/** Sitenin robots.txt dosyası: "Crawl-delay: 30". İstekler arası bekleme. */
export const ENERJIPAZARI_CRAWL_DELAY_MS = 31_000;

export const ENERJIPAZARI_CATEGORIES = {
  "gunes-paneli": "Güneş paneli",
  "inverterler-1": "İnverter",
  liyumvejelbataryalar: "Batarya",
} as const;

export type EnerjipazariCategory = keyof typeof ENERJIPAZARI_CATEGORIES;

export const ENERJIPAZARI_VAT = 0.2;

export type EnerjipazariProduct = {
  slug: string;
  name: string;
  brand: string | null;
  /** Sitedeki fiyat, TL, KDV dahil. */
  priceTry: number;
};

export type EnerjipazariPage = {
  category: EnerjipazariCategory;
  page: number;
  /** Sitenin sayfada yayımladığı kur (1 USD kaç TL). */
  usdRate: number | null;
  totalProducts: number | null;
  hasNextPage: boolean;
  products: EnerjipazariProduct[];
};

export function isEnerjipazariCategory(
  value: string,
): value is EnerjipazariCategory {
  return Object.prototype.hasOwnProperty.call(ENERJIPAZARI_CATEGORIES, value);
}

export function enerjipazariCategoryUrl(
  category: EnerjipazariCategory,
  page: number,
) {
  const base = `${ENERJIPAZARI_BASE}/kategori/${category}`;
  return page > 1 ? `${base}?tp=${page}` : base;
}

/** "1.357.180,20" → 1357180.2 */
export function parseTrPrice(text: string): number | null {
  const cleaned = text
    .replace(/[^\d.,]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const value = Number(cleaned);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function decodeEntities(text: string) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&uuml;/gi, "ü")
    .replace(/&ouml;/gi, "ö")
    .replace(/&ccedil;/gi, "ç")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseEnerjipazariPage(
  html: string,
  category: EnerjipazariCategory,
  page: number,
): EnerjipazariPage {
  const rate = html.match(/currencies\s*=\s*\{[^}]*"USD"\s*:\s*([\d.]+)/);
  const total = html.match(/Toplam\s+(\d+)\s+ürün/);
  const products: EnerjipazariProduct[] = [];
  const seen = new Set<string>();
  for (const card of html.split('class="showcase"').slice(1)) {
    const title = card.match(
      /showcase-title">\s*<a href="\/urun\/([^"]+)"[^>]*>([^<]+)</,
    );
    const price = card.match(/showcase-price-new">\s*([\d.,]+)\s*TL/);
    if (!title || !price) continue;
    const priceTry = parseTrPrice(price[1]);
    if (priceTry === null || seen.has(title[1])) continue;
    seen.add(title[1]);
    const brand = card.match(/showcase-brand">\s*<a[^>]*>([^<]+)</);
    products.push({
      slug: title[1],
      name: decodeEntities(title[2]),
      brand: brand ? decodeEntities(brand[1]) : null,
      priceTry,
    });
  }
  return {
    category,
    page,
    usdRate: rate ? Number(rate[1]) || null : null,
    totalProducts: total ? Number(total[1]) : null,
    hasNextPage: html.includes(`/kategori/${category}?tp=${page + 1}"`),
    products,
  };
}

/** Sitedeki KDV dahil TL fiyatı → katalogdaki KDV hariç USD. */
export function enerjipazariUsdExVat(priceTry: number, usdRate: number) {
  return Math.round((priceTry / (1 + ENERJIPAZARI_VAT) / usdRate) * 100) / 100;
}

// Katalog kodu → sitedeki ürün adresi. Kodlar 20261014180000 migration'ındaki
// EP-* kalemleridir; eşleşme elle doğrulandı (17.10.2026). Listede olmayan
// kalem için aşağıdaki tahmin kullanılır ve "tahmini eşleşme" diye gösterilir.
export const ENERJIPAZARI_SLUGS: Record<string, string> = {
  "EP-PNL-655": "655w-half-cut-topcon-mono-gunes-paneli",
  "EP-PNL-750-BF": "750w-bifacial-132-cell-16bb-half-cut-topcon-gunes-paneli",
  "EP-PNL-450-BF": "450w-bifacial-78-cell-16bb-half-cut-topcon-gunes-paneli",
  "EP-INV-HYB-5-M-LV": "5kw-hibrit-monofaze-inverter",
  "EP-INV-HYB-8-M-LV": "8kw-hibrit-monofaze-inverter-lv-1",
  "EP-INV-HYB-10-M-LV": "10kw-hibrit-monofaze-inverter-lv",
  "EP-INV-HYB-8-T-LV": "8kw-hibrit-trifaze-inverter-lv",
  "EP-INV-HYB-12-T-LV": "12kw-hibrit-trifaze-inverter",
  "EP-INV-HYB-15-T-LV": "15kw-hibrit-trifaze-inverter-lv",
  "EP-INV-HYB-20-T-LV": "20kw-hibrit-trifaze-inverter-lv",
  "EP-INV-HYB-20-T-HV": "20kw-hibrit-trifaze-inverter-hv",
  "EP-INV-HYB-25-T-HV": "25kw-hibrit-trifaze-inverter-hv",
  "EP-INV-HYB-30-T-HV": "30kw-hibrit-trifaze-inverter-hv",
  "EP-INV-HYB-40-T-HV": "40kw-hibrit-trifaze-inverter-hv-kopya",
  "EP-INV-HYB-50-T-HV": "50kw-hibrit-trifaze-inverter-hv",
  "EP-INV-ONG-3-M": "3kw-on-grid-monofaze-inverter-1",
  "EP-INV-ONG-5-M": "5kw-on-grid-monofaze-inverter-1",
  "EP-INV-ONG-20-T": "20kw-on-grid-trifaze-inverter-1",
  "EP-INV-ONG-25-T": "25kw-on-grid-trifaze-inverter-1",
  "EP-INV-ONG-30-T": "30kw-on-grid-trifaze-inverter",
  "EP-INV-ONG-50-T": "50kw-on-grid-trifaze-inverter-1",
  "EP-INV-ONG-100-T": "100kw-on-grid-trifaze-inverter",
  "EP-BAT-LX-512-100": "100ah-51-2v-lifepo4-batarya",
  "EP-BAT-LX-512-100W": "100ah-51-2v-premium-serisi-duvar-tipi-lityum-batarya",
  "EP-BAT-LX-48-100": "100ah-48v-lifepo4-batarya",
  "EP-BAT-LX-512-314": "314ah-51-2v-premium-serisi-lityum-batarya",
  "EP-BAT-EVE-HV-20": "20-48kwh-lifepo4-hv-yuksek-voltaj-batarya-sistemi",
  "EP-BAT-EVE-HV-30": "eve-30-72kwh-lityum-hv-yuksek-voltaj-batarya-sistemi",
  "EP-BAT-EVE-HV-41": "40-96kwh-lifepo4-hv-yuksek-voltaj-batarya-sistemi",
};

export type MatchableCatalogItem = {
  code: string;
  template_role: string | null;
  power_w: number | null;
  power_kw: number | null;
  capacity_kwh: number | null;
  phase: string | null;
  name: string;
};

export type ProductMatch = {
  product: EnerjipazariProduct;
  /** Kod listesinden mi, ad/güçten tahmin mi. */
  exact: boolean;
};

function upper(text: string) {
  return text.toLocaleUpperCase("tr-TR");
}

/** Kod listesinde olmayan kalem için ad/güç üzerinden temkinli tahmin.
 * Birden fazla aday varsa eşleşme yapılmaz (yanlış fiyat yazmaktansa boş). */
function guessProduct(
  item: MatchableCatalogItem,
  products: EnerjipazariProduct[],
): EnerjipazariProduct | null {
  const role = item.template_role ?? "";
  let candidates: EnerjipazariProduct[] = [];
  if (role === "ges_panel" && item.power_w) {
    const w = `${item.power_w}W`;
    candidates = products.filter(
      (p) => upper(p.name).startsWith(w) && upper(p.name).includes("PANEL"),
    );
    if (candidates.length > 1 && /BIFACIAL|ÇİFT/i.test(item.name)) {
      candidates = candidates.filter((p) => upper(p.name).includes("BIFACIAL"));
    }
  } else if (role.startsWith("ges_inverter") && item.power_kw) {
    const kw = `${String(item.power_kw).replace(".", ",")}KW`;
    const kwDot = `${item.power_kw}KW`;
    const hybrid = role === "ges_inverter";
    const tri = item.phase === "trifaze";
    candidates = products.filter((p) => {
      const n = upper(p.name).replace(/\s+/g, "");
      return (
        (n.startsWith(kw) || n.startsWith(kwDot)) &&
        (hybrid ? n.includes("HİBRİT") : n.includes("ON-GRİD")) &&
        (tri ? n.includes("TRİFAZE") : n.includes("MONOFAZE"))
      );
    });
    if (candidates.length > 1) {
      const hv = /HV/.test(item.name);
      candidates = candidates.filter(
        (p) => upper(p.name).includes(" HV") === hv,
      );
    }
  } else if (role.startsWith("ges_battery") && item.capacity_kwh) {
    const kwh = item.capacity_kwh.toFixed(2);
    candidates = products.filter((p) =>
      upper(p.name).replace(",", ".").includes(`${kwh}KWH`),
    );
  }
  return candidates.length === 1 ? candidates[0] : null;
}

export function matchCatalogItem(
  item: MatchableCatalogItem,
  products: EnerjipazariProduct[],
): ProductMatch | null {
  const slug = ENERJIPAZARI_SLUGS[item.code];
  if (slug) {
    const product = products.find((p) => p.slug === slug);
    return product ? { product, exact: true } : null;
  }
  const guessed = guessProduct(item, products);
  return guessed ? { product: guessed, exact: false } : null;
}

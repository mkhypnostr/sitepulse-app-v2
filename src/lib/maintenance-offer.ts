// GES ve trafo merkezi bakım paketleri + ayrı kalem elektrik işletme
// sorumluluğu: fiyat listesi, hesap ve kurumsal A4 teklif belgesi.
//
// Fiyat listesini yönetici bir kez girer (maintenance_price_list tablosu,
// yalnız yönetici); her teklifte tesis bilgisi (kWp, kVA, adet) ve seçilen
// paket ile tutar anında hesaplanır.
//  - GES: ₺/kWp/yıl × kurulu güç, en az "asgari yıllık bedel".
//  - Trafo: kVA kademesine göre ₺/trafo/yıl × adet.
//  - İşletme sorumluluğu: kVA kademesine göre ₺/ay × 12; bir bakım paketiyle
//    birlikte alınırsa listedeki indirim oranı uygulanır.
//  - Ek hizmetler: birim fiyat × miktar.

import { asciiSlug } from "@/lib/file-name";
import {
  LETTERHEAD_PAGE_CSS,
  NES_COMPANY,
  letterheadHtml,
} from "@/lib/nes-company";

export const TIERS = ["temel", "standart", "premium"] as const;
export type Tier = (typeof TIERS)[number];
export const TIER_LABEL: Record<Tier, string> = {
  temel: "Temel",
  standart: "Standart",
  premium: "Premium",
};

/** Trafo ve işletme sorumluluğu fiyat kademeleri (kurulu trafo gücü). */
export const KVA_BANDS = [
  { label: "0 – 400 kVA", max: 400 },
  { label: "401 – 1.000 kVA", max: 1000 },
  { label: "1.001 – 2.500 kVA", max: 2500 },
  { label: "2.500 kVA üzeri", max: Infinity },
] as const;

export function kvaBand(kva: number) {
  const i = KVA_BANDS.findIndex((b) => kva <= b.max);
  return i < 0 ? KVA_BANDS.length - 1 : i;
}

export const EXTRAS = [
  { key: "temizlik", label: "Ek panel temizliği", unit: "kWp" },
  { key: "yag", label: "Ek trafo yağı delinme dayanımı testi", unit: "Numune" },
  { key: "dga", label: "Ek DGA (çözünmüş gaz) analizi", unit: "Numune" },
  {
    key: "ariza",
    label: "Paket dışı arıza çağrısı (ilk saat dahil)",
    unit: "Ziyaret",
  },
  { key: "termal", label: "Termal kamera taraması ve raporu", unit: "Tesis" },
  {
    key: "topraklama",
    label: "Topraklama / periyodik kontrol raporu",
    unit: "Tesis",
  },
] as const;
export type ExtraKey = (typeof EXTRAS)[number]["key"];

export type MaintenancePrices = {
  ges: Record<Tier, { perKwp: number; min: number }>;
  /** ₺ / trafo / yıl, KVA_BANDS sırasıyla. */
  trafo: Record<Tier, number[]>;
  /** ₺ / ay, KVA_BANDS sırasıyla. */
  isMonthly: number[];
  /** Bakım paketiyle birlikte işletme sorumluluğu indirimi (0–1). */
  isBundleDiscount: number;
  extras: Record<ExtraKey, number>;
};

const zeroBands = () => KVA_BANDS.map(() => 0);

export function emptyPrices(): MaintenancePrices {
  return {
    ges: {
      temel: { perKwp: 0, min: 0 },
      standart: { perKwp: 0, min: 0 },
      premium: { perKwp: 0, min: 0 },
    },
    trafo: { temel: zeroBands(), standart: zeroBands(), premium: zeroBands() },
    isMonthly: zeroBands(),
    isBundleDiscount: 0,
    extras: Object.fromEntries(EXTRAS.map((x) => [x.key, 0])) as Record<
      ExtraKey,
      number
    >,
  };
}

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/** Veritabanındaki jsonb'yi eksik/bozuk alanlara karşı güvenle okur. */
export function normalizePrices(raw: unknown): MaintenancePrices {
  const base = emptyPrices();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<Record<keyof MaintenancePrices, unknown>>;
  const ges = (r.ges ?? {}) as Record<
    string,
    { perKwp?: unknown; min?: unknown }
  >;
  const trafo = (r.trafo ?? {}) as Record<string, unknown[]>;
  for (const t of TIERS) {
    base.ges[t] = { perKwp: num(ges[t]?.perKwp), min: num(ges[t]?.min) };
    base.trafo[t] = KVA_BANDS.map((_, i) =>
      num(Array.isArray(trafo[t]) ? trafo[t][i] : 0),
    );
  }
  const is = Array.isArray(r.isMonthly) ? r.isMonthly : [];
  base.isMonthly = KVA_BANDS.map((_, i) => num(is[i]));
  base.isBundleDiscount = Math.min(num(r.isBundleDiscount), 1);
  const extras = (r.extras ?? {}) as Record<string, unknown>;
  for (const x of EXTRAS) base.extras[x.key] = num(extras[x.key]);
  return base;
}

export type MaintenanceOfferInput = {
  customerName: string;
  address: string;
  contactPerson: string;
  contactInfo: string;
  offerNo: string;
  /** YYYY-MM-DD */
  offerDate: string;
  validityDays: number;
  /** 0.2 = %20 */
  vatRate: number;
  /** Genel iskonto, 0.1 = %10 */
  discount: number;
  payment: string;
  ges: {
    enabled: boolean;
    tier: Tier;
    kwp: number;
    inverters: number;
    siteType: string;
  };
  trafo: {
    enabled: boolean;
    tier: Tier;
    kva: number;
    count: number;
    voltage: string;
    kind: string;
  };
  isEnabled: boolean;
  /** İşletme sorumluluğu için kurulu güç; boşsa trafo gücü × adet. */
  isKva: number;
  extras: Record<ExtraKey, number>;
};

export function defaultMaintenanceOffer(
  now = new Date(),
): MaintenanceOfferInput {
  const pad = (n: number) => String(n).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(2);
  return {
    customerName: "",
    address: "",
    contactPerson: "",
    contactInfo: "",
    offerNo: `NES-BKM-${yy}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`,
    offerDate: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    validityDays: 15,
    vatRate: 0.2,
    discount: 0,
    payment: "Yıllık peşin",
    ges: {
      enabled: true,
      tier: "standart",
      kwp: 0,
      inverters: 0,
      siteType: "Arazi",
    },
    trafo: {
      enabled: false,
      tier: "standart",
      kva: 0,
      count: 1,
      voltage: "34,5 kV",
      kind: "Yağlı",
    },
    isEnabled: false,
    isKva: 0,
    extras: Object.fromEntries(EXTRAS.map((x) => [x.key, 0])) as Record<
      ExtraKey,
      number
    >,
  };
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type MaintenanceLine = {
  key: string;
  label: string;
  detail: string;
  amount: number;
};

export type MaintenanceOfferResult = {
  /** Bu tesis için her kademenin yıllık bedeli (karşılaştırma tablosu). */
  gesTiers: Record<Tier, number>;
  trafoTiers: Record<Tier, number>;
  trafoBand: number;
  isBand: number;
  isKva: number;
  isMonthly: number;
  isYearly: number;
  isDiscountApplied: number;
  lines: MaintenanceLine[];
  subtotal: number;
  discountAmount: number;
  net: number;
  vat: number;
  grandTotal: number;
};

export function calculateMaintenanceOffer(
  input: MaintenanceOfferInput,
  prices: MaintenancePrices,
): MaintenanceOfferResult {
  const gesTier = (t: Tier) => {
    const p = prices.ges[t];
    const raw = input.ges.kwp * p.perKwp;
    return round2(input.ges.kwp > 0 ? Math.max(raw, p.min) : 0);
  };
  const trafoBand = kvaBand(input.trafo.kva);
  const count = Math.max(1, input.trafo.count);
  const trafoTier = (t: Tier) =>
    round2(input.trafo.kva > 0 ? prices.trafo[t][trafoBand] * count : 0);
  const gesTiers = {
    temel: gesTier("temel"),
    standart: gesTier("standart"),
    premium: gesTier("premium"),
  };
  const trafoTiers = {
    temel: trafoTier("temel"),
    standart: trafoTier("standart"),
    premium: trafoTier("premium"),
  };

  const isKva =
    input.isKva > 0
      ? input.isKva
      : input.trafo.kva * Math.max(1, input.trafo.count);
  const isBand = kvaBand(isKva);
  const bundled = input.ges.enabled || input.trafo.enabled;
  const isDiscountApplied = bundled ? prices.isBundleDiscount : 0;
  const isMonthly = round2(prices.isMonthly[isBand] * (1 - isDiscountApplied));
  const isYearly = round2(isMonthly * 12);

  const lines: MaintenanceLine[] = [];
  if (input.ges.enabled)
    lines.push({
      key: "ges",
      label: `GES bakım paketi · ${TIER_LABEL[input.ges.tier]}`,
      detail: `${fmtNum(input.ges.kwp)} kWp, 12 ay`,
      amount: gesTiers[input.ges.tier],
    });
  if (input.trafo.enabled)
    lines.push({
      key: "trafo",
      label: `Trafo merkezi bakım paketi · ${TIER_LABEL[input.trafo.tier]}`,
      detail: `${count} × ${fmtNum(input.trafo.kva)} kVA, 12 ay`,
      amount: trafoTiers[input.trafo.tier],
    });
  if (input.isEnabled)
    lines.push({
      key: "is",
      label: "Elektrik işletme sorumluluğu",
      detail: `${KVA_BANDS[isBand].label}, ${money(isMonthly)} ₺/ay × 12${isDiscountApplied ? ` (paket indirimi %${pctText(isDiscountApplied)})` : ""}`,
      amount: isYearly,
    });
  for (const x of EXTRAS) {
    const qty = input.extras[x.key] ?? 0;
    if (qty > 0)
      lines.push({
        key: `x-${x.key}`,
        label: x.label,
        detail: `${fmtNum(qty)} ${x.unit} × ${money(prices.extras[x.key])} ₺`,
        amount: round2(qty * prices.extras[x.key]),
      });
  }
  const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
  const discountAmount = round2(subtotal * input.discount);
  const net = round2(subtotal - discountAmount);
  const vat = round2(net * input.vatRate);
  return {
    gesTiers,
    trafoTiers,
    trafoBand,
    isBand,
    isKva,
    isMonthly,
    isYearly,
    isDiscountApplied,
    lines,
    subtotal,
    discountAmount,
    net,
    vat,
    grandTotal: round2(net + vat),
  };
}

// ------------------------------------------------------------- kapsam

type Cell = boolean | string;
type Row = [label: string, temel: Cell, standart: Cell, premium: Cell];
type Group = [title: string, rows: Row[]];

export const GES_TIER_NOTE: Record<Tier, string> = {
  temel: "Yılda 1 ziyaret",
  standart: "Yılda 2 ziyaret",
  premium: "Yılda 4 ziyaret",
};
export const TRAFO_TIER_NOTE: Record<Tier, string> = {
  temel: "Yılda 1 bakım",
  standart: "Yılda 2 bakım",
  premium: "2 bakım + 2 kontrol",
};

export const GES_SCOPE: Group[] = [
  [
    "Saha kontrolü",
    [
      ["Panel yüzeyi, çerçeve ve kırık / çatlak kontrolü", true, true, true],
      [
        "Konstrüksiyon, kelepçe ve cıvata bağlantıları kontrolü",
        true,
        true,
        true,
      ],
      [
        "DC kablo güzergâhı, konnektör ve kablo kanalı kontrolü",
        true,
        true,
        true,
      ],
      [
        "AC / DC pano: sigorta, parafudr, şalter ve klemens kontrolü",
        true,
        true,
        true,
      ],
    ],
  ],
  [
    "Temizlik",
    [
      [
        "Panel temizliği (saf su, yumuşak fırça, kimyasalsız)",
        "1 kez",
        "2 kez",
        "4 kez",
      ],
      ["İnverter fan ve soğutma yüzeyi temizliği", true, true, true],
    ],
  ],
  [
    "Ölçüm ve test",
    [
      [
        "İnverter hata kayıtlarının okunması ve parametre kontrolü",
        true,
        true,
        true,
      ],
      [
        "String bazında açık devre gerilimi (Voc) ve kısa devre akımı (Isc)",
        false,
        true,
        true,
      ],
      ["DC izolasyon direnci ölçümü", false, true, true],
      [
        "Termal kamera ile panel, konnektör ve pano taraması",
        false,
        "1 kez",
        "2 kez",
      ],
      ["I-V eğrisi ölçümü (string bazında)", false, false, true],
      ["Topraklama ve eşpotansiyel bağlantı ölçümü, raporu", false, true, true],
      [
        "Klemens ve bağlantı noktalarında sıkılık (tork) kontrolü",
        false,
        true,
        true,
      ],
    ],
  ],
  [
    "İzleme, müdahale ve raporlama",
    [
      ["Fotoğraflı bakım tutanağı ve bulgu listesi", true, true, true],
      [
        "İzleme sisteminden üretim takibi",
        false,
        "Aylık özet",
        "Sürekli takip",
      ],
      ["Performans oranı (PR) ve kayıp analizi raporu", false, false, "Yıllık"],
      ["Arıza çağrısında müdahale", "Ücretli çağrı", "Planlı", "Öncelikli"],
      ["Paket dışı işçilik ve yedek parçada indirim", false, false, true],
    ],
  ],
];

export const TRAFO_SCOPE: Group[] = [
  [
    "Transformatör",
    [
      [
        "Gövde, conta, radyatör ve buşinglerde sızıntı / hasar kontrolü",
        true,
        true,
        true,
      ],
      ["Yağ seviyesi ve silikajel (nem alıcı) kontrolü", true, true, true],
      [
        "Enerji kesintili temizlik (trafo, buşing, hücre içi)",
        "1 kez",
        "2 kez",
        "2 kez",
      ],
      [
        "Bara, buşing ve kablo başlığı bağlantılarında sıkılık kontrolü",
        true,
        true,
        true,
      ],
      ["Sargı izolasyon direnci ölçümü (megger)", true, true, true],
      ["Sargı direnci ölçümü", false, true, true],
      ["Dönüştürme oranı (TTR) testi", false, true, true],
      ["Trafo yağı delinme dayanımı (kV) testi", false, "1 kez", "1 kez"],
      ["Çözünmüş gaz analizi (DGA, laboratuvar)", false, false, "1 kez"],
      [
        "Koruma elemanları fonksiyon testi (Buchholz, termometre, DMCR)",
        false,
        true,
        true,
      ],
    ],
  ],
  [
    "OG hücre ve AG dağıtım",
    [
      [
        "Kesici, yük ayırıcı ve ayırıcıların mekanik kontrolü, yağlaması",
        true,
        true,
        true,
      ],
      ["OG sigorta, gerilim gösterge ve kilitleme kontrolü", true, true, true],
      ["Koruma rölesi ayar ve açtırma kontrolü", false, true, true],
      [
        "AG pano ve kompanzasyon (kondansatör, reaktif röle) kontrolü",
        "Görsel",
        true,
        true,
      ],
      ["Termal kamera ile yük altında tarama", false, "1 kez", "2 kez"],
    ],
  ],
  [
    "Topraklama, İSG ve raporlama",
    [
      ["İşletme ve koruma topraklaması ölçümü, raporu", true, true, true],
      [
        "İSG ekipmanları: yalıtkan halı, eldiven, istanka, uyarı levhaları",
        true,
        true,
        true,
      ],
      [
        "Tek hat şeması ve trafo merkezi pano etiketleri kontrolü",
        true,
        true,
        true,
      ],
      ["Fotoğraflı bakım tutanağı ve ölçüm raporları", true, true, true],
      ["Ara dönem görsel kontrol ziyareti", false, false, "2 kez"],
      [
        "Yıllık durum değerlendirmesi ve iyileştirme önerisi",
        false,
        false,
        true,
      ],
      ["Arıza çağrısında müdahale", "Ücretli çağrı", "Planlı", "Öncelikli"],
    ],
  ],
];

export const IS_SCOPE = [
  "İşletme sorumluluğu sözleşmesinin düzenlenmesi, Elektrik Mühendisleri Odası ve dağıtım şirketine bildirim",
  "Tesis gücüne göre belirlenen periyotta, en az ayda bir kez kontrol ziyareti",
  "İşletme defterinin tutulması; bulgu ve önerilerin yazılı bildirimi",
  "Manevra, enerji kesme / verme ve çalışma izni işlemlerinin yönetimi",
  "Dağıtım şirketi ile planlı kesinti ve yazışmaların koordinasyonu",
  "Tesis personeline güvenlik talimatı ve manevra bilgilendirmesi",
  "Arıza durumunda telefonla teknik yönlendirme ve sahaya yönlendirme",
  "Periyodik kontrol ve ölçüm sürelerinin takibi, hatırlatılması",
];

// ------------------------------------------------------------- belge

const esc = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtNum(n: number) {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(n);
}

function pctText(rate: number) {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(
    rate * 100,
  );
}

function trDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}.${m}.${y}` : iso;
}

const priceOrDash = (n: number) => (n > 0 ? `${money(n)} ₺` : "—");

function matrixHtml(
  groups: Group[],
  notes: Record<Tier, string>,
  tierPrices: Record<Tier, number>,
  selected: Tier,
  basisNote: string,
) {
  const head = TIERS.map(
    (t, i) =>
      `<th class="pk pk${i}${t === selected ? " sel" : ""}">${t === selected ? '<i class="tag">Önerilen</i>' : ""}<b>${TIER_LABEL[t]}</b><small>${esc(notes[t])}</small></th>`,
  ).join("");
  const cell = (c: Cell, t: Tier) => {
    const cls = `v${t === selected ? " sel" : ""}`;
    if (c === true) return `<td class="${cls}"><span class="ok">●</span></td>`;
    if (c === false) return `<td class="${cls}"><span class="no">—</span></td>`;
    return `<td class="${cls}">${esc(c)}</td>`;
  };
  const body = groups
    .map(
      ([title, rows]) =>
        `<tr class="grp"><td colspan="4">${esc(title)}</td></tr>` +
        rows
          .map(
            ([label, ...cells]) =>
              `<tr><td class="lbl">${esc(label)}</td>${cells.map((c, i) => cell(c, TIERS[i])).join("")}</tr>`,
          )
          .join(""),
    )
    .join("");
  const price = TIERS.map(
    (t) =>
      `<td class="v price${t === selected ? " sel" : ""}"><b>${priceOrDash(tierPrices[t])}</b><small>yıllık + KDV</small></td>`,
  ).join("");
  return `<table class="mx"><thead><tr><th class="lbl-h">Hizmet kalemi</th>${head}</tr></thead><tbody>${body}<tr class="pr"><td class="lbl"><b>Yıllık paket bedeli</b><small>${esc(basisNote)}</small></td>${price}</tr></tbody></table>`;
}

const DOC_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Raleway:wght@400;600;700&family=Ubuntu:wght@400;500;700&display=swap');
@page{size:A4;margin:0}
*{box-sizing:border-box}
:root{--sage:#829797;--sage-d:#5f7474;--sage-dd:#3e5050;--mist:#dfe9ea;--mist2:#eef4f4;--ink:#1f2324;--mute:#5d6767;--sun:#f2b84b}
html,body{margin:0;padding:0;background:#e6eaeb}
body{font-family:'Raleway',Arial,sans-serif;color:var(--ink);font-size:9.4pt;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:210mm;height:297mm;margin:10mm auto;background:#fff;position:relative;overflow:hidden;break-after:page;page-break-after:always}
.page:last-child{break-after:auto;page-break-after:auto}
@media print{html,body{background:#fff}.page{margin:0}}
@media screen{.page{box-shadow:0 6px 30px rgba(20,40,40,.15)}}
${LETTERHEAD_PAGE_CSS}
.lh-mark{opacity:.06}
.body{position:absolute;left:15mm;right:15mm;top:29mm;bottom:24mm}
h1{font-weight:700;font-size:25pt;line-height:1.12;margin:0}
h2{font-weight:700;font-size:15pt;margin:0 0 1.5mm}
.kicker{font-family:Ubuntu,Arial,sans-serif;font-weight:500;font-size:8.5pt;color:var(--sage-d);margin:0 0 2mm}
.lead{color:var(--mute);margin:0 0 4mm;max-width:165mm}
p{margin:0 0 2.5mm}
.cover-top{display:grid;grid-template-columns:1fr 52mm;gap:8mm;align-items:end;margin-top:6mm}
.yearmark{font-family:Ubuntu,Arial,sans-serif;font-weight:700;font-size:44pt;line-height:.9;color:var(--mist);text-align:right}
.cover-band{margin:8mm -15mm 0;background:var(--sage-dd);color:#fff;padding:7mm 15mm;display:grid;grid-template-columns:1fr 1fr 1fr;gap:6mm}
.cover-band b{display:block;font-family:Ubuntu,Arial,sans-serif;font-size:14pt;font-weight:500;color:var(--sun);line-height:1.2}
.cover-band span{font-size:8.6pt;color:var(--mist)}
.meta{margin-top:8mm;border:.6pt solid #cfdcdd;border-radius:2mm;padding:4.5mm 6mm;display:grid;grid-template-columns:1fr 1fr;gap:3mm 8mm}
.meta label{display:block;font-family:Ubuntu,Arial,sans-serif;font-size:7.5pt;color:var(--mute)}
.meta div div{font-weight:600;min-height:5mm;border-bottom:.6pt solid var(--mist)}
.sumcards{margin-top:7mm;display:grid;grid-template-columns:repeat(3,1fr);gap:5mm}
.sumcards div{border-top:2pt solid var(--sage);padding-top:2.5mm}
.sumcards b{display:block;font-size:10.5pt}
.sumcards span{display:block;font-size:8.3pt;color:var(--mute)}
.sumcards em{display:block;font-style:normal;font-family:Ubuntu,Arial,sans-serif;font-weight:500;font-size:11pt;margin-top:1mm}
.basis{display:flex;flex-wrap:wrap;gap:2mm 7mm;margin:0 0 3.5mm;font-family:Ubuntu,Arial,sans-serif;font-size:8.3pt}
.basis span{color:var(--mute)}.basis b{font-weight:500;color:var(--ink);margin-left:1.5mm}
.mx{width:100%;border-collapse:collapse;font-family:Ubuntu,Arial,sans-serif;font-size:7.9pt;line-height:1.3}
.mx th{padding:2.2mm 1.5mm;text-align:center;vertical-align:bottom;position:relative}
.mx th.lbl-h{text-align:left;font-weight:500;color:var(--mute);font-size:7.5pt}
.mx th.pk b{display:block;font-size:10pt}
.mx th.pk small{display:block;font-weight:400;font-size:7pt;opacity:.85}
.mx th.pk0{background:var(--mist2)}
.mx th.pk1{background:var(--sage);color:#fff}
.mx th.pk2{background:var(--sage-dd);color:#fff}
.mx th .tag{position:absolute;left:50%;top:-3.2mm;transform:translateX(-50%);font-style:normal;background:var(--sun);color:var(--ink);font-size:6.3pt;font-weight:700;padding:.4mm 2mm;border-radius:2mm;white-space:nowrap}
.mx td{padding:1.1mm 1.5mm;border-bottom:.4pt solid #e1e8e8}
.mx td.lbl{width:52%}
.mx td.v{text-align:center;width:16%}
.mx td.sel{background:rgba(242,184,75,.10)}
.mx tr.grp td{padding-top:2.2mm;font-weight:700;color:var(--sage-d);font-size:7.6pt;border-bottom:.8pt solid var(--sage)}
.mx .ok{color:var(--sage-d);font-size:8.5pt}.mx .no{color:#b9c4c4}
.mx tr.pr td{border-bottom:none;border-top:1.2pt solid var(--ink);padding-top:2.4mm}
.mx tr.pr td small{display:block;color:var(--mute);font-size:6.8pt;font-weight:400}
.mx td.price b{font-size:9pt}
.note{font-size:7.6pt;color:var(--mute);margin-top:3mm;line-height:1.45}.note b{color:var(--ink)}
.two{display:grid;grid-template-columns:1.05fr 1fr;gap:7mm}
.scope{margin:0;padding:0;list-style:none}
.scope li{position:relative;padding:0 0 2.1mm 5mm;font-size:8.8pt}
.scope li::before{content:"";position:absolute;left:0;top:1.9mm;width:2mm;height:2mm;background:var(--sage);border-radius:50%}
.tbl{width:100%;border-collapse:collapse;font-family:Ubuntu,Arial,sans-serif;font-size:8.3pt}
.tbl th{background:var(--sage-dd);color:#fff;font-weight:500;padding:2mm;text-align:left}
.tbl th.r,.tbl td.r{text-align:right;white-space:nowrap}
.tbl td{padding:2mm;border-bottom:.4pt solid #dfe6e6;vertical-align:top}
.tbl td small{display:block;color:var(--mute);font-size:7.3pt}
.tbl tr.sel td{background:rgba(242,184,75,.12);font-weight:500}
.tbl tr.tot td{border-bottom:none;padding:1.4mm 2mm}
.tbl tr.tot.muted td{color:var(--mute)}
.tbl tr.grand td{background:var(--sage-dd);color:#fff;font-weight:700;font-size:9.4pt}
.callout{background:var(--mist2);border-left:2.2pt solid var(--sage-d);padding:3.5mm 4.5mm;font-size:8.5pt;margin-top:5mm}
.callout b{display:block;margin-bottom:1mm}
.terms{columns:2;column-gap:7mm;font-size:7.9pt;line-height:1.45;margin:0;padding-left:4mm}
.terms li{margin-bottom:1.6mm;break-inside:avoid}
.sign{display:grid;grid-template-columns:1fr 1fr;gap:10mm;margin-top:6mm}
.sign div{border-top:.7pt solid var(--ink);padding-top:2mm;font-size:8.2pt;height:18mm}
.tbl.compact td{padding:1.3mm 2mm}
.coverTotal{margin-top:6mm;display:flex;justify-content:space-between;align-items:baseline;border-top:1.2pt solid var(--ink);padding-top:3mm;font-family:Ubuntu,Arial,sans-serif}
.coverTotal span{color:var(--mute);font-size:8.5pt}.coverTotal b{font-size:15pt;font-weight:500}
.sign small{display:block;color:var(--mute);font-size:7.3pt}
`;

export function maintenanceOfferHtml(
  input: MaintenanceOfferInput,
  prices: MaintenancePrices,
  result: MaintenanceOfferResult,
  origin: string,
): string {
  const logoUrl = `${origin}${NES_COMPANY.logoPath}`;
  const page = (title: string, body: string) =>
    `<section class="page lh">${letterheadHtml({ logoUrl, title: `${input.offerNo} · ${title}`, footLeft: "nesgrup.com" })}<div class="body">${body}</div></section>`;

  const cards: string[] = [];
  if (input.ges.enabled)
    cards.push(
      `<div><b>GES bakımı</b><span>${TIER_LABEL[input.ges.tier]} · ${fmtNum(input.ges.kwp)} kWp</span><em>${priceOrDash(result.gesTiers[input.ges.tier])} / yıl</em></div>`,
    );
  if (input.trafo.enabled)
    cards.push(
      `<div><b>Trafo merkezi bakımı</b><span>${TIER_LABEL[input.trafo.tier]} · ${Math.max(1, input.trafo.count)} × ${fmtNum(input.trafo.kva)} kVA</span><em>${priceOrDash(result.trafoTiers[input.trafo.tier])} / yıl</em></div>`,
    );
  if (input.isEnabled)
    cards.push(
      `<div><b>İşletme sorumluluğu</b><span>${KVA_BANDS[result.isBand].label}</span><em>${priceOrDash(result.isMonthly)} / ay</em></div>`,
    );

  const meta = [
    ["Müşteri / Firma", input.customerName],
    ["Teklif No", input.offerNo],
    ["Tesis adı ve adresi", input.address],
    ["Tarih", trDate(input.offerDate)],
    ["Yetkili kişi", input.contactPerson],
    ["Telefon / e-posta", input.contactInfo],
  ]
    .map(([l, v]) => `<div><label>${esc(l)}</label><div>${esc(v)}</div></div>`)
    .join("");

  const pages: string[] = [];
  pages.push(
    page(
      "Bakım paketleri teklifi",
      `<div class="cover-top"><div><p class="kicker">Bakım ve işletme hizmetleri teklifi</p><h1>GES ve Trafo Merkezi<br>Bakım Paketleri</h1><p class="lead" style="margin-top:4mm">${esc(input.customerName || "Tesisiniz")} için yıllık bakım paketleri${input.isEnabled ? " ve elektrik işletme sorumluluğu" : ""} teklifimizdir.</p></div><div class="yearmark">${esc(input.offerDate.slice(0, 4))}</div></div>
<div class="cover-band"><div><b>3 kademe</b><span>Temel, Standart ve Premium paket; ihtiyaca ve tesis büyüklüğüne göre seçilir.</span></div><div><b>Ölçüme dayalı</b><span>Her ziyaret fotoğraflı tutanak ve ölçüm sonuçlarıyla raporlanır.</span></div><div><b>Tek muhatap</b><span>GES, trafo merkezi ve işletme sorumluluğu aynı ekipten.</span></div></div>
<div class="meta">${meta}</div>
${cards.length ? `<div class="sumcards">${cards.join("")}</div>` : ""}
${result.net > 0 ? `<div class="coverTotal"><span>Yıllık toplam, KDV hariç${result.discountAmount > 0 ? ` (%${pctText(input.discount)} iskonto dahil)` : ""}</span><b>${money(result.net)} ₺</b></div>` : ""}`,
    ),
  );

  if (input.ges.enabled)
    pages.push(
      page(
        "GES bakım paketleri",
        `<p class="kicker">GES bakımı</p><h2>GES Bakım Paketleri</h2><p class="lead">Bedel kurulu DC güce göre hesaplanmıştır; kademe yükseldikçe ziyaret sayısı ve ölçüm kapsamı artar. Önerilen paket işaretlidir.</p>
<div class="basis"><span>Kurulu güç<b>${fmtNum(input.ges.kwp)} kWp</b></span>${input.ges.inverters ? `<span>İnverter<b>${fmtNum(input.ges.inverters)} adet</b></span>` : ""}${input.ges.siteType ? `<span>Tesis tipi<b>${esc(input.ges.siteType)}</b></span>` : ""}</div>
${matrixHtml(GES_SCOPE, GES_TIER_NOTE, result.gesTiers, input.ges.tier, `${fmtNum(input.ges.kwp)} kWp için`)}
<p class="note"><b>Pakete dahil olmayanlar:</b> yedek parça ve malzeme, panel / inverter değişim işçiliği, üretici garantisi kapsamındaki işler, vinç / platform gerektiren çalışmalar. Bunlar ayrıca fiyatlandırılır. Temizlik sıklığı toz, polen ve kuş kirliliğine göre artırılabilir.</p>`,
      ),
    );

  if (input.trafo.enabled)
    pages.push(
      page(
        "Trafo merkezi bakım paketleri",
        `<p class="kicker">Trafo merkezi bakımı</p><h2>Trafo Merkezi Bakım Paketleri</h2><p class="lead">Enerji kesintisi gerektiren işler müşteri ve dağıtım şirketiyle önceden planlanır. Önerilen paket işaretlidir.</p>
<div class="basis"><span>Trafo gücü<b>${fmtNum(input.trafo.kva)} kVA</b></span><span>Adet<b>${Math.max(1, input.trafo.count)}</b></span>${input.trafo.voltage ? `<span>Gerilim<b>${esc(input.trafo.voltage)}</b></span>` : ""}${input.trafo.kind ? `<span>Tip<b>${esc(input.trafo.kind)}</b></span>` : ""}</div>
${matrixHtml(TRAFO_SCOPE, TRAFO_TIER_NOTE, result.trafoTiers, input.trafo.tier, `${Math.max(1, input.trafo.count)} × ${fmtNum(input.trafo.kva)} kVA için`)}
<p class="note"><b>Pakete dahil olmayanlar:</b> silikajel, yağ ikmali, sigorta ve conta gibi sarf malzemeleri, yağ filtrasyonu / değişimi, arızalı ekipman onarımı. Laboratuvar analizleri akredite laboratuvarda yapılır ve sonuç raporu bakım dosyasına eklenir.</p>`,
      ),
    );

  if (input.isEnabled) {
    const rows = KVA_BANDS.map(
      (b, i) =>
        `<tr${i === result.isBand ? ' class="sel"' : ""}><td>${esc(b.label)}${i === result.isBand ? "<small>Tesisiniz</small>" : ""}</td><td class="r">${priceOrDash(prices.isMonthly[i])}<small>/ ay + KDV</small></td></tr>`,
    ).join("");
    pages.push(
      page(
        "Elektrik işletme sorumluluğu",
        `<p class="kicker">Ayrı kalem</p><h2>Elektrik İşletme Sorumluluğu</h2><p class="lead">Bakım paketlerinden bağımsız sözleşmelenir. NES Enerji adına yetkili elektrik mühendisi, tesisin işletme sorumlusu olarak görev yapar.</p>
<div class="two"><div><ul class="scope">${IS_SCOPE.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></div>
<div><table class="tbl"><thead><tr><th>Kurulu trafo gücü</th><th class="r">Aylık bedel</th></tr></thead><tbody>${rows}</tbody></table>
${prices.isBundleDiscount > 0 ? `<div class="callout"><b>Bakım paketiyle birlikte</b>Bir bakım paketiyle birlikte alındığında aylık bedele %${pctText(prices.isBundleDiscount)} indirim uygulanır.${result.isDiscountApplied ? ` Bu teklifte uygulanmıştır: <b style="display:inline">${money(result.isMonthly)} ₺ / ay</b>.` : ""}</div>` : ""}
<p class="note">Bedeller EMO'nun ilgili yıl için yayımladığı en az ücret tarifesinin altında olamaz. Sözleşme süresi en az 12 aydır.</p></div></div>`,
      ),
    );
  }

  const lineRows = result.lines
    .map(
      (l) =>
        `<tr><td>${esc(l.label)}<small>${esc(l.detail)}</small></td><td class="r">${money(l.amount)} ₺</td></tr>`,
    )
    .join("");
  const extrasRows = EXTRAS.map(
    (x) =>
      `<tr><td>${esc(x.label)}</td><td>${esc(x.unit)}</td><td class="r">${priceOrDash(prices.extras[x.key])}</td></tr>`,
  ).join("");
  const terms = [
    "Fiyatlara KDV dahil değildir; paket bedelleri 12 aylık sözleşme süresi içindir.",
    `Ödeme: ${input.payment || "sözleşmede belirtilir"}. İşletme sorumluluğu aylık faturalandırılır.`,
    "Bakım tarihleri sözleşme başında yıllık plan olarak belirlenir; enerji kesintisi gerektiren işler en az 7 gün önceden planlanır.",
    "Yedek parça, sarf malzemesi ve laboratuvar dışı üçüncü taraf hizmetleri pakete dahil değildir; onay alınarak ayrıca faturalandırılır.",
    "Her ziyaret sonunda fotoğraflı tutanak, ölçüm sonuçları ve bulgu listesi müşteriye iletilir.",
    "Sahaya güvenli erişim, gerekli izinler ve tesis yetkilisinin bulunması müşteri sorumluluğundadır.",
    "Üretici garantisi kapsamındaki işler garanti şartlarına göre üretici veya yetkili servisle koordine edilir.",
    `Teklif geçerlilik süresi ${input.validityDays} gündür.`,
  ];
  pages.push(
    page(
      "Fiyat özeti",
      `<p class="kicker">Teklif</p><h2>Fiyat Özeti</h2>
<table class="tbl compact" style="margin-top:3mm"><thead><tr><th>Hizmet</th><th class="r">Yıllık tutar</th></tr></thead><tbody>${lineRows}
<tr class="tot muted"><td>Ara toplam</td><td class="r">${money(result.subtotal)} ₺</td></tr>
${result.discountAmount > 0 ? `<tr class="tot muted"><td>İskonto (%${pctText(input.discount)})</td><td class="r">-${money(result.discountAmount)} ₺</td></tr>` : ""}
<tr class="tot"><td><b>Toplam (KDV hariç)</b></td><td class="r"><b>${money(result.net)} ₺</b></td></tr>
<tr class="tot muted"><td>KDV (%${pctText(input.vatRate)})</td><td class="r">${money(result.vat)} ₺</td></tr>
<tr class="grand"><td>Genel toplam</td><td class="r">${money(result.grandTotal)} ₺</td></tr></tbody></table>
<table class="tbl compact" style="margin-top:4mm"><thead><tr><th>Ek hizmetler (talep halinde)</th><th>Birim</th><th class="r">Birim fiyat + KDV</th></tr></thead><tbody>${extrasRows}</tbody></table>
<h2 style="font-size:11pt;margin-top:4mm">Genel şartlar</h2>
<ol class="terms">${terms.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>
<div class="sign"><div><b>NES Enerji</b><small>${esc(NES_COMPANY.legalNameShort)}</small><small>Ad Soyad / İmza / Kaşe</small></div><div><b>Müşteri onayı</b><small>${esc(input.customerName)}</small><small>Ad Soyad / İmza / Kaşe / Tarih</small></div></div>`,
    ),
  );

  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${esc(input.offerNo)} Bakım Paketleri Teklifi</title><style>${DOC_CSS}</style></head><body>${pages.join("")}</body></html>`;
}

export function maintenanceOfferFileName(input: MaintenanceOfferInput) {
  const who = asciiSlug(input.customerName || "musteri", 40);
  return `${input.offerNo}_${who}_Bakim_Teklifi.pdf`;
}

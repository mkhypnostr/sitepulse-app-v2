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

// ------------------------------------------------------------- GES paketleri

export const GES_TIERS = ["standart", "premium", "plus"] as const;
export type GesTier = (typeof GES_TIERS)[number];
export const GES_TIER_LABEL: Record<GesTier, string> = {
  standart: "Standart",
  premium: "Premium",
  plus: "Premium Plus",
};

export const SITE_TYPES = ["cati", "arazi"] as const;
export type SiteType = (typeof SITE_TYPES)[number];
export const SITE_LABEL: Record<SiteType, string> = {
  cati: "Çatı",
  arazi: "Arazi",
};

/** GES opsiyonel hizmetleri. "kwp" birimliler kWp × adet ile çarpılır. */
export const GES_OPTIONS = [
  {
    key: "rapor",
    label: "Aylık üretim raporlama (izleme sistemi üzerinden)",
    unit: "Ay",
    qtyLabel: "Ay",
    perKwp: false,
  },
  {
    key: "temizlik",
    label: "Panel temizliği (saf su, kimyasalsız)",
    unit: "kWp / temizlik",
    qtyLabel: "Temizlik",
    perKwp: true,
  },
  {
    key: "termal",
    label: "Ek termal drone taraması",
    unit: "kWp / tarama",
    qtyLabel: "Tarama",
    perKwp: true,
  },
  {
    key: "ariza",
    label: "Paket dışı arıza müdahalesi (ilk 2 saat dahil)",
    unit: "Ziyaret",
    qtyLabel: "Ziyaret",
    perKwp: false,
  },
] as const;
export type GesOptionKey = (typeof GES_OPTIONS)[number]["key"];

/** Trafo / genel ek hizmetler (müşteri birim fiyatı). */
export const EXTRAS = [
  { key: "yag", label: "Ek trafo yağı delinme dayanımı testi", unit: "Numune" },
  { key: "dga", label: "Ek DGA (çözünmüş gaz) analizi", unit: "Numune" },
  {
    key: "topraklama",
    label: "Topraklama / periyodik kontrol raporu",
    unit: "Tesis",
  },
] as const;
export type ExtraKey = (typeof EXTRAS)[number]["key"];

export type GesTierPrice = {
  /** Taşeron fiyatı, ₺ / kWp / yıl */
  costRoof: number;
  costLand: number;
  /** NES kâr oranı (0.3 = %30) */
  margin: number;
  /** Elle müşteri fiyatı; 0 ise maliyet × (1 + kâr) kullanılır. */
  saleRoof: number;
  saleLand: number;
  /** Asgari yıllık müşteri bedeli */
  min: number;
  /** Yıllık saha ziyareti */
  visits: number;
};

export type OptionPrice = { cost: number; margin: number; sale: number };

export type MaintenancePrices = {
  ges: Record<GesTier, GesTierPrice>;
  gesOptions: Record<GesOptionKey, OptionPrice>;
  /** ₺ / trafo / yıl, KVA_BANDS sırasıyla. */
  trafo: Record<Tier, number[]>;
  /** ₺ / ay, KVA_BANDS sırasıyla. */
  isMonthly: number[];
  /** Bakım paketiyle birlikte işletme sorumluluğu indirimi (0–1). */
  isBundleDiscount: number;
  extras: Record<ExtraKey, number>;
};

const zeroBands = () => KVA_BANDS.map(() => 0);
const DEFAULT_VISITS: Record<GesTier, number> = {
  standart: 1,
  premium: 2,
  plus: 2,
};

export function emptyPrices(): MaintenancePrices {
  const ges = Object.fromEntries(
    GES_TIERS.map((t) => [
      t,
      {
        costRoof: 0,
        costLand: 0,
        margin: 0.3,
        saleRoof: 0,
        saleLand: 0,
        min: 0,
        visits: DEFAULT_VISITS[t],
      },
    ]),
  ) as Record<GesTier, GesTierPrice>;
  const gesOptions = Object.fromEntries(
    GES_OPTIONS.map((o) => [o.key, { cost: 0, margin: 0.3, sale: 0 }]),
  ) as Record<GesOptionKey, OptionPrice>;
  return {
    ges,
    gesOptions,
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
const rate = (v: unknown, fallback: number) =>
  v === undefined || v === null ? fallback : Math.min(num(v), 10);

/** Veritabanındaki jsonb'yi eksik/bozuk alanlara karşı güvenle okur. */
export function normalizePrices(raw: unknown): MaintenancePrices {
  const base = emptyPrices();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<Record<keyof MaintenancePrices, unknown>>;
  const ges = (r.ges ?? {}) as Record<string, Partial<GesTierPrice>>;
  for (const t of GES_TIERS) {
    const g = ges[t] ?? {};
    base.ges[t] = {
      costRoof: num(g.costRoof),
      costLand: num(g.costLand),
      margin: rate(g.margin, 0.3),
      saleRoof: num(g.saleRoof),
      saleLand: num(g.saleLand),
      min: num(g.min),
      visits: g.visits === undefined ? DEFAULT_VISITS[t] : num(g.visits),
    };
  }
  const opts = (r.gesOptions ?? {}) as Record<string, Partial<OptionPrice>>;
  for (const o of GES_OPTIONS) {
    const v = opts[o.key] ?? {};
    base.gesOptions[o.key] = {
      cost: num(v.cost),
      margin: rate(v.margin, 0.3),
      sale: num(v.sale),
    };
  }
  const trafo = (r.trafo ?? {}) as Record<string, unknown[]>;
  for (const t of TIERS) {
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

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Taşeron birim fiyatı (₺ / kWp / yıl). */
export function gesUnitCost(p: MaintenancePrices, t: GesTier, site: SiteType) {
  return site === "cati" ? p.ges[t].costRoof : p.ges[t].costLand;
}

/** Müşteri birim fiyatı: elle girilen varsa o, yoksa maliyet × (1 + kâr). */
export function gesUnitSale(p: MaintenancePrices, t: GesTier, site: SiteType) {
  const manual = site === "cati" ? p.ges[t].saleRoof : p.ges[t].saleLand;
  return manual > 0
    ? manual
    : round2(gesUnitCost(p, t, site) * (1 + p.ges[t].margin));
}

export function optionSale(p: MaintenancePrices, key: GesOptionKey) {
  const o = p.gesOptions[key];
  return o.sale > 0 ? o.sale : round2(o.cost * (1 + o.margin));
}

export type MaintenanceOfferInput = {
  customerName: string;
  address: string;
  /** Taşeron talebinde görünen konum (il / ilçe / mevki) */
  location: string;
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
    tier: GesTier;
    site: SiteType;
    kwp: number;
    inverters: number;
    panels: number;
    /** Opsiyonel hizmet miktarları (ay / temizlik / tarama / ziyaret) */
    options: Record<GesOptionKey, number>;
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
    location: "",
    contactPerson: "",
    contactInfo: "",
    offerNo: `NES-BKM-${yy}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`,
    offerDate: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    validityDays: 15,
    vatRate: 0.2,
    discount: 0,
    payment: "Yıllık bedelin %50'si sözleşmede, %50'si 6. ayda",
    ges: {
      enabled: true,
      tier: "premium",
      site: "arazi",
      kwp: 0,
      inverters: 0,
      panels: 0,
      options: Object.fromEntries(GES_OPTIONS.map((o) => [o.key, 0])) as Record<
        GesOptionKey,
        number
      >,
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

export type MaintenanceLine = {
  key: string;
  label: string;
  detail: string;
  amount: number;
  /** İç maliyet (taşeron); bilinmiyorsa null. Müşteri belgelerinde yok. */
  cost: number | null;
};

export type GesTierResult = {
  unit: number;
  yearly: number;
  unitCost: number;
  yearlyCost: number;
};

export type MaintenanceOfferResult = {
  /** Bu tesis için her GES paketinin bedeli (karşılaştırma tablosu). */
  ges: Record<GesTier, GesTierResult>;
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
  /** Maliyeti bilinen kalemlerin taşeron maliyeti ve satış tutarı. */
  knownCost: number;
  knownSale: number;
};

/** Premium Plus'ta aylık raporlama pakete dahildir. */
export function optionAvailable(key: GesOptionKey, tier: GesTier) {
  return !(key === "rapor" && tier === "plus");
}

function optionQtyBase(key: GesOptionKey, qty: number, kwp: number) {
  const o = GES_OPTIONS.find((x) => x.key === key)!;
  return o.perKwp ? qty * kwp : qty;
}

export function calculateMaintenanceOffer(
  input: MaintenanceOfferInput,
  prices: MaintenancePrices,
): MaintenanceOfferResult {
  const { kwp, site } = input.ges;
  const ges = Object.fromEntries(
    GES_TIERS.map((t) => {
      const unit = gesUnitSale(prices, t, site);
      const unitCost = gesUnitCost(prices, t, site);
      const yearly = round2(
        kwp > 0 ? Math.max(kwp * unit, prices.ges[t].min) : 0,
      );
      return [
        t,
        { unit, yearly, unitCost, yearlyCost: round2(kwp * unitCost) },
      ];
    }),
  ) as Record<GesTier, GesTierResult>;

  const trafoBand = kvaBand(input.trafo.kva);
  const count = Math.max(1, input.trafo.count);
  const trafoTier = (t: Tier) =>
    round2(input.trafo.kva > 0 ? prices.trafo[t][trafoBand] * count : 0);
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
  if (input.ges.enabled) {
    const g = ges[input.ges.tier];
    lines.push({
      key: "ges",
      label: `GES bakım paketi · ${GES_TIER_LABEL[input.ges.tier]}`,
      detail: `${SITE_LABEL[site]} · ${fmtNum(kwp)} kWp × ${money(g.unit)} ₺/kWp · ${prices.ges[input.ges.tier].visits} ziyaret / yıl`,
      amount: g.yearly,
      cost: g.yearlyCost,
    });
    for (const o of GES_OPTIONS) {
      const qty = input.ges.options[o.key] ?? 0;
      if (qty <= 0 || !optionAvailable(o.key, input.ges.tier)) continue;
      const base = optionQtyBase(o.key, qty, kwp);
      const unit = optionSale(prices, o.key);
      lines.push({
        key: `o-${o.key}`,
        label: o.label,
        detail: o.perKwp
          ? `${fmtNum(qty)} ${o.qtyLabel.toLowerCase()} × ${fmtNum(kwp)} kWp × ${money(unit)} ₺`
          : `${fmtNum(qty)} ${o.qtyLabel.toLowerCase()} × ${money(unit)} ₺`,
        amount: round2(base * unit),
        cost: round2(base * prices.gesOptions[o.key].cost),
      });
    }
  }
  if (input.trafo.enabled)
    lines.push({
      key: "trafo",
      label: `Trafo merkezi bakım paketi · ${TIER_LABEL[input.trafo.tier]}`,
      detail: `${count} × ${fmtNum(input.trafo.kva)} kVA, 12 ay`,
      amount: trafoTiers[input.trafo.tier],
      cost: null,
    });
  if (input.isEnabled)
    lines.push({
      key: "is",
      label: "Elektrik işletme sorumluluğu",
      detail: `${KVA_BANDS[isBand].label}, ${money(isMonthly)} ₺/ay × 12${isDiscountApplied ? ` (paket indirimi %${pctText(isDiscountApplied)})` : ""}`,
      amount: isYearly,
      cost: null,
    });
  for (const x of EXTRAS) {
    const qty = input.extras[x.key] ?? 0;
    if (qty > 0)
      lines.push({
        key: `x-${x.key}`,
        label: x.label,
        detail: `${fmtNum(qty)} ${x.unit} × ${money(prices.extras[x.key])} ₺`,
        amount: round2(qty * prices.extras[x.key]),
        cost: null,
      });
  }
  const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
  const discountAmount = round2(subtotal * input.discount);
  const net = round2(subtotal - discountAmount);
  const vat = round2(net * input.vatRate);
  const known = lines.filter((l) => l.cost !== null);
  return {
    ges,
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
    knownCost: round2(known.reduce((s, l) => s + (l.cost ?? 0), 0)),
    knownSale: round2(
      known.reduce((s, l) => s + l.amount, 0) * (1 - input.discount),
    ),
  };
}

// ------------------------------------------------------------- kapsam

type Cell = boolean | string;
type Row = [label: string, temel: Cell, standart: Cell, premium: Cell];
type Group = [title: string, rows: Row[]];

export const TRAFO_TIER_NOTE: Record<Tier, string> = {
  temel: "Yılda 1 bakım",
  standart: "Yılda 2 bakım",
  premium: "2 bakım + 2 kontrol",
};

/** GES paket kapsamı: true = dahil, false = dahil değil, "opt" = opsiyonel. */
export type GesCell = boolean | "opt";
export const GES_SCOPE: [label: string, cells: Record<GesTier, GesCell>][] = [
  [
    "Mekanik bağlantıların kontrolü",
    { standart: true, premium: true, plus: true },
  ],
  [
    "Tork kontrollerinin yapılması",
    { standart: true, premium: true, plus: true },
  ],
  ["Topraklama ölçümleri", { standart: true, premium: true, plus: true }],
  [
    "Bakım işlemlerinin raporlanması",
    { standart: true, premium: true, plus: true },
  ],
  ["İzolasyon testleri", { standart: false, premium: true, plus: true }],
  ["I-V testleri", { standart: false, premium: true, plus: true }],
  [
    "Termal drone ile saha kontrolü",
    { standart: false, premium: false, plus: true },
  ],
  ["Aylık üretim raporlama", { standart: "opt", premium: "opt", plus: true }],
];

/** Ek-1 Teknik Şartname (GES). Her bölüm: başlık + paragraflar. */
export const GES_SPEC: [title: string, paragraphs: string[]][] = [
  [
    "1. Amaç ve kapsam",
    [
      "Bu şartname, teklifte tanımlanan güneş enerji santralinin (GES) seçilen bakım paketine göre yapılacak periyodik bakım, ölçüm, test ve raporlama işlerinin yöntemini ve kabul ölçütlerini belirler. Hangi işin hangi pakete dahil olduğu teklifteki kapsam tablosuna göredir.",
    ],
  ],
  [
    "2. Genel şartlar",
    [
      "Çalışmalar; Elektrik Tesislerinde Topraklamalar Yönetmeliği, Elektrik İç Tesisleri Yönetmeliği, 6331 sayılı İş Sağlığı ve Güvenliği Kanunu ve ilgili TS EN / IEC standartlarına (özellikle IEC 62446-1 ve IEC TS 62446-3) uygun yapılır.",
      "Ölçümler kalibrasyon sertifikası geçerli cihazlarla yapılır; sertifika örnekleri rapora eklenir. DC tarafta çalışmadan önce inverter ve string ayırıcıları açılır, kilitleme-etiketleme (LOTO) uygulanır; yalıtkan eldiven ve ark korumalı KKD kullanılır.",
      "Saha çalışmasına başlamadan önce tesis yetkilisine bilgi verilir; çalışma sonunda tesis güvenli ve çalışır durumda teslim edilir.",
    ],
  ],
  [
    "3. Mekanik bağlantıların kontrolü",
    [
      "Konstrüksiyon ayakları, kolon-kiriş birleşimleri, panel kelepçeleri, ray ekleri ve ankraj noktaları gözle ve elle kontrol edilir. Korozyon, deformasyon, eksik veya gevşek bağlantı elemanı, çatı tiplerinde su yalıtımı hasarı ve kablo taşıyıcıların durumu kayıt altına alınır.",
    ],
  ],
  [
    "4. Tork kontrolleri",
    [
      "Konstrüksiyon ve panel bağlantı cıvataları, üretici montaj kılavuzundaki tork değerlerine göre kalibre tork anahtarıyla kontrol edilir ve işaretlenir. Tork değeri altında kalan bağlantılar yeniden sıkılır. Büyük tesislerde örnekleme oranı (en az %10) ve seçilen bölgeler raporda belirtilir.",
    ],
  ],
  [
    "5. Topraklama ölçümleri",
    [
      "Koruma ve işletme topraklama direnci, eşpotansiyel bağlantıların sürekliliği ve konstrüksiyon-panel çerçevesi topraklama bağlantıları ölçülür; sonuçlar yönetmelikteki sınır değerlerle karşılaştırılır. Ölçüm raporu yetkili elektrik mühendisi imzasıyla düzenlenir.",
    ],
  ],
  [
    "6. İzolasyon testleri",
    [
      "Her string için DC izolasyon direnci (pozitif-toprak, negatif-toprak) IEC 62446-1'e uygun test gerilimiyle ölçülür. Sınır değerin altındaki stringlerde kablo, konnektör ve bağlantı kutuları incelenir, arıza yeri raporlanır.",
    ],
  ],
  [
    "7. I-V testleri",
    [
      "String bazında I-V eğrisi; ışınım ve modül sıcaklığı eşzamanlı kaydedilerek, kararlı ve yeterli ışınımda (tercihen 600 W/m² üzeri) ölçülür ve standart test koşullarına (STC) düzeltilir. Voc, Isc, Pmpp ve dolum faktörü beklenen değerle karşılaştırılır; sapma gösteren stringler raporlanır.",
    ],
  ],
  [
    "8. Termal drone ile saha kontrolü",
    [
      "Radyometrik termal kameralı drone ile IEC TS 62446-3'e uygun tarama, yeterli ışınımda (tercihen 600 W/m² üzeri) ve açık havada yapılır. Sıcak nokta, by-pass diyot arızası, hücre kırığı, kirlenme ve bağlantı kutusu ısınması gibi anomaliler panel / sıra konumuyla sınıflandırılarak raporlanır. Uçuşlar mevzuata ve tesis güvenlik kurallarına uygun izinlerle yapılır.",
    ],
  ],
  [
    "9. Bakım işlemlerinin raporlanması",
    [
      "Her saha ziyaretinden sonra en geç 5 iş günü içinde fotoğraflı bakım raporu teslim edilir. Raporda yapılan işler, ölçüm ve test sonuçları, uygunsuzluklar, aciliyet derecesi ve önerilen düzeltici faaliyetler yer alır.",
    ],
  ],
  [
    "10. Aylık üretim raporlama",
    [
      "İzleme sistemine verilen erişimle aylık üretim (kWh), özgül verim (kWh/kWp), performans oranı (PR), inverter arıza kayıtları ve önceki dönemle karşılaştırma içeren rapor her ayın ilk 10 günü içinde gönderilir. Premium Plus pakete dahildir; diğer paketlerde opsiyoneldir.",
    ],
  ],
  [
    "11. Müşterinin sorumlulukları",
    [
      "Sahaya güvenli erişimin sağlanması; izleme sistemi, tek hat şeması ve tesis belgelerinin paylaşılması; enerji kesintisi gerektiren işler için izinlerin verilmesi ve çalışma sırasında tesis yetkilisinin ulaşılabilir olması müşterinin sorumluluğundadır.",
    ],
  ],
  [
    "12. Kapsam dışı işler",
    [
      "Yedek parça ve malzeme bedelleri, panel / inverter / konstrüksiyon değişimi ve onarım işçiliği, üretici garantisi kapsamındaki işler, vinç / platform gerektiren çalışmalar ve doğal afet sonrası hasar tespiti paket bedeline dahil değildir; onaylı ayrı teklifle yapılır.",
    ],
  ],
];

/** Ek-2 Bakım Hizmet Sözleşmesi maddeleri (teklif verisiyle doldurulur). */
export function contractArticles(
  input: MaintenanceOfferInput,
  result: MaintenanceOfferResult,
): [title: string, paragraphs: string[]][] {
  const services =
    result.lines.map((l) => l.label).join(", ") || "teklifte seçilen hizmetler";
  const site = input.ges.enabled
    ? ` (${SITE_LABEL[input.ges.site]} tipi GES, ${fmtNum(input.ges.kwp)} kWp)`
    : "";
  return [
    [
      "Madde 1 · Taraflar",
      [
        `Hizmet Veren: ${NES_COMPANY.legalName} (${NES_COMPANY.taxOffice}, VKN ${NES_COMPANY.taxNo}), ${NES_COMPANY.address}. Bundan sonra "NES Enerji" olarak anılacaktır.`,
        `Hizmet Alan: ${input.customerName.trim().replace(/\.$/, "") || "………………………………………"}. Bundan sonra "Müşteri" olarak anılacaktır.`,
      ],
    ],
    [
      "Madde 2 · Sözleşmenin konusu",
      [
        `Bu sözleşmenin konusu, ${input.address || "Müşteri'ye ait tesis"}${site} için teklifte seçilen hizmetlerin (${services}) Ek-1 Teknik Şartname'ye uygun olarak yapılmasıdır.`,
      ],
    ],
    [
      "Madde 3 · Süre",
      [
        "Sözleşme imza tarihinden itibaren 12 ay geçerlidir. Sürenin bitiminden en az 30 gün önce taraflardan biri yazılı fesih bildiriminde bulunmazsa sözleşme aynı şartlarla bir dönem daha uzar; yeni dönem bedeli taraflarca yazılı olarak belirlenir.",
      ],
    ],
    [
      "Madde 4 · Bedel ve ödeme",
      [
        `Yıllık sözleşme bedeli ${money(result.net)} ₺ + KDV'dir (KDV dahil ${money(result.grandTotal)} ₺). Ödeme şekli: ${input.payment || "taraflarca yazılı belirlenir"}.`,
        `Ödemeler NES Enerji'nin ${NES_COMPANY.bank} ${NES_COMPANY.iban} hesabına yapılır. Vadesinde ödenmeyen tutarlar için NES Enerji, yazılı bildirimden 15 gün sonra hizmeti durdurma hakkına sahiptir. Paket dışı işler onaylı ayrı teklif üzerinden faturalandırılır.`,
      ],
    ],
    [
      "Madde 5 · NES Enerji'nin yükümlülükleri",
      [
        "Hizmetleri Ek-1 Teknik Şartname'ye, ilgili mevzuata ve İSG kurallarına uygun olarak yetkin personelle ve kalibre cihazlarla yapmak; yıllık bakım planını sözleşme başında paylaşmak; her ziyaretten sonra raporu en geç 5 iş günü içinde teslim etmek; acil müdahale gerektiren bir tespiti aynı gün bildirmek.",
      ],
    ],
    [
      "Madde 6 · Müşterinin yükümlülükleri",
      [
        "Sahaya güvenli erişimi, izleme sistemi erişimini ve tesis belgelerini sağlamak; enerji kesintisi gerektiren çalışmalar için izinleri vermek ve tesis yetkilisini hazır bulundurmak; bedeli zamanında ödemek; tesiste yapılan değişiklikleri NES Enerji'ye bildirmek.",
      ],
    ],
    [
      "Madde 7 · Sorumluluk ve garanti",
      [
        "NES Enerji yalnızca kendi kusuruyla verdiği doğrudan zararlardan sorumludur; dolaylı zarar, kâr ve üretim kaybından sorumlu tutulamaz. Toplam sorumluluk ilgili sözleşme yılı bedeliyle sınırlıdır. Bakım hizmeti; üretici garantilerini, sigorta teminatlarını ve tesisin performans garantisini devralmaz.",
      ],
    ],
    [
      "Madde 8 · Gizlilik ve kişisel veriler",
      [
        "Taraflar, sözleşme kapsamında edindikleri ticari ve teknik bilgileri gizli tutar. Kişisel veriler 6698 sayılı KVKK'ya uygun olarak yalnızca bu sözleşmenin ifası amacıyla işlenir.",
      ],
    ],
    [
      "Madde 9 · Mücbir sebep",
      [
        "Doğal afet, salgın, savaş, resmi makam kararları ve tarafların kontrolü dışındaki benzeri olaylar mücbir sebep sayılır. Mücbir sebep süresince yükümlülükler askıya alınır; 60 günü aşarsa taraflardan her biri sözleşmeyi tazminatsız feshedebilir.",
      ],
    ],
    [
      "Madde 10 · Fesih",
      [
        "Taraflardan biri yükümlülüklerini yazılı ihtara rağmen 15 gün içinde yerine getirmezse diğer taraf sözleşmeyi feshedebilir. Fesih halinde o tarihe kadar verilen hizmet bedelleri ödenir.",
      ],
    ],
    [
      "Madde 11 · Uyuşmazlıklar ve tebligat",
      [
        "Uyuşmazlıklarda Muğla Mahkemeleri ve İcra Daireleri yetkilidir. Tarafların yukarıdaki adresleri tebligat adresidir; adres değişikliği yazılı bildirilmedikçe bu adreslere yapılan tebligat geçerlidir.",
      ],
    ],
    [
      "Madde 12 · Yürürlük",
      [
        "Teklif, Ek-1 Teknik Şartname ve bu sözleşme bir bütündür. 12 maddeden oluşan bu sözleşme iki nüsha olarak düzenlenmiş ve taraflarca okunarak imzalanmıştır.",
      ],
    ],
  ];
}

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
.cmp{width:100%;border-collapse:separate;border-spacing:2mm 0;margin:0 -2mm;font-family:Ubuntu,Arial,sans-serif;font-size:8.6pt}
.cmp th{padding:3mm 2mm;color:#fff;font-size:11pt;font-weight:700;text-align:center;border-radius:2mm 2mm 0 0;position:relative}
.cmp th.lbl-h{background:none;color:var(--mute);font-size:8pt;font-weight:500;text-align:left}
.cmp th.c0{background:#5e7fb8}.cmp th.c1{background:#2f5fa8}.cmp th.c2{background:#1b3f7a}
.cmp th .tag{position:absolute;left:50%;top:-3.4mm;transform:translateX(-50%);background:var(--sun);color:var(--ink);font-size:6.5pt;font-weight:700;padding:.5mm 2.2mm;border-radius:2mm;white-space:nowrap}
.cmp td{padding:1.9mm 2mm;border-bottom:.4pt solid #e1e8e8;background:#f6f8f8}
.cmp td.lbl{background:none;width:40%}
.cmp td.v{text-align:center;width:20%}
.cmp td.sel{background:#fff4dc}
.cmp .y{color:#2e7d32;font-weight:700;font-size:10pt}.cmp .n{color:#c62828;font-weight:700;font-size:10pt}.cmp .o{color:#b7791f;font-size:7.6pt;font-weight:700}
.cmp tr.unit td{color:var(--mute);font-size:8pt}
.cmp tr.year td{font-weight:700;font-size:10pt;border-top:1.2pt solid var(--ink)}
.cmp tr.year td.v{color:#1b3f7a}
.cmp tr.gross td{background:var(--sage-dd);color:#fff;font-weight:700}
.cmp tr.gross td.lbl{background:var(--sage-dd);padding-left:2mm}
.legend{font-size:7.4pt;color:var(--mute);margin:2mm 0 4mm}
.spec h3{font-size:9.4pt;margin:2.6mm 0 .8mm;color:#1b3f7a}
.spec p{font-size:8.1pt;line-height:1.42;margin:0 0 1mm 3mm}
.contract h3{font-size:9.2pt;margin:2.6mm 0 .6mm;color:#1b3f7a}
.contract p{font-size:8.1pt;line-height:1.42;margin:0 0 1mm 3mm}
`;

function gesComparisonHtml(
  input: MaintenanceOfferInput,
  prices: MaintenancePrices,
  result: MaintenanceOfferResult,
) {
  const sel = input.ges.tier;
  const head = GES_TIERS.map(
    (t, i) =>
      `<th class="c${i}">${t === sel ? '<i class="tag">★ Önerilen</i>' : ""}${esc(GES_TIER_LABEL[t].toUpperCase())}</th>`,
  ).join("");
  const cell = (c: GesCell, t: GesTier) => {
    const cls = `v${t === sel ? " sel" : ""}`;
    if (c === true) return `<td class="${cls}"><span class="y">✓</span></td>`;
    if (c === false) return `<td class="${cls}"><span class="n">✗</span></td>`;
    return `<td class="${cls}"><span class="o">○ Opsiyonel</span></td>`;
  };
  const rows = GES_SCOPE.map(
    ([label, cells]) =>
      `<tr><td class="lbl">${esc(label)}</td>${GES_TIERS.map((t) => cell(cells[t], t)).join("")}</tr>`,
  ).join("");
  const row = (cls: string, label: string, f: (t: GesTier) => string) =>
    `<tr class="${cls}"><td class="lbl">${label}</td>${GES_TIERS.map((t) => `<td class="v${t === sel ? " sel" : ""}">${f(t)}</td>`).join("")}</tr>`;
  return `<table class="cmp"><thead><tr><th class="lbl-h">Hizmet kapsamı</th>${head}</tr></thead><tbody>${rows}
${row("", "Yıllık saha ziyareti", (t) => `<b>${prices.ges[t].visits} kez</b>`)}
${row("unit", "Birim fiyat (₺ / kWp / yıl)", (t) => priceOrDash(result.ges[t].unit))}
${row("year", "Yıllık paket bedeli (KDV hariç)", (t) => priceOrDash(result.ges[t].yearly))}
${row("unit", `KDV (%${pctText(input.vatRate)})`, (t) => priceOrDash(result.ges[t].yearly * input.vatRate))}
${row("gross", "Yıllık toplam (KDV dahil)", (t) => priceOrDash(result.ges[t].yearly * (1 + input.vatRate)))}
</tbody></table>
<p class="legend">✓ Dahil · ✗ Dahil değil · ○ Opsiyonel (ayrıca fiyatlandırılır) · ★ Önerilen paket</p>`;
}

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
      `<div><b>GES bakımı</b><span>${GES_TIER_LABEL[input.ges.tier]} · ${SITE_LABEL[input.ges.site]} · ${fmtNum(input.ges.kwp)} kWp</span><em>${priceOrDash(result.ges[input.ges.tier].yearly)} / yıl</em></div>`,
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

  const onlyGes = input.ges.enabled && !input.trafo.enabled && !input.isEnabled;
  const pages: string[] = [];
  pages.push(
    page(
      "Bakım paketleri teklifi",
      `<div class="cover-top"><div><p class="kicker">Bakım ve işletme hizmetleri teklifi</p><h1>${onlyGes ? "GES Bakım<br>Paketleri" : "GES ve Trafo Merkezi<br>Bakım Paketleri"}</h1><p class="lead" style="margin-top:4mm">${esc(input.customerName || "Tesisiniz")} için yıllık bakım paketleri${input.isEnabled ? " ve elektrik işletme sorumluluğu" : ""} teklifimizdir. Hizmetlerin ayrıntılı kapsamı Ek-1 Teknik Şartname'de, sözleşme şartları Ek-2'de yer almaktadır.</p></div><div class="yearmark">${esc(input.offerDate.slice(0, 4))}</div></div>
<div class="cover-band"><div><b>3 paket</b><span>Standart, Premium ve Premium Plus; tesisin ihtiyacına göre seçilir.</span></div><div><b>Ölçüme dayalı</b><span>Her ziyaret fotoğraflı rapor ve ölçüm sonuçlarıyla teslim edilir.</span></div><div><b>Tek muhatap</b><span>GES, trafo merkezi ve işletme sorumluluğu aynı ekipten.</span></div></div>
<div class="meta">${meta}</div>
${cards.length ? `<div class="sumcards">${cards.join("")}</div>` : ""}
${result.net > 0 ? `<div class="coverTotal"><span>Yıllık toplam, KDV hariç${result.discountAmount > 0 ? ` (%${pctText(input.discount)} iskonto dahil)` : ""}</span><b>${money(result.net)} ₺</b></div>` : ""}`,
    ),
  );

  if (input.ges.enabled) {
    const optRows = GES_OPTIONS.filter((o) =>
      optionAvailable(o.key, input.ges.tier),
    )
      .map((o) => {
        const unit = optionSale(prices, o.key);
        const forSite = o.perKwp
          ? unit * input.ges.kwp
          : o.key === "rapor"
            ? unit * 12
            : 0;
        return `<tr><td>${esc(o.label)}</td><td>${esc(o.unit)}</td><td class="r">${priceOrDash(unit)}</td><td class="r">${o.key === "ariza" ? "Ziyaret başına" : `${priceOrDash(forSite)}${o.key === "rapor" ? " / yıl" : ""}`}</td></tr>`;
      })
      .join("");
    pages.push(
      page(
        "GES bakım paketleri",
        `<p class="kicker">GES bakımı</p><h2>GES Bakım Paketleri</h2><p class="lead">Fiyatlar tesisinizin tipine ve kurulu gücüne göre kWp başına hesaplanmıştır.</p>
<div class="basis"><span>Tesis tipi<b>${SITE_LABEL[input.ges.site]}</b></span><span>Kurulu güç<b>${fmtNum(input.ges.kwp)} kWp</b></span>${input.ges.inverters ? `<span>İnverter<b>${fmtNum(input.ges.inverters)} adet</b></span>` : ""}${input.ges.panels ? `<span>Panel<b>${fmtNum(input.ges.panels)} adet</b></span>` : ""}</div>
${gesComparisonHtml(input, prices, result)}
<table class="tbl compact"><thead><tr><th>Opsiyonel hizmetler</th><th>Birim</th><th class="r">Birim fiyat</th><th class="r">Bu tesis için</th></tr></thead><tbody>${optRows}</tbody></table>
<p class="note"><b>Pakete dahil olmayanlar:</b> yedek parça ve malzeme, panel / inverter değişim işçiliği, üretici garantisi kapsamındaki işler ve vinç / platform gerektiren çalışmalar ayrıca fiyatlandırılır.</p>`,
      ),
    );
  }

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
  const extrasRows = (input.trafo.enabled || input.isEnabled ? EXTRAS : [])
    .map(
      (x) =>
        `<tr><td>${esc(x.label)}</td><td>${esc(x.unit)}</td><td class="r">${priceOrDash(prices.extras[x.key])}</td></tr>`,
    )
    .join("");
  const terms = [
    "Fiyatlar Türk Lirası olup KDV hariçtir; paket bedelleri 12 aylık sözleşme dönemi içindir.",
    `Ödeme: ${input.payment || "sözleşmede belirtilir"}.${input.isEnabled ? " İşletme sorumluluğu aylık faturalandırılır." : ""}`,
    "Yedek parça, malzeme ve onarım işçiliği paket bedeline dahil değildir; tespit edilen arızalar onaylı ayrı teklifle giderilir.",
    "Bakım tarihleri sözleşme başında yıllık plan olarak belirlenir; enerji kesintisi gerektiren işler en az 7 gün önceden planlanır.",
    "Her ziyaret sonunda fotoğraflı rapor, ölçüm sonuçları ve bulgu listesi müşteriye iletilir.",
    "Sahaya güvenli erişim, gerekli izinler ve tesis yetkilisinin bulunması müşteri sorumluluğundadır.",
    "Termal drone uçuşları, mevzuat ve tesis güvenlik kurallarına uygun izinler alınarak yapılır.",
    `Teklif ${trDate(input.offerDate)} tarihinden itibaren ${input.validityDays} gün geçerlidir.`,
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
${extrasRows ? `<table class="tbl compact" style="margin-top:4mm"><thead><tr><th>Ek hizmetler (talep halinde)</th><th>Birim</th><th class="r">Birim fiyat + KDV</th></tr></thead><tbody>${extrasRows}</tbody></table>` : ""}
<h2 style="font-size:11pt;margin-top:4mm">Teklif koşulları</h2>
<ol class="terms">${terms.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>
<div class="sign"><div><b>NES Enerji</b><small>${esc(NES_COMPANY.legalNameShort)}</small><small>Ad Soyad / İmza / Kaşe</small></div><div><b>Müşteri onayı</b><small>${esc(input.customerName)}</small><small>Ad Soyad / İmza / Kaşe / Tarih</small></div></div>`,
    ),
  );

  if (input.ges.enabled)
    pages.push(
      page(
        "Ek-1 Teknik Şartname",
        `<p class="kicker">Ek-1</p><h2>GES Bakım Hizmetleri Teknik Şartnamesi</h2><div class="spec">${GES_SPEC.map(
          ([title, paras]) =>
            `<h3>${esc(title)}</h3>${paras.map((x) => `<p>${esc(x)}</p>`).join("")}`,
        ).join("")}</div>`,
      ),
    );

  const articles = contractArticles(input, result);
  const art = (list: typeof articles) =>
    list
      .map(
        ([title, paras]) =>
          `<h3>${esc(title)}</h3>${paras.map((x) => `<p>${esc(x)}</p>`).join("")}`,
      )
      .join("");
  pages.push(
    page(
      "Ek-2 Bakım Hizmet Sözleşmesi",
      `<p class="kicker">${input.ges.enabled ? "Ek-2" : "Ek-1"}</p><h2>Bakım Hizmet Sözleşmesi</h2><div class="contract">${art(articles.slice(0, 9))}</div>`,
    ),
  );
  pages.push(
    page(
      "Ek-2 Bakım Hizmet Sözleşmesi",
      `<div class="contract">${art(articles.slice(9))}</div>
<p style="margin-top:6mm">Tarih: ……/……/20……</p>
<div class="sign" style="margin-top:10mm"><div><b>HİZMET VEREN</b><small>${esc(NES_COMPANY.legalNameShort)}</small><small>Ad Soyad / Kaşe / İmza</small></div><div><b>HİZMET ALAN</b><small>${esc(input.customerName)}</small><small>Ad Soyad / Kaşe / İmza</small></div></div>`,
    ),
  );

  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${esc(input.offerNo)} Bakım Paketleri Teklifi</title><style>${DOC_CSS}</style></head><body>${pages.join("")}</body></html>`;
}

export function maintenanceOfferFileName(input: MaintenanceOfferInput) {
  const who = asciiSlug(input.customerName || "musteri", 40);
  return `${input.offerNo}_${who}_Bakim_Teklifi.pdf`;
}

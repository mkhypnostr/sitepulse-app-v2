// GES / EV Şarj / Taahhüt teklif hazırlayıcısının hesap mantığı.
// Arayüzden bağımsızdır: katalog + kullanıcı girdisi -> teklif kalemleri,
// kur çevrimi, toplamlar ve kontrol uyarıları.

import type { FinanceConfig } from "@/lib/energy-offer-finance";
import type { SiteConfig } from "@/lib/solar-site";

export type Currency = "TRY" | "USD" | "EUR";
export type OfferModule = "ges" | "sarj" | "taahhut" | "genel";
export type LineCategory = "malzeme" | "iscilik" | "nakliye_sarf" | "diger";

export type CatalogItem = {
  id: string;
  code: string;
  module: OfferModule;
  category: string;
  template_role: string | null;
  name: string;
  brand: string | null;
  model: string | null;
  description: string | null;
  unit: string;
  power_w: number | null;
  power_kw: number | null;
  capacity_kwh: number | null;
  phase: "mono" | "trifaze" | null;
  cost_amount: number;
  currency: Currency;
  markup_rate: number;
  line_category: LineCategory;
  source: string | null;
  price_date: string | null;
  is_active: boolean;
  sort_order: number;
};

export type DraftLine = {
  key: string;
  catalogItemId: string | null;
  module: OfferModule;
  category: LineCategory;
  description: string;
  brand: string | null;
  unit: string;
  quantity: number;
  /** Birim alış fiyatı, kaynak para biriminde (ölçek katsayısı uygulanmış). */
  sourceUnitCost: number;
  sourceCurrency: Currency;
  markupRate: number;
  /** Modül ayarlarından otomatik üretildiyse true; yeniden üretimde değişir. */
  auto: boolean;
  visibleToCustomer: boolean;
};

export type GesSystemType = "ongrid" | "hibrit";
export type RoofType = "kiremit" | "trapez" | "arazi";

export type GesConfig = {
  enabled: boolean;
  systemType: GesSystemType;
  panelId: string;
  panelCount: number;
  inverterId: string;
  inverterCount: number;
  batteryId: string;
  batteryCount: number;
  roofType: RoofType;
  dcCableM: number;
  acCableM: number;
  /** Abonelik sözleşme gücü (kW). 0 = bilinmiyor. */
  contractPowerKw: number;
  /** Proje tipi seçicisinde seçilen tip (ör. "konut"). Yalnız bilgi amaçlı;
   * sistem tipi ve montaj yerini önerir, hesaba girmez. */
  projectType?: string;
};

export type SarjConfig = {
  enabled: boolean;
  stationId: string;
  stationCount: number;
  phase: "mono" | "trifaze";
  cableMPerStation: number;
  withStand: boolean;
  /** Bina bağlantı gücü (kW). 0 = bilinmiyor. */
  connectionPowerKw: number;
};

export type PaymentStep = { label: string; percent: number; note?: string };

/** Müşteri dosyasının düzeni. "otomatik": GES varsa NES sunum dosyası, yoksa
 * NES "TEKLİF" formu. "teknik": büyük taahhüt/OG işleri için Word tarzı
 * "Teknik ve Ticari Teklif". */
export type OfferLayout = "otomatik" | "teknik";

/** Teknik ve ticari teklif metinleri. Liste alanları satır satır yazılır;
 * "Başlık: açıklama" biçimindeki satırlar başlık + açıklama olarak ayrılır. */
export type TechnicalContent = {
  subtitle: string;
  duration: string;
  warranty: string;
  preparedByName: string;
  preparedByTitle: string;
  intro: string;
  projectDescription: string;
  summaryCards: string;
  technicalData: string;
  specialNotes: string;
  included: string;
  excluded: string;
  methodology: string;
  /** "Faaliyet | 1-4 | malzeme" satırları. */
  schedule: string;
  scheduleWeeks: number;
};

export const defaultTechnical: TechnicalContent = {
  subtitle: "",
  duration: "8 hafta",
  warranty:
    "İşçilik 2 yıl, malzeme üretici garantisi; geçici kabul sonrası arıza müdahale desteği.",
  preparedByName: "Enes Demirhan",
  preparedByTitle: "Elektrik Mühendisi – NES Grup",
  intro: "",
  projectDescription: "",
  summaryCards: "",
  technicalData: "",
  specialNotes: "",
  included: [
    "Projeye uygun tüm malzemelerin TEDAŞ/EDAŞ şartnamelerine uygun tedariki",
    "Montaj, kablolama, pano ve bağlantı işleri",
    "Topraklama tesisleri ve ölçümleri",
    "Test, devreye alma ve EDAŞ enerji kesinti/manevra koordinasyonu",
    "As-built dokümanları, geçici kabul dosyası ve kabul sürecinin takibi",
    "İSG planı, şantiye güvenliği, trafik ve emniyet tedbirleri",
  ].join("\n"),
  excluded: [
    "EDAŞ bağlantı bedeli, güvence, proje onay ve kurum harçları",
    "Kazı ruhsatı ve belediye/karayolu altyapı izin bedelleri",
    "Projede olmayan, idarece sonradan istenebilecek ilave tesis ve revizyonlar",
    "Kaya zemin, yeraltı su seviyesi veya mevcut altyapı nedeniyle oluşacak ek imalatlar",
  ].join("\n"),
  methodology: [
    "Hazırlık ve aplikasyon: Proje, saha ve güzergâh kontrolü; aplikasyon ve EDAŞ yer teslimi.",
    "Uzun termin malzeme: Uzun termin malzemelerin sözleşme günü siparişi; üretici test belgelerinin temini.",
    "Montaj: Proje ve şartnamelere uygun mekanik ve elektriksel montaj, kablolama ve bağlantılar.",
    "Test ve devreye alma: Topraklama ölçümleri, izolasyon testleri, koruma ve fonksiyon testleri.",
    "Enerjilendirme ve kabul: EDAŞ ile kesinti ve manevra planı, enerjilendirme, geçici kabul ve as-built teslimi.",
  ].join("\n"),
  schedule: [
    "Sözleşme, sipariş ve mobilizasyon | 1-1",
    "Uygulama projesi kontrolü ve aplikasyon | 1-2",
    "Malzeme tedariki | 1-4 | malzeme",
    "Saha montaj işleri | 3-6",
    "Testler ve devreye alma | 7-7",
    "Geçici kabul ve as-built teslimi | 8-8",
  ].join("\n"),
  scheduleWeeks: 8,
};

export type ExchangeRates = { USD: number; EUR: number };

/** Teklif kime hazırlanıyor: kayıtlı müşteri veya henüz müşteri olmayan aday. */
export type OfferRecipient = {
  mode: "kayitli" | "aday";
  /** Aday modunda kişi/firma adı. */
  name: string;
  contactName: string;
  phone: string;
  email: string;
};

export type EnergyOfferConfig = {
  kind: "enerji_paketi";
  version: 1;
  ges: GesConfig;
  sarj: SarjConfig;
  recipient?: OfferRecipient;
  /** Teklif kapağında ve özetinde görünen proje yeri (ör. Akyaka / Muğla). */
  projectLocation?: string;
  /** Tüm kalemlere uygulanan genel kâr oranı (maliyet üzerine, 0,25 = %25). */
  markupRate?: number;
  /** Yıllık özgül üretim, kWh/kWp. */
  specificYield?: number;
  /** Müşteri dosyasında kalem bazında fiyat gösterilsin mi. */
  showLinePrices?: boolean;
  layout?: OfferLayout;
  technical?: TechnicalContent;
  /** Tüketim ve tarife: geri dönüş hesabı ve batarya önerisi için. */
  finance?: FinanceConfig;
  /** Müşteri dosyasında watt başı fiyat (USD/Wp) gösterilsin mi. */
  showPricePerWp?: boolean;
  /** Konum, çatı yüzeyleri ve PVGIS sonucu. */
  site?: SiteConfig;
};

/** Teklifte saklanan kurlar ve kaynağı. Kaydedilen teklifin kuru sabit kalır. */
export type StoredRates = ExchangeRates & {
  /** Kaydın yapıldığı gün. */
  date?: string;
  source?: "TCMB" | "manual";
  /** TCMB bülten tarihi (kaynak TCMB ise). */
  tcmbDate?: string;
};

export const defaultRecipient: OfferRecipient = {
  mode: "kayitli",
  name: "",
  contactName: "",
  phone: "",
  email: "",
};

/** Muğla için tipik yıllık özgül üretim (kWh/kWp). Saha, eğim ve yöne göre
 * ±%10 değişebilir; teklifte "tahmini" olarak gösterilir. */
export const DEFAULT_SPECIFIC_YIELD = 1500;

/** Muğla güney cephe çatı için aylık üretim dağılımı (yıllık toplamın payı). */
export const MONTHLY_PROFILE = [
  0.0402, 0.0516, 0.0818, 0.1031, 0.1195, 0.1308, 0.127, 0.1157, 0.0893, 0.0604,
  0.044, 0.0366,
];
export const MONTH_LABELS = [
  "OCA",
  "ŞUB",
  "MAR",
  "NİS",
  "MAY",
  "HAZ",
  "TEM",
  "AĞU",
  "EYL",
  "EKİ",
  "KAS",
  "ARA",
];
/** Türkiye şebekesi için yaklaşık emisyon faktörü, kg CO2 / kWh. */
export const GRID_CO2_KG_PER_KWH = 0.44;

export function productionEstimate(
  kwp: number,
  specificYield: number,
  /** 12 ayın kWh/kWp üretimi (PVGIS). Verilmezse Muğla profili kullanılır. */
  monthlyPerKwp?: number[] | null,
) {
  const monthly =
    monthlyPerKwp && monthlyPerKwp.length === 12
      ? monthlyPerKwp.map((value) => Math.round(kwp * value))
      : MONTHLY_PROFILE.map((share) => Math.round(kwp * specificYield * share));
  const annual =
    monthlyPerKwp && monthlyPerKwp.length === 12
      ? monthly.reduce((sum, value) => sum + value, 0)
      : Math.round(kwp * specificYield);
  return {
    annual,
    daily: Math.round(annual / 365),
    monthly,
    co2Tons: Math.round((annual * GRID_CO2_KG_PER_KWH) / 100) / 10,
  };
}

/** Tüm kalemlerin kâr oranını tek değere eşitler. */
export function applyMarkup(lines: DraftLine[], markupRate: number) {
  return lines.map((line) => ({ ...line, markupRate }));
}

/** İstenen KDV hariç satış toplamına ulaşmak için gereken tek kâr oranı.
 * Müşteriye gizli kalemlerin maliyeti satışa yansımadığı için hesaba
 * yalnız görünen kalemler girer. */
export function markupForTargetSale(
  lines: DraftLine[],
  offerCurrency: Currency,
  rates: ExchangeRates,
  targetSale: number,
) {
  const visibleCost = priceLines(lines, offerCurrency, rates)
    .filter((line) => line.visibleToCustomer)
    .reduce((sum, line) => sum + line.totalCost, 0);
  if (!(visibleCost > 0) || !(targetSale > 0)) return null;
  return targetSale / visibleCost - 1;
}

/** Hibrit inverter ve bataryanın voltaj sınıfı (LV ≈ 48 V, HV = yüksek voltaj).
 * Ayrı sınıflar birbiriyle çalışmaz. */
export function voltageClass(
  item: CatalogItem | undefined,
): "LV" | "HV" | null {
  if (!item) return null;
  if (item.template_role === "ges_battery_hv") return "HV";
  if (item.template_role === "ges_battery") return "LV";
  if (item.template_role === "ges_inverter") {
    if (/-HV\b|\bHV\b/.test(`${item.code} ${item.model ?? ""}`)) return "HV";
    if (/-LV\b|\bLV\b/.test(`${item.code} ${item.model ?? ""}`)) return "LV";
  }
  return null;
}

/** DC gücüne göre uygun AC inverter gücü aralığı (DC/AC 0,90–1,35). */
export function recommendedInverterRange(kwp: number) {
  return { min: kwp / 1.35, max: kwp / 0.9 };
}

/** Sistem tipine uygun, DC/AC oranını aralığa sokan inverterler (küçükten büyüğe). */
export function suggestInverters(ges: GesConfig, catalog: CatalogItem[]) {
  const kwp = gesCapacityKwp(ges, catalog);
  if (kwp <= 0) return [];
  const { min, max } = recommendedInverterRange(kwp);
  return catalog
    .filter(
      (item) =>
        item.is_active &&
        item.power_kw &&
        (ges.systemType === "hibrit"
          ? item.template_role === "ges_inverter"
          : item.template_role === "ges_inverter" ||
            item.template_role === "ges_inverter_ongrid"),
    )
    .filter((item) => {
      const kw = Number(item.power_kw);
      return kw >= min && kw <= max;
    })
    .filter((item) => {
      // Hibrit sistemde seçili bataryanın voltaj sınıfına uymayan inverteri önerme.
      if (ges.systemType !== "hibrit") return true;
      const batteryClass = voltageClass(
        catalog.find((b) => b.id === ges.batteryId),
      );
      const inverterClass = voltageClass(item);
      return !batteryClass || !inverterClass || batteryClass === inverterClass;
    })
    .sort((a, b) => Number(a.cost_amount) - Number(b.cost_amount));
}

export const defaultGes: GesConfig = {
  enabled: true,
  systemType: "ongrid",
  panelId: "",
  panelCount: 0,
  inverterId: "",
  inverterCount: 1,
  batteryId: "",
  batteryCount: 0,
  roofType: "kiremit",
  dcCableM: 0,
  acCableM: 12,
  contractPowerKw: 0,
};

export const defaultSarj: SarjConfig = {
  enabled: false,
  stationId: "",
  stationCount: 1,
  phase: "trifaze",
  cableMPerStation: 15,
  withStand: false,
  connectionPowerKw: 0,
};

export const defaultPaymentPlan: PaymentStep[] = [
  { label: "Sipariş onayında", percent: 50 },
  { label: "Malzeme sahaya teslim edildiğinde", percent: 40 },
  { label: "Devreye alma ve kabulde", percent: 10 },
];

/** NES GES maliyet tablolarındaki götürü bedeller (USD, KDV hariç):
 * DG Otomotiv R2 (9 / 15 / 22,5 kWp), B. Kolkesen (9,9 kWp), Cihan İnşaat
 * (12 kWp). Ara değerler doğrusal enterpolasyonla, en büyük noktanın
 * üstü son iki noktanın eğimiyle hesaplanır; en küçüğün altı taban kalır. */
export const GES_COST_CURVES: Record<string, [number, number][]> = {
  // Kurulum ve devreye alma (Pik Solar montaj işçiliği)
  ges_labor: [
    [9, 1000],
    [12, 1100],
    [15, 1350],
    [22.5, 2000],
  ],
  // Nakliye (ambar, kargo, forklift, vinç)
  ges_transport: [
    [9, 400],
    [15, 450],
    [22.5, 500],
  ],
  // Koruma ve toplama panosu (GES ACP)
  ges_acp: [
    [9, 400],
    [15, 450],
    [22.5, 500],
  ],
};

export function costFromCurve(points: [number, number][], kwp: number) {
  if (points.length === 0) return 0;
  if (kwp <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i += 1) {
    const [x1, y1] = points[i];
    const [x0, y0] = points[i - 1];
    if (kwp <= x1) return round2(y0 + ((y1 - y0) * (kwp - x0)) / (x1 - x0));
  }
  const [x0, y0] = points[points.length - 2] ?? points[0];
  const [x1, y1] = points[points.length - 1];
  const slope = x1 === x0 ? 0 : (y1 - y0) / (x1 - x0);
  return round2(y1 + slope * (kwp - x1));
}

export function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Kaynak para birimindeki tutarı teklif para birimine çevirir.
 * Kurlar 1 USD / 1 EUR'nun TL karşılığıdır. */
export function convert(
  amount: number,
  from: Currency,
  to: Currency,
  rates: ExchangeRates,
): number {
  if (from === to) return amount;
  const toTry = (value: number, cur: Currency) =>
    cur === "TRY" ? value : value * rates[cur];
  const tryAmount = toTry(amount, from);
  return to === "TRY" ? tryAmount : tryAmount / rates[to];
}

export function gesCapacityKwp(ges: GesConfig, catalog: CatalogItem[]) {
  const panel = catalog.find((item) => item.id === ges.panelId);
  return panel?.power_w ? (panel.power_w * ges.panelCount) / 1000 : 0;
}

export function gesInverterKw(ges: GesConfig, catalog: CatalogItem[]) {
  const inverter = catalog.find((item) => item.id === ges.inverterId);
  return (inverter?.power_kw ?? 0) * ges.inverterCount;
}

export function gesBatteryKwh(ges: GesConfig, catalog: CatalogItem[]) {
  if (ges.systemType !== "hibrit") return 0;
  const battery = catalog.find((item) => item.id === ges.batteryId);
  return (battery?.capacity_kwh ?? 0) * ges.batteryCount;
}

/** Hedef kWp için gereken panel adedi (yukarı yuvarlanır). */
export function panelsForTarget(targetKwp: number, panelW: number) {
  if (!(targetKwp > 0) || !(panelW > 0)) return 0;
  return Math.ceil((targetKwp * 1000) / panelW);
}

/** DC kablo için varsayılan metraj. NES tablolarında 9–22,5 kWp arası
 * sistemlerde 100–120 m kullanılmış; büyük sistemlerde kWp ile artar. */
export function defaultDcCable(kwp: number) {
  return Math.max(100, Math.round((kwp * 5.5) / 10) * 10);
}

let keySeed = 0;
export function newLineKey() {
  keySeed += 1;
  return `l${Date.now().toString(36)}${keySeed}`;
}

export function lineFromCatalog(
  item: CatalogItem,
  quantity: number,
  options: { auto?: boolean; costMultiplier?: number } = {},
): DraftLine {
  // Ölçek katsayısı yalnız maliyete yansır; açıklamaya yazılmaz çünkü
  // açıklama müşteri dosyasında görünür.
  const multiplier = options.costMultiplier ?? 1;
  const details = item.model ?? "";
  return {
    key: newLineKey(),
    catalogItemId: item.id,
    module: item.module,
    category: item.line_category,
    description: details ? `${item.name} (${details})` : item.name,
    brand: item.brand,
    unit: item.unit,
    quantity,
    sourceUnitCost: round2(Number(item.cost_amount) * multiplier),
    sourceCurrency: item.currency,
    markupRate: Number(item.markup_rate),
    auto: options.auto ?? true,
    visibleToCustomer: true,
  };
}

function byRole(catalog: CatalogItem[], role: string) {
  return catalog.find((item) => item.template_role === role && item.is_active);
}

export function buildGesLines(
  ges: GesConfig,
  catalog: CatalogItem[],
): DraftLine[] {
  if (!ges.enabled) return [];
  const lines: DraftLine[] = [];
  const panel = catalog.find((item) => item.id === ges.panelId);
  const inverter = catalog.find((item) => item.id === ges.inverterId);
  const kwp = gesCapacityKwp(ges, catalog);
  if (panel && ges.panelCount > 0) {
    lines.push(lineFromCatalog(panel, ges.panelCount));
  }
  if (inverter && ges.inverterCount > 0) {
    lines.push(lineFromCatalog(inverter, ges.inverterCount));
  }
  if (ges.systemType === "hibrit") {
    const battery = catalog.find((item) => item.id === ges.batteryId);
    if (battery && ges.batteryCount > 0) {
      lines.push(lineFromCatalog(battery, ges.batteryCount));
      // NES tablolarında batarya işçiliği sistem başına tek set.
      const batteryLabor = byRole(catalog, "ges_battery_labor");
      if (batteryLabor) lines.push(lineFromCatalog(batteryLabor, 1));
    }
  }
  if (kwp <= 0) return lines;

  // İşçilik, nakliye ve GES panosu kWp kademeli götürü bedel (1 set).
  const curved = (role: string) => {
    const item = byRole(catalog, role);
    const points = GES_COST_CURVES[role];
    if (!item || !points) return;
    const base = Number(item.cost_amount);
    const target = costFromCurve(points, kwp);
    lines.push(
      lineFromCatalog(item, 1, {
        costMultiplier: base > 0 ? target / base : 1,
      }),
    );
  };

  const mounting =
    ges.roofType === "kiremit"
      ? byRole(catalog, "ges_mounting")
      : catalog.find((item) => item.code === "GES-MNT-ALU" && item.is_active);
  if (mounting && ges.panelCount > 0) {
    lines.push(lineFromCatalog(mounting, ges.panelCount));
  }

  curved("ges_labor");
  curved("ges_acp");
  const meter = byRole(catalog, "ges_meter");
  if (meter) lines.push(lineFromCatalog(meter, 1));

  const dc = byRole(catalog, "ges_dc_cable");
  if (dc && ges.dcCableM > 0) lines.push(lineFromCatalog(dc, ges.dcCableM));
  const inverterKw = gesInverterKw(ges, catalog);
  const ac = byRole(
    catalog,
    inverterKw > 10 ? "ges_ac_cable_10" : "ges_ac_cable_6",
  );
  if (ac && ges.acCableM > 0) lines.push(lineFromCatalog(ac, ges.acCableM));
  const conduit = byRole(catalog, "ges_conduit");
  const conduitM = Math.max(50, Math.round(ges.dcCableM / 2));
  if (conduit && conduitM > 0) lines.push(lineFromCatalog(conduit, conduitM));
  const mc4 = byRole(catalog, "ges_mc4");
  if (mc4 && ges.panelCount > 0) {
    lines.push(lineFromCatalog(mc4, ges.panelCount > 20 ? 8 : 4));
  }

  curved("ges_transport");
  // Diğer yardımcı kalemler NES tablolarında sistem büyüklüğünden bağımsız.
  for (const role of [
    "ges_grounding",
    "ges_consumables",
    "ges_static",
    "ges_responsibility_static",
    "ges_acceptance",
    "ges_project",
    "ges_responsibility",
  ]) {
    const item = byRole(catalog, role);
    if (item) lines.push(lineFromCatalog(item, 1));
  }
  return lines;
}

export function buildSarjLines(
  sarj: SarjConfig,
  catalog: CatalogItem[],
): DraftLine[] {
  if (!sarj.enabled) return [];
  const station = catalog.find((item) => item.id === sarj.stationId);
  const n = Math.max(0, Math.floor(sarj.stationCount));
  if (!station || n === 0) return [];
  const lines: DraftLine[] = [lineFromCatalog(station, n)];
  if (sarj.withStand) {
    const stand = byRole(catalog, "sarj_stand");
    if (stand) lines.push(lineFromCatalog(stand, n));
  }
  const tri = sarj.phase === "trifaze";
  const cableM = Math.round(sarj.cableMPerStation * n);
  const cable = byRole(catalog, tri ? "sarj_cable_trifaze" : "sarj_cable_mono");
  if (cable && cableM > 0) lines.push(lineFromCatalog(cable, cableM));
  const conduit = byRole(catalog, "sarj_conduit");
  if (conduit && cableM > 0) lines.push(lineFromCatalog(conduit, cableM));
  for (const role of [
    "sarj_box",
    tri ? "sarj_rcd_trifaze" : "sarj_rcd_mono",
    tri ? "sarj_mcb_trifaze" : "sarj_mcb_mono",
  ]) {
    const item = byRole(catalog, role);
    if (item) lines.push(lineFromCatalog(item, n));
  }
  for (const role of ["sarj_panel", "sarj_panel_consumables"]) {
    const item = byRole(catalog, role);
    if (item) lines.push(lineFromCatalog(item, 1));
  }
  const labor = byRole(catalog, "sarj_labor");
  if (labor) lines.push(lineFromCatalog(labor, n));
  const transport = byRole(catalog, "sarj_transport");
  if (transport) lines.push(lineFromCatalog(transport, 1));
  return lines;
}

export type PricedLine = DraftLine & {
  unitCost: number;
  totalCost: number;
  saleAmount: number;
};

export function priceLines(
  lines: DraftLine[],
  offerCurrency: Currency,
  rates: ExchangeRates,
): PricedLine[] {
  return lines.map((line) => {
    const unitCost = round2(
      convert(line.sourceUnitCost, line.sourceCurrency, offerCurrency, rates),
    );
    const totalCost = round2(unitCost * line.quantity);
    const saleAmount = round2(totalCost * (1 + line.markupRate));
    return { ...line, unitCost, totalCost, saleAmount };
  });
}

export function summarize(priced: PricedLine[], vatRate: number) {
  const visible = priced.filter((line) => line.visibleToCustomer);
  const cost = round2(priced.reduce((sum, line) => sum + line.totalCost, 0));
  const sale = round2(visible.reduce((sum, line) => sum + line.saleAmount, 0));
  const vat = round2(sale * vatRate);
  const byModule = (["ges", "sarj", "taahhut", "genel"] as OfferModule[]).map(
    (module) => ({
      module,
      sale: round2(
        visible
          .filter((line) => line.module === module)
          .reduce((sum, line) => sum + line.saleAmount, 0),
      ),
    }),
  );
  return {
    cost,
    sale,
    vat,
    grandTotal: round2(sale + vat),
    profit: round2(sale - cost),
    margin: sale > 0 ? (sale - cost) / sale : 0,
    byModule,
  };
}

/** Kontrol sonucu. `fix` kullanıcıya uyarının nasıl düşeceğini söyler;
 * `field` ilgili bölümü işaret eder. */
export type Check = {
  level: "error" | "warning";
  message: string;
  fix: string;
  field?: "genel" | "ges" | "sarj" | "kalemler" | "odeme";
};

export function runChecks(input: {
  customerId: string;
  recipient?: OfferRecipient;
  ges: GesConfig;
  sarj: SarjConfig;
  catalog: CatalogItem[];
  lines: DraftLine[];
  paymentPlan: PaymentStep[];
  rates: ExchangeRates;
  offerCurrency: Currency;
}): Check[] {
  const { ges, sarj, catalog } = input;
  const checks: Check[] = [];
  const recipient = input.recipient ?? defaultRecipient;
  if (recipient.mode === "aday") {
    if (recipient.name.trim().length < 2) {
      checks.push({
        level: "error",
        field: "genel",
        message: "Teklif verilen kişi/firma adı yazılmalı.",
        fix: "Genel bilgiler > Teklif verilen > Ad / firma alanını doldurun.",
      });
    }
  } else if (!input.customerId) {
    checks.push({
      level: "error",
      field: "genel",
      message: "Müşteri seçilmeli.",
      fix: "Listeden kayıtlı müşteriyi seçin ya da 'Kayıtsız aday' seçip adını yazın.",
    });
  }
  if (input.lines.length === 0) {
    checks.push({
      level: "error",
      field: "kalemler",
      message: "Teklifte kalem yok.",
      fix: "GES/Şarj ayarlarını yapıp 'Kalemleri oluştur'a basın veya katalogdan kalem ekleyin.",
    });
  }
  const zeroCost = input.lines.filter(
    (line) => line.quantity > 0 && !(line.sourceUnitCost > 0),
  );
  if (zeroCost.length > 0) {
    checks.push({
      level: "warning",
      field: "kalemler",
      message: `${zeroCost.length} kalemin alış fiyatı 0: ${zeroCost
        .slice(0, 3)
        .map((line) => line.description)
        .join("; ")}${zeroCost.length > 3 ? "…" : ""}`,
      fix: 'Kırmızı satırlara gerçek maliyeti yazın. Bilerek 0 ise (NES kendi yapıyor, müşteri temin ediyor vb.) satış fiyatı da 0 çıkar ve müşteri dosyasında "Dahil" görünür; bu durumda emeğin bedelini başka kaleme yansıttığınızdan emin olun.',
    });
  }
  if (input.lines.some((line) => !(line.quantity > 0))) {
    checks.push({
      level: "error",
      field: "kalemler",
      message: "Miktarı 0 olan kalem var.",
      fix: "Kalemler tablosunda miktarı 0 olan satırı düzeltin veya çöp kutusuyla silin.",
    });
  }
  const usedCurrencies = new Set<Currency>([
    input.offerCurrency,
    ...input.lines.map((line) => line.sourceCurrency),
  ]);
  for (const cur of ["USD", "EUR"] as const) {
    if (usedCurrencies.has(cur) && !(input.rates[cur] > 0)) {
      checks.push({
        level: "error",
        field: "genel",
        message: `${cur}/TL kuru girilmemiş.`,
        fix: `Genel bilgiler > ${cur} kuru alanına güncel kuru yazın (ör. TCMB döviz satış).`,
      });
    }
  }
  const planTotal = round2(
    input.paymentPlan.reduce((sum, step) => sum + step.percent, 0),
  );
  if (input.paymentPlan.length > 0 && planTotal !== 100) {
    checks.push({
      level: "error",
      field: "odeme",
      message: `Ödeme planı toplamı %${planTotal}; %100 olmalı.`,
      fix: "Ödeme planı adımlarının yüzdelerini toplam 100 olacak şekilde düzeltin.",
    });
  }

  if (ges.enabled) {
    const kwp = gesCapacityKwp(ges, catalog);
    const acKw = gesInverterKw(ges, catalog);
    if (!ges.panelId || ges.panelCount <= 0) {
      checks.push({
        level: "error",
        field: "ges",
        message: "GES: panel veya panel adedi yok.",
        fix: "GES bölümünde panel seçin; adedi elle yazın ya da 'Hedef güç (kWp)' girin.",
      });
    }
    if (!ges.inverterId || ges.inverterCount <= 0) {
      checks.push({
        level: "error",
        field: "ges",
        message: "GES: inverter seçilmemiş.",
        fix: "GES bölümünde inverter seçin (öneri düğmesi DC güce uygun olanı seçer).",
      });
    }
    if (kwp > 0 && acKw > 0) {
      const ratio = kwp / acKw;
      if (ratio < 0.9 || ratio > 1.35) {
        const range = recommendedInverterRange(kwp);
        const suggestion = suggestInverters(ges, catalog)[0];
        checks.push({
          level: "warning",
          field: "ges",
          message: `GES: DC/AC oranı ${ratio.toFixed(2).replace(".", ",")} (DC ${formatKwp(kwp)} kWp / AC ${formatKwp(acKw)} kW). Önerilen 0,90–1,35.`,
          fix:
            (ratio > 1.35
              ? "Panel gücü inverter için fazla: inverteri büyütün, inverter adedini artırın veya panel adedini azaltın. "
              : "Inverter panel gücüne göre büyük: daha küçük inverter seçin veya panel ekleyin. ") +
            `Bu DC güç için toplam inverter gücü ${formatKwp(range.min)}–${formatKwp(range.max)} kW olmalı.` +
            (suggestion
              ? ` Katalogdaki en uygun seçenek: ${suggestion.brand ?? ""} ${suggestion.name}.`
              : ""),
        });
      }
    }
    if (ges.contractPowerKw > 0 && acKw > ges.contractPowerKw) {
      checks.push({
        level: "warning",
        field: "ges",
        message: `GES: inverter gücü ${formatKwp(acKw)} kW, sözleşme gücü ${formatKwp(ges.contractPowerKw)} kW.`,
        fix: "Mahsuplaşmalı sistemde AC güç sözleşme gücünü aşamaz: ya inverteri sözleşme gücüne indirin ya da teklife EDAŞ'tan güç artışı başvurusunu ekleyin.",
      });
    }
    const inverter = catalog.find((item) => item.id === ges.inverterId);
    if (inverter) {
      const isHybrid = inverter.template_role === "ges_inverter";
      if (ges.systemType === "ongrid" && isHybrid) {
        checks.push({
          level: "warning",
          field: "ges",
          message: "GES: on-grid sistemde hibrit inverter seçili.",
          fix: "İleride batarya eklenecekse doğru tercih; değilse on-grid inverter daha ucuzdur. Sistem tipini 'Hibrit' yapın veya on-grid inverter seçin.",
        });
      }
      if (ges.systemType === "hibrit" && !isHybrid) {
        checks.push({
          level: "error",
          field: "ges",
          message:
            "GES: hibrit sistemde on-grid inverter seçili; batarya bağlanamaz.",
          fix: "Hibrit inverter seçin ya da sistem tipini 'On-grid' yapın.",
        });
      }
    }
    const battery = catalog.find((item) => item.id === ges.batteryId);
    const invClass = voltageClass(inverter);
    const batClass = voltageClass(battery);
    if (
      ges.systemType === "hibrit" &&
      invClass &&
      batClass &&
      invClass !== batClass
    ) {
      checks.push({
        level: "error",
        field: "ges",
        message: `GES: ${invClass} inverter ile ${batClass} batarya birlikte çalışmaz.`,
        fix:
          batClass === "LV"
            ? "LV (düşük voltaj, 48 V) hibrit inverter seçin ya da HV batarya seçin."
            : "HV (yüksek voltaj) hibrit inverter seçin ya da LV batarya seçin.",
      });
    }
    if (
      ges.systemType === "hibrit" &&
      (!ges.batteryId || ges.batteryCount <= 0)
    ) {
      checks.push({
        level: "warning",
        field: "ges",
        message: "GES: hibrit sistemde batarya yok.",
        fix: "Batarya ve adedini seçin; batarya sonra eklenecekse bu uyarıyı bilerek geçebilirsiniz.",
      });
    }
    if (ges.acCableM > 30) {
      checks.push({
        level: "warning",
        field: "ges",
        message: `GES: AC kablo ${ges.acCableM} m (30 m üzeri).`,
        fix: "Gerilim düşümünü hesaplayın; gerekirse kesiti büyütün (kalemlerde kabloyu değiştirin) veya inverteri panoya yaklaştırın. Uygunsa uyarıyı bilerek geçin.",
      });
    }
  }

  if (sarj.enabled) {
    const station = catalog.find((item) => item.id === sarj.stationId);
    if (!station || sarj.stationCount <= 0) {
      checks.push({
        level: "error",
        field: "sarj",
        message: "Şarj: istasyon veya adet yok.",
        fix: "Şarj bölümünde istasyon ve adet seçin ya da şarj modülünü kapatın.",
      });
    }
    if (station?.phase === "trifaze" && sarj.phase === "mono") {
      checks.push({
        level: "error",
        field: "sarj",
        message: "Şarj: trifaze istasyon monofaze beslemeyle kurulamaz.",
        fix: "Beslemeyi 'Trifaze' yapın veya monofaze istasyon seçin.",
      });
    }
    const totalKw = (station?.power_kw ?? 0) * sarj.stationCount;
    if (sarj.connectionPowerKw > 0 && totalKw > sarj.connectionPowerKw) {
      checks.push({
        level: "warning",
        field: "sarj",
        message: `Şarj: istasyonların toplamı ${formatKwp(totalKw)} kW, bağlantı gücü ${formatKwp(sarj.connectionPowerKw)} kW.`,
        fix: "Yük yönetimi (dinamik güç paylaşımı) ekleyin, istasyon adedini azaltın veya güç artışı başvurusunu teklife ekleyin.",
      });
    }
    if (sarj.cableMPerStation > 30) {
      checks.push({
        level: "warning",
        field: "sarj",
        message: `Şarj: istasyon başına kablo ${sarj.cableMPerStation} m (30 m üzeri).`,
        fix: "32 A için gerilim düşümünü kontrol edin; gerekirse 5x10 mm²'ye çıkın. Uygunsa uyarıyı bilerek geçin.",
      });
    }
  }
  return checks;
}

export function formatKwp(value: number) {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(
    value,
  );
}

export function formatMoney(value: number, currency: Currency) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

/** "49,4" / "1.250,5" / "49.4" / "1.500" girişlerini sayıya çevirir.
 * Virgül varsa Türkçe biçim kabul edilir; yoksa noktadan sonra tam 3 hane
 * binlik ayırıcı, diğer durumlar ondalık sayılır. */
export function parseDecimal(value: string): number {
  const trimmed = value.trim().replace(/\s/g, "");
  let normalized: string;
  if (trimmed.includes(",")) {
    normalized = trimmed.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(trimmed)) {
    normalized = trimmed.replace(/\./g, "");
  } else {
    normalized = trimmed;
  }
  if (normalized === "") return 0;
  const result = Number(normalized);
  return Number.isFinite(result) ? result : 0;
}

export function isEnergyOfferConfig(
  value: unknown,
): value is EnergyOfferConfig {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "enerji_paketi"
  );
}

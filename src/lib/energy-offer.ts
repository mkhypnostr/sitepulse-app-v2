// GES / EV Şarj / Taahhüt teklif hazırlayıcısının hesap mantığı.
// Arayüzden bağımsızdır: katalog + kullanıcı girdisi -> teklif kalemleri,
// kur çevrimi, toplamlar ve kontrol uyarıları.

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

export type PaymentStep = { label: string; percent: number };

export type ExchangeRates = { USD: number; EUR: number };

export type EnergyOfferConfig = {
  kind: "enerji_paketi";
  version: 1;
  ges: GesConfig;
  sarj: SarjConfig;
};

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
  acCableM: 15,
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

/** Yardımcı kalemlerin (topraklama, nakliye, sarf, kabul, statik) maliyet
 * tablolarındaki referans sistem büyüklüğü. Daha büyük sistemlerde bu
 * kalemler kWp ile orantılı büyür, küçüklerde taban fiyat korunur. */
export const GES_REFERENCE_KWP = 20;

const SCALED_GES_ROLES = new Set([
  "ges_grounding",
  "ges_consumables",
  "ges_transport",
  "ges_static",
  "ges_acceptance",
]);

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

/** DC kablo için varsayılan metraj: her kWp için 20 m (artı/eksi hat). */
export function defaultDcCable(kwp: number) {
  return Math.max(50, Math.round(kwp * 20));
}

let keySeed = 0;
export function newLineKey() {
  keySeed += 1;
  return `l${Date.now().toString(36)}${keySeed}`;
}

export function lineFromCatalog(
  item: CatalogItem,
  quantity: number,
  options: { auto?: boolean; costMultiplier?: number; note?: string } = {},
): DraftLine {
  const multiplier = options.costMultiplier ?? 1;
  const details = [item.model, options.note].filter(Boolean).join(" · ");
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
      const batteryLabor = byRole(catalog, "ges_battery_labor");
      if (batteryLabor) {
        lines.push(lineFromCatalog(batteryLabor, ges.batteryCount));
      }
    }
  }
  if (kwp <= 0) return lines;

  const scale = Math.max(1, kwp / GES_REFERENCE_KWP);
  const scaleNote =
    scale > 1 ? `${formatKwp(kwp)} kWp için ölçeklendi` : undefined;

  const mounting =
    ges.roofType === "kiremit"
      ? byRole(catalog, "ges_mounting")
      : catalog.find((item) => item.code === "GES-MNT-ALU" && item.is_active);
  if (mounting && ges.panelCount > 0) {
    lines.push(lineFromCatalog(mounting, ges.panelCount));
  }

  const labor = byRole(catalog, "ges_labor");
  if (labor) lines.push(lineFromCatalog(labor, round2(kwp)));

  const acp = byRole(catalog, "ges_acp");
  if (acp) lines.push(lineFromCatalog(acp, Math.max(1, ges.inverterCount)));
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
  const conduitM = Math.round(ges.dcCableM / 2 + ges.acCableM);
  if (conduit && conduitM > 0) lines.push(lineFromCatalog(conduit, conduitM));
  const mc4 = byRole(catalog, "ges_mc4");
  if (mc4 && ges.panelCount > 0) {
    lines.push(
      lineFromCatalog(mc4, Math.max(4, Math.ceil(ges.panelCount / 4))),
    );
  }

  for (const role of [
    "ges_grounding",
    "ges_consumables",
    "ges_transport",
    "ges_static",
    "ges_acceptance",
    "ges_project",
    "ges_responsibility",
  ]) {
    const item = byRole(catalog, role);
    if (!item) continue;
    const scaled = SCALED_GES_ROLES.has(role);
    lines.push(
      lineFromCatalog(item, 1, {
        costMultiplier: scaled ? scale : 1,
        note: scaled ? scaleNote : undefined,
      }),
    );
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

export type Check = { level: "error" | "warning"; message: string };

export function runChecks(input: {
  customerId: string;
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
  if (!input.customerId) {
    checks.push({ level: "error", message: "Müşteri seçilmeli." });
  }
  if (input.lines.length === 0) {
    checks.push({
      level: "error",
      message: "Teklifte en az bir kalem olmalı.",
    });
  }
  if (input.lines.some((line) => !(line.quantity > 0))) {
    checks.push({
      level: "error",
      message: "Tüm kalemlerin miktarı 0'dan büyük olmalı.",
    });
  }
  const usedCurrencies = new Set<Currency>([
    input.offerCurrency,
    ...input.lines.map((line) => line.sourceCurrency),
  ]);
  for (const cur of ["USD", "EUR"] as const) {
    if (usedCurrencies.has(cur) && !(input.rates[cur] > 0)) {
      checks.push({ level: "error", message: `${cur}/TL kuru girilmeli.` });
    }
  }
  const planTotal = round2(
    input.paymentPlan.reduce((sum, step) => sum + step.percent, 0),
  );
  if (input.paymentPlan.length > 0 && planTotal !== 100) {
    checks.push({
      level: "error",
      message: `Ödeme planı toplamı %100 olmalı (şu an %${planTotal}).`,
    });
  }

  if (ges.enabled) {
    const kwp = gesCapacityKwp(ges, catalog);
    const acKw = gesInverterKw(ges, catalog);
    if (!ges.panelId || ges.panelCount <= 0) {
      checks.push({ level: "error", message: "GES: panel ve adet seçilmeli." });
    }
    if (!ges.inverterId || ges.inverterCount <= 0) {
      checks.push({ level: "error", message: "GES: inverter seçilmeli." });
    }
    if (kwp > 0 && acKw > 0) {
      const ratio = kwp / acKw;
      if (ratio < 0.9 || ratio > 1.35) {
        checks.push({
          level: "warning",
          message: `GES: DC/AC oranı ${ratio.toFixed(2).replace(".", ",")} — önerilen aralık 0,90–1,35.`,
        });
      }
    }
    if (ges.contractPowerKw > 0 && acKw > ges.contractPowerKw) {
      checks.push({
        level: "warning",
        message: `GES: inverter gücü (${acKw} kW) sözleşme gücünü (${ges.contractPowerKw} kW) aşıyor; EDAŞ başvurusunda güç artışı gerekir.`,
      });
    }
    const inverter = catalog.find((item) => item.id === ges.inverterId);
    if (inverter) {
      const isHybrid = inverter.template_role === "ges_inverter";
      if (ges.systemType === "ongrid" && isHybrid) {
        checks.push({
          level: "warning",
          message:
            "GES: on-grid sistem için hibrit inverter seçildi (daha pahalı). Bilerek mi?",
        });
      }
      if (ges.systemType === "hibrit" && !isHybrid) {
        checks.push({
          level: "error",
          message:
            "GES: hibrit sistem için on-grid inverter seçildi; batarya bağlanamaz.",
        });
      }
    }
    if (
      ges.systemType === "hibrit" &&
      (!ges.batteryId || ges.batteryCount <= 0)
    ) {
      checks.push({
        level: "warning",
        message: "GES: hibrit sistemde batarya seçilmedi.",
      });
    }
    if (ges.acCableM > 30) {
      checks.push({
        level: "warning",
        message: `GES: AC kablo ${ges.acCableM} m — 30 m üzeri; gerilim düşümünü kontrol edin, kesit büyütmek gerekebilir.`,
      });
    }
  }

  if (sarj.enabled) {
    const station = catalog.find((item) => item.id === sarj.stationId);
    if (!station || sarj.stationCount <= 0) {
      checks.push({
        level: "error",
        message: "Şarj: istasyon ve adet seçilmeli.",
      });
    }
    if (station?.phase === "trifaze" && sarj.phase === "mono") {
      checks.push({
        level: "error",
        message: "Şarj: trifaze istasyon monofaze besleme ile kurulamaz.",
      });
    }
    const totalKw = (station?.power_kw ?? 0) * sarj.stationCount;
    if (sarj.connectionPowerKw > 0 && totalKw > sarj.connectionPowerKw) {
      checks.push({
        level: "warning",
        message: `Şarj: toplam istasyon gücü (${totalKw} kW) bağlantı gücünü (${sarj.connectionPowerKw} kW) aşıyor; yük yönetimi veya güç artışı gerekir.`,
      });
    }
    if (sarj.cableMPerStation > 30) {
      checks.push({
        level: "warning",
        message: `Şarj: istasyon başına kablo ${sarj.cableMPerStation} m — 30 m üzeri; kesit hesabını kontrol edin.`,
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

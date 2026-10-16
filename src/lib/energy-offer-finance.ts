// GES geri dönüş, batarya önerisi, hazır paketler ve watt başı fiyat.
// Arayüzden bağımsız saf hesaplar.

import {
  convert,
  defaultDcCable,
  gesCapacityKwp,
  MONTHLY_PROFILE,
  panelsForTarget,
  round2,
  suggestInverters,
  voltageClass,
  type CatalogItem,
  type Currency,
  type ExchangeRates,
  type GesConfig,
} from "@/lib/energy-offer";

// ---------------------------------------------------------------- geri dönüş

export type FinanceConfig = {
  /** Aylık ortalama tüketim, kWh. 0 = hesap yapılmaz. */
  monthlyConsumptionKwh: number;
  /** Vergiler dahil birim elektrik fiyatı, TL/kWh. */
  tariffTlPerKwh: number;
  /** Ay sonunda tüketimi aşan üretimin satış fiyatı, TL/kWh (bilinmiyorsa 0). */
  exportTlPerKwh: number;
  /** Elektrik fiyatının yıllık artışı, % (0 = bugünkü fiyatlarla). */
  tariffEscalationPct: number;
  /** Panel yıllık verim kaybı, %. */
  degradationPct: number;
  /** Yatırım tutarına KDV dahil edilsin mi (KDV'yi indiremeyen konut). */
  includeVat: boolean;
  /** Tüketimin güneşsiz saatlere düşen payı, % (batarya önerisi için). */
  nightSharePct: number;
};

export const defaultFinance: FinanceConfig = {
  monthlyConsumptionKwh: 0,
  tariffTlPerKwh: 0,
  exportTlPerKwh: 0,
  tariffEscalationPct: 0,
  degradationPct: 0.5,
  includeVat: true,
  nightSharePct: 40,
};

export const FINANCE_YEARS = 25;

export type FinanceResult = {
  annualProductionKwh: number;
  annualConsumptionKwh: number;
  /** Üretimin tesiste mahsuplaşan (tüketimi karşılayan) payı, 0–1. */
  selfShare: number;
  /** Tüketimin GES ile karşılanan payı, 0–1. */
  coverage: number;
  investmentTl: number;
  firstYearSavingTl: number;
  /** Basit geri dönüş süresi (yıl). Süre içinde dönmüyorsa null. */
  paybackYears: number | null;
  totalSavingTl: number;
  /** Yıl sonu kümülatif nakit (yatırım düşülmüş), TL. */
  cumulative: number[];
};

/** Aylık mahsuplaşma varsayımıyla geri dönüş hesabı. Her ay üretimin
 * tüketimi karşılayan kısmı birim fiyattan, fazlası satış fiyatından
 * değerlenir. Tüketim aylara eşit dağıtılır. */
export function financeAnalysis(input: {
  kwp: number;
  /** 12 ayın kWh/kWp üretimi. */
  monthlyPerKwp: number[];
  finance: FinanceConfig;
  investmentTl: number;
  years?: number;
}): FinanceResult | null {
  const { kwp, finance } = input;
  const years = input.years ?? FINANCE_YEARS;
  if (
    !(kwp > 0) ||
    !(finance.monthlyConsumptionKwh > 0) ||
    !(finance.tariffTlPerKwh > 0) ||
    !(input.investmentTl > 0)
  ) {
    return null;
  }
  const cons = finance.monthlyConsumptionKwh;
  const deg = finance.degradationPct / 100;
  const esc = finance.tariffEscalationPct / 100;
  let cumulative = -input.investmentTl;
  const series: number[] = [];
  let payback: number | null = null;
  let firstYearSaving = 0;
  let totalSaving = 0;
  let firstProd = 0;
  let firstSelf = 0;
  for (let year = 1; year <= years; year += 1) {
    const factor = (1 - deg) ** (year - 1);
    const tariff = finance.tariffTlPerKwh * (1 + esc) ** (year - 1);
    const exportPrice = finance.exportTlPerKwh * (1 + esc) ** (year - 1);
    let saving = 0;
    let prodYear = 0;
    let selfYear = 0;
    for (const perKwp of input.monthlyPerKwp) {
      const prod = kwp * perKwp * factor;
      const self = Math.min(prod, cons);
      saving += self * tariff + (prod - self) * exportPrice;
      prodYear += prod;
      selfYear += self;
    }
    if (year === 1) {
      firstYearSaving = saving;
      firstProd = prodYear;
      firstSelf = selfYear;
    }
    const before = cumulative;
    cumulative += saving;
    totalSaving += saving;
    if (payback === null && cumulative >= 0 && saving > 0) {
      payback = year - 1 + -before / saving;
    }
    series.push(Math.round(cumulative));
  }
  return {
    annualProductionKwh: Math.round(firstProd),
    annualConsumptionKwh: Math.round(cons * 12),
    selfShare: firstProd > 0 ? firstSelf / firstProd : 0,
    coverage: cons > 0 ? firstSelf / (cons * 12) : 0,
    investmentTl: round2(input.investmentTl),
    firstYearSavingTl: Math.round(firstYearSaving),
    paybackYears: payback === null ? null : Math.round(payback * 10) / 10,
    totalSavingTl: Math.round(totalSaving),
    cumulative: series,
  };
}

/** Yıllık tüketimi karşılayacak DC güç (kWp). */
export function recommendedKwpForConsumption(
  monthlyConsumptionKwh: number,
  specificYield: number,
) {
  if (!(monthlyConsumptionKwh > 0) || !(specificYield > 0)) return 0;
  return round2((monthlyConsumptionKwh * 12) / specificYield);
}

/** 12 aylık kWh/kWp dizisi. PVGIS sonucu varsa onun aylık dağılımı
 * kullanılır ve yıllık toplam girilen özgül üretime ölçeklenir (özgül üretim
 * elle değiştirilirse dağılım korunur); yoksa Muğla profili. */
export function monthlyPerKwpFor(
  specificYield: number,
  pvgis?: { kwhPerKwp: number; monthlyPerKwp: number[] } | null,
) {
  if (pvgis && pvgis.monthlyPerKwp.length === 12) {
    const sum = pvgis.monthlyPerKwp.reduce((s, v) => s + v, 0);
    if (sum > 0) {
      return pvgis.monthlyPerKwp.map((v) => (v * specificYield) / sum);
    }
  }
  return MONTHLY_PROFILE.map((share) => specificYield * share);
}

// ---------------------------------------------------------------- batarya

/** Lityum bataryalarda kullanılabilir kapasite oranı (DoD). */
export const BATTERY_DOD = 0.9;

export type BatterySuggestion = {
  targetKwh: number;
  battery: CatalogItem;
  count: number;
  totalKwh: number;
  reason: string;
};

/** Gece tüketimini karşılayacak batarya. Gündüz fazlası gece ihtiyacından
 * azsa hedef gündüz fazlasıyla sınırlanır (doldurulamayacak batarya
 * önerilmez). Seçili hibrit inverterin voltaj sınıfına uyanlar arasından
 * hedefi karşılayan en ucuz seçenek seçilir. */
export function suggestBattery(input: {
  monthlyConsumptionKwh: number;
  nightSharePct: number;
  dailyProductionKwh: number;
  catalog: CatalogItem[];
  inverterId: string;
  maxCount?: number;
}): BatterySuggestion | null {
  const daily = input.monthlyConsumptionKwh / 30;
  if (!(daily > 0)) return null;
  const night = daily * (input.nightSharePct / 100);
  const daySurplus = Math.max(0, input.dailyProductionKwh - (daily - night));
  const usable = daySurplus > 0 ? Math.min(night, daySurplus) : night;
  const targetKwh = round2(usable / BATTERY_DOD);
  if (!(targetKwh > 0)) return null;
  const inverter = input.catalog.find((item) => item.id === input.inverterId);
  const invClass = voltageClass(inverter);
  const maxCount = input.maxCount ?? 8;
  let best: BatterySuggestion | null = null;
  let bestCost = Infinity;
  for (const battery of input.catalog) {
    if (
      !battery.is_active ||
      (battery.template_role !== "ges_battery" &&
        battery.template_role !== "ges_battery_hv") ||
      !(Number(battery.capacity_kwh) > 0)
    ) {
      continue;
    }
    const cls = voltageClass(battery);
    if (invClass && cls && invClass !== cls) continue;
    const capacity = Number(battery.capacity_kwh);
    const count = Math.max(1, Math.ceil(targetKwh / capacity));
    if (count > maxCount) continue;
    const cost = Number(battery.cost_amount) * count;
    if (cost < bestCost) {
      bestCost = cost;
      best = {
        targetKwh,
        battery,
        count,
        totalKwh: round2(capacity * count),
        reason:
          daySurplus > 0 && daySurplus < night
            ? `Gece ihtiyacı ~${round2(night)} kWh, gündüz fazlası ~${round2(daySurplus)} kWh; batarya gündüz fazlasıyla dolabildiği kadar seçildi.`
            : `Gece ihtiyacı ~${round2(night)} kWh (tüketimin %${input.nightSharePct}'i); %${BATTERY_DOD * 100} kullanılabilir kapasiteyle hedef ${targetKwh} kWh.`,
      };
    }
  }
  return best;
}

// ---------------------------------------------------------------- hazır paketler

export type GesPackage = {
  id: string;
  name: string;
  description: string;
  systemType: GesConfig["systemType"];
  targetKwp: number;
  /** Hibrit pakette hedef batarya kapasitesi, kWh. */
  batteryKwh: number;
};

export const GES_PACKAGES: GesPackage[] = [
  {
    id: "ev-5",
    name: "Konut 5 kWp",
    description: "Aylık ~250 kWh tüketen konut, on-grid",
    systemType: "ongrid",
    targetKwp: 5,
    batteryKwh: 0,
  },
  {
    id: "ev-10",
    name: "Konut / villa 10 kWp",
    description: "Aylık ~500 kWh, on-grid",
    systemType: "ongrid",
    targetKwp: 10,
    batteryKwh: 0,
  },
  {
    id: "hibrit-10",
    name: "Hibrit 10 kWp + 10 kWh",
    description: "Kesintide yedekleme isteyen villa",
    systemType: "hibrit",
    targetKwp: 10,
    batteryKwh: 10,
  },
  {
    id: "hibrit-15",
    name: "Hibrit 15 kWp + 15 kWh",
    description: "Büyük villa / küçük işletme, bataryalı",
    systemType: "hibrit",
    targetKwp: 15,
    batteryKwh: 15,
  },
  {
    id: "ticari-22",
    name: "İşletme 22,5 kWp",
    description: "NES maliyet tablolarındaki referans büyüklük, on-grid",
    systemType: "ongrid",
    targetKwp: 22.5,
    batteryKwh: 0,
  },
  {
    id: "ticari-50",
    name: "İşletme 50 kWp",
    description: "Atölye / otel çatısı, on-grid",
    systemType: "ongrid",
    targetKwp: 50,
    batteryKwh: 0,
  },
];

/** Panel başına watt maliyeti (kendi para biriminde). */
export function panelCostPerW(item: CatalogItem) {
  const w = Number(item.power_w);
  return w > 0 ? Number(item.cost_amount) / w : Infinity;
}

/** Paketi GES ayarlarına uygular. Seçili panel korunur; yoksa watt başı en
 * ucuz panel seçilir. İnverter ve batarya katalogdan önerilir. */
export function applyPackage(
  pkg: GesPackage,
  current: GesConfig,
  catalog: CatalogItem[],
  rates: ExchangeRates,
): { ges: GesConfig; notes: string[] } {
  const notes: string[] = [];
  const panels = catalog.filter(
    (item) =>
      item.is_active &&
      item.template_role === "ges_panel" &&
      Number(item.power_w) > 0,
  );
  const usdPerW = (item: CatalogItem) =>
    convert(panelCostPerW(item), item.currency, "USD", rates) ||
    panelCostPerW(item);
  const panel =
    panels.find((item) => item.id === current.panelId) ??
    [...panels].sort((a, b) => usdPerW(a) - usdPerW(b))[0];
  let ges: GesConfig = {
    ...current,
    enabled: true,
    systemType: pkg.systemType,
    inverterId: "",
    inverterCount: 1,
    batteryId: pkg.systemType === "hibrit" ? current.batteryId : "",
    batteryCount: pkg.systemType === "hibrit" ? current.batteryCount : 0,
  };
  if (!panel) {
    notes.push("Katalogda aktif panel yok.");
    return { ges, notes };
  }
  const panelCount = panelsForTarget(pkg.targetKwp, Number(panel.power_w));
  ges = {
    ...ges,
    panelId: panel.id,
    panelCount,
    dcCableM: defaultDcCable((panelCount * Number(panel.power_w)) / 1000),
  };

  if (pkg.systemType === "hibrit" && pkg.batteryKwh > 0) {
    // Önce bataryayı seç ki inverter voltaj sınıfına göre süzülsün.
    const batteries = catalog.filter(
      (item) =>
        item.is_active &&
        (item.template_role === "ges_battery" ||
          item.template_role === "ges_battery_hv") &&
        Number(item.capacity_kwh) > 0,
    );
    let bestBattery: { item: CatalogItem; count: number } | null = null;
    for (const item of batteries) {
      const count = Math.max(
        1,
        Math.ceil(pkg.batteryKwh / Number(item.capacity_kwh)),
      );
      const cost = Number(item.cost_amount) * count;
      if (
        !bestBattery ||
        cost < Number(bestBattery.item.cost_amount) * bestBattery.count
      ) {
        bestBattery = { item, count };
      }
    }
    if (bestBattery) {
      ges = {
        ...ges,
        batteryId: bestBattery.item.id,
        batteryCount: bestBattery.count,
      };
    } else {
      notes.push("Katalogda aktif batarya yok; bataryayı elle seçin.");
    }
  }

  const inverter = suggestInverters(ges, catalog)[0];
  if (inverter) {
    ges = { ...ges, inverterId: inverter.id, inverterCount: 1 };
  } else {
    notes.push(
      "Bu güce tek inverterle uyan katalog kaydı yok; inverteri ve adedini elle seçin.",
    );
  }
  const kwp = gesCapacityKwp(ges, catalog);
  notes.unshift(
    `${panelCount} × ${panel.brand ?? ""} ${Number(panel.power_w)} Wp = ${round2(kwp)} kWp`.replace(
      /\s+/g,
      " ",
    ),
  );
  return { ges, notes };
}

// ---------------------------------------------------------------- watt başı fiyat

/** Tutarı USD'ye çevirip kurulu güce böler (USD/Wp). Kur yoksa null. */
export function usdPerWp(
  amount: number,
  currency: Currency,
  rates: ExchangeRates,
  kwp: number,
) {
  if (!(kwp > 0) || !(amount > 0)) return null;
  if (currency !== "USD") {
    if (!(rates.USD > 0)) return null;
    if (currency === "EUR" && !(rates.EUR > 0)) return null;
  }
  const usd = convert(amount, currency, "USD", rates);
  return usd / (kwp * 1000);
}

export function formatUsdPerWp(value: number | null) {
  if (value === null) return "-";
  return `${new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(value)} $/Wp`;
}

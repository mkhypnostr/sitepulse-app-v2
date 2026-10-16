// NES teklif kuralları (NES Operasyon çalışma talimatı, bölüm 5).
//
// - Kâr: şablon varsayılanı maliyet üzerine %25 (brüt marj %20). Alt sınır
//   brüt marj %10; altına inmek bilinçli karar ister.
// - KDV: genel oran %20.
// - Geçerlilik: bakır kablo, panel, inverter, döviz bağlı malzeme ağırlıklı
//   7 gün; normal taahhüt / montaj 15 gün; sadece hizmet 30 gün.
// - Revizyon numarası: NES-TKF-YYAA-NNNN-R1, -R2 …

export const DEFAULT_MARKUP_RATE = 0.25;
export const DEFAULT_VAT_RATE = 0.2;
/** Satış üzerinden brüt marj alt sınırı. */
export const MIN_GROSS_MARGIN = 0.1;

type RuleLine = {
  module: string;
  category: string;
  description: string;
  sourceCurrency: string;
  totalCost: number;
};

export type ValidityRule = { days: 7 | 15 | 30; reason: string };

const COPPER_OR_VOLATILE =
  /kablo|nyy|nym|nyaf|h07|bak[ıi]r|panel|inverter|evirici|batarya/i;

/** Kalemlere göre önerilen geçerlilik süresi. */
export function validityRule(lines: RuleLine[]): ValidityRule {
  const materials = lines.filter((line) => line.category === "malzeme");
  if (materials.length === 0) {
    return { days: 30, reason: "sadece hizmet" };
  }
  const totalCost = lines.reduce((sum, line) => sum + line.totalCost, 0);
  const volatileCost = materials
    .filter(
      (line) =>
        line.sourceCurrency !== "TRY" ||
        line.module === "ges" ||
        line.module === "sarj" ||
        COPPER_OR_VOLATILE.test(line.description),
    )
    .reduce((sum, line) => sum + line.totalCost, 0);
  if (totalCost > 0 && volatileCost / totalCost >= 0.5) {
    return {
      days: 7,
      reason: "kablo, panel, inverter veya döviz bağlı malzeme ağırlıklı",
    };
  }
  return { days: 15, reason: "normal taahhüt / montaj" };
}

/** Satış üzerinden brüt marj alt sınırın altında mı. */
export function belowMarginFloor(sale: number, margin: number) {
  return sale > 0 && margin < MIN_GROSS_MARGIN;
}

/** Revizyonsuz teklif numarası: "NES-TKF-2610-0003-R2" → "NES-TKF-2610-0003". */
export function baseOfferNo(offerNo: string) {
  return offerNo.trim().replace(/-R\d+$/i, "");
}

/** Mevcut numaralara bakarak sıradaki revizyon numarası. */
export function nextRevisionNo(offerNo: string, existing: string[]) {
  const base = baseOfferNo(offerNo);
  const pattern = new RegExp(
    `^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-R(\\d+)$`,
    "i",
  );
  const max = existing.reduce((highest, no) => {
    const match = no.trim().match(pattern);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  return `${base}-R${max + 1}`;
}

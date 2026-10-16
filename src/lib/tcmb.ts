// TCMB "today.xml" gösterge niteliğindeki kurlar bülteninin ayrıştırıcısı.
// Hem sunucu tarafındaki /api/tcmb-rates rotası hem testler kullanır.

export const TCMB_TODAY_URL = "https://www.tcmb.gov.tr/kurlar/today.xml";

export type TcmbRate = { buying: number; selling: number };

export type TcmbRates = {
  /** Bülten tarihi, YYYY-AA-GG. */
  date: string;
  bulletin: string;
  USD: TcmbRate;
  EUR: TcmbRate;
};

function tagValue(block: string, tag: string) {
  const match = block.match(new RegExp(`<${tag}>\\s*([0-9.]+)\\s*</${tag}>`));
  return match ? Number(match[1]) : NaN;
}

function currencyBlock(xml: string, code: string) {
  const match = xml.match(
    new RegExp(
      `<Currency[^>]*CurrencyCode="${code}"[^>]*>([\\s\\S]*?)</Currency>`,
    ),
  );
  if (!match) return null;
  const unit = tagValue(match[1], "Unit") || 1;
  const buying = tagValue(match[1], "ForexBuying") / unit;
  const selling = tagValue(match[1], "ForexSelling") / unit;
  if (!(buying > 0) || !(selling > 0)) return null;
  return { buying, selling };
}

/** XML'i ayrıştırır; beklenen alanlar yoksa null döner. */
export function parseTcmbXml(xml: string): TcmbRates | null {
  const header = xml.match(/<Tarih_Date[^>]*Tarih="(\d{2})\.(\d{2})\.(\d{4})"/);
  if (!header) return null;
  const bulletin = xml.match(/Bulten_No="([^"]*)"/)?.[1] ?? "";
  const USD = currencyBlock(xml, "USD");
  const EUR = currencyBlock(xml, "EUR");
  if (!USD || !EUR) return null;
  return {
    date: `${header[3]}-${header[2]}-${header[1]}`,
    bulletin,
    USD,
    EUR,
  };
}

// Cari hesap hesapları: bakiye, vadesi geçmiş tutar (FIFO kapama) ve
// hareket listesi için yürüyen bakiye.

export type LedgerType = "fatura" | "tahsilat" | "iade" | "acilis";
export type LedgerCurrency = "TRY" | "USD" | "EUR";

export const ledgerTypeLabels: Record<LedgerType, string> = {
  fatura: "Fatura",
  tahsilat: "Tahsilat",
  iade: "İade / indirim",
  acilis: "Açılış bakiyesi",
};

export const paymentMethodLabels = {
  havale: "Havale / EFT",
  nakit: "Nakit",
  kredi_karti: "Kredi kartı",
  cek: "Çek",
  senet: "Senet",
  diger: "Diğer",
} as const;
export type PaymentMethod = keyof typeof paymentMethodLabels;

export type LedgerEntry = {
  id: string;
  customer_id: string;
  project_id: string | null;
  entry_type: LedgerType;
  entry_date: string;
  due_date: string | null;
  amount: number;
  currency: LedgerCurrency;
  payment_method: string | null;
  document_no: string | null;
  description: string | null;
};

/** Borç artıran hareket mi (fatura, açılış). */
export function isDebit(type: LedgerType) {
  return type === "fatura" || type === "acilis";
}

export function signedAmount(
  entry: Pick<LedgerEntry, "entry_type" | "amount">,
) {
  return isDebit(entry.entry_type)
    ? Number(entry.amount)
    : -Number(entry.amount);
}

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

export type CurrencySummary = {
  currency: LedgerCurrency;
  invoiced: number;
  collected: number;
  balance: number;
  /** Vadesi geçmiş ve henüz kapanmamış fatura tutarı. */
  overdue: number;
  /** En eski vadesi geçmiş açık faturanın vadesi. */
  oldestOverdue: string | null;
  lastCollection: string | null;
};

/** Bir müşterinin hareketlerinden para birimi bazında özet. Tahsilat ve
 * iadeler en eski faturadan başlayarak kapatılır (FIFO); kapanmayan
 * faturaların vadesi bugünden önceyse "vadesi geçmiş" sayılır. Vadesi
 * olmayan fatura, kesildiği gün vadeli kabul edilir. */
export function summarize(
  entries: LedgerEntry[],
  today: string,
): CurrencySummary[] {
  const byCurrency = new Map<LedgerCurrency, LedgerEntry[]>();
  for (const entry of entries) {
    const list = byCurrency.get(entry.currency) ?? [];
    list.push(entry);
    byCurrency.set(entry.currency, list);
  }
  const result: CurrencySummary[] = [];
  for (const [currency, list] of byCurrency) {
    const debits = list
      .filter((e) => isDebit(e.entry_type))
      .map((e) => ({
        due: e.due_date ?? e.entry_date,
        open: Number(e.amount),
      }))
      .sort((a, b) => a.due.localeCompare(b.due));
    let credit = list
      .filter((e) => !isDebit(e.entry_type))
      .reduce((sum, e) => sum + Number(e.amount), 0);
    for (const d of debits) {
      const used = Math.min(d.open, credit);
      d.open -= used;
      credit -= used;
    }
    const overdueItems = debits.filter((d) => d.open > 0.005 && d.due < today);
    const collections = list
      .filter((e) => e.entry_type === "tahsilat")
      .map((e) => e.entry_date)
      .sort();
    result.push({
      currency,
      invoiced: round2(
        list
          .filter((e) => isDebit(e.entry_type))
          .reduce((s, e) => s + Number(e.amount), 0),
      ),
      collected: round2(
        list
          .filter((e) => !isDebit(e.entry_type))
          .reduce((s, e) => s + Number(e.amount), 0),
      ),
      balance: round2(list.reduce((s, e) => s + signedAmount(e), 0)),
      overdue: round2(overdueItems.reduce((s, d) => s + d.open, 0)),
      oldestOverdue: overdueItems[0]?.due ?? null,
      lastCollection: collections[collections.length - 1] ?? null,
    });
  }
  const order: LedgerCurrency[] = ["TRY", "USD", "EUR"];
  return result.sort(
    (a, b) => order.indexOf(a.currency) - order.indexOf(b.currency),
  );
}

/** Fatura/açılış kayıtlarının FIFO kapamadan sonra açık kalan tutarı. */
export function openAmounts(entries: LedgerEntry[]) {
  const open = new Map<string, number>();
  const currencies = new Set(entries.map((e) => e.currency));
  for (const currency of currencies) {
    const list = entries.filter((e) => e.currency === currency);
    let credit = list
      .filter((e) => !isDebit(e.entry_type))
      .reduce((sum, e) => sum + Number(e.amount), 0);
    const debits = list
      .filter((e) => isDebit(e.entry_type))
      .sort((a, b) =>
        (a.due_date ?? a.entry_date).localeCompare(b.due_date ?? b.entry_date),
      );
    for (const d of debits) {
      const used = Math.min(Number(d.amount), credit);
      credit -= used;
      open.set(d.id, round2(Number(d.amount) - used));
    }
  }
  return open;
}

/** Tarih sırasında hareketler ve para birimi bazında yürüyen bakiye. */
export function withRunningBalance(entries: LedgerEntry[]) {
  const sorted = [...entries].sort(
    (a, b) =>
      a.entry_date.localeCompare(b.entry_date) ||
      (isDebit(a.entry_type) === isDebit(b.entry_type)
        ? 0
        : isDebit(a.entry_type)
          ? -1
          : 1),
  );
  const running = new Map<LedgerCurrency, number>();
  return sorted.map((entry) => {
    const next = round2(
      (running.get(entry.currency) ?? 0) + signedAmount(entry),
    );
    running.set(entry.currency, next);
    return { ...entry, balance: next };
  });
}

export function money(value: number, currency: LedgerCurrency | string) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

// Ön muhasebe: gider kategorileri, kasa/banka bakiyeleri, tedarikçi
// bakiyeleri ve aylık KDV / gelir-gider özeti.
//
// Hesaplar istemcide yapılır (veri küçük); tablolar:
// purchase_bills, cash_accounts, cash_transactions, suppliers,
// customer_ledger_entries (tahsilat → account_id), invoices (kesilenler).

export type Currency = "TRY" | "USD" | "EUR";

export const expenseCategoryLabels = {
  malzeme: "Malzeme",
  taseron: "Taşeron / işçilik",
  akaryakit: "Akaryakıt",
  arac: "Araç (bakım, sigorta, kira)",
  kira: "Kira",
  abonelik: "Elektrik / su / internet / telefon",
  yazilim: "Yazılım ve abonelikler",
  ofis: "Ofis ve kırtasiye",
  yemek_konaklama: "Yemek / konaklama / yol",
  vergi_harc: "Vergi, harç, ruhsat",
  maas_sgk: "Maaş ve SGK",
  banka: "Banka masrafı ve faiz",
  demirbas: "Demirbaş / cihaz",
  diger: "Diğer",
} as const;
export type ExpenseCategory = keyof typeof expenseCategoryLabels;

export const documentTypeLabels = {
  e_fatura: "e-Fatura",
  e_arsiv: "e-Arşiv",
  kagit: "Kâğıt fatura",
  fis: "Fiş / makbuz",
  diger: "Diğer",
} as const;
export type DocumentType = keyof typeof documentTypeLabels;

export const accountKindLabels = {
  banka: "Banka",
  kasa: "Kasa",
  kredi_karti: "Kredi kartı",
  diger: "Diğer",
} as const;
export type AccountKind = keyof typeof accountKindLabels;

export const txnKindLabels = {
  tedarikci_odeme: "Tedarikçi ödemesi",
  gider: "Doğrudan gider",
  gelir: "Diğer gelir",
  virman: "Hesaplar arası virman",
  diger: "Diğer",
} as const;
export type TxnKind = keyof typeof txnKindLabels;

export type CashAccount = {
  id: string;
  name: string;
  kind: AccountKind;
  currency: Currency;
  bank_name: string | null;
  iban: string | null;
  opening_balance: number;
  opening_date: string;
  show_on_invoice: boolean;
  is_active: boolean;
  sort_order: number;
};

export type CashTxn = {
  id: string;
  account_id: string;
  txn_date: string;
  direction: "giris" | "cikis";
  amount: number;
  kind: TxnKind;
  category: string | null;
  description: string | null;
  supplier_id: string | null;
  purchase_bill_id: string | null;
  project_id: string | null;
  transfer_group: string | null;
};

export type LedgerCollection = {
  id: string;
  account_id: string | null;
  entry_date: string;
  amount: number;
  currency: Currency;
  customer_id: string;
  description: string | null;
  document_no: string | null;
};

export type PurchaseBill = {
  id: string;
  supplier_id: string | null;
  document_type: DocumentType;
  document_no: string | null;
  ettn: string | null;
  issue_date: string;
  due_date: string | null;
  category: ExpenseCategory;
  description: string | null;
  project_id: string | null;
  currency: Currency;
  exchange_rate: number;
  net_amount: number;
  vat_amount: number;
  withholding_amount: number;
  total_amount: number;
  attachment_path: string | null;
  source: "elle" | "parasut";
  notes: string | null;
};

export type IssuedInvoice = {
  id: string;
  issue_date: string;
  currency: Currency;
  exchange_rate: number;
  subtotal: number;
  vat_total: number;
  withholding_total: number;
  payable_total: number;
  invoice_type: string;
};

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/** Hesap hareketleri: açılış + para hareketleri + bu hesaba yazılmış cari
 * tahsilatlar. Yürüyen bakiye ile, tarihe göre. */
export function accountStatement(
  account: CashAccount,
  txns: CashTxn[],
  collections: LedgerCollection[],
) {
  type Row = {
    key: string;
    date: string;
    label: string;
    detail: string | null;
    amount: number;
    source: "hareket" | "tahsilat";
    txn?: CashTxn;
  };
  const rows: Row[] = [
    ...txns
      .filter((t) => t.account_id === account.id)
      .map((t) => ({
        key: `t-${t.id}`,
        date: t.txn_date,
        label: txnKindLabels[t.kind] ?? t.kind,
        detail: t.description,
        amount: t.direction === "giris" ? Number(t.amount) : -Number(t.amount),
        source: "hareket" as const,
        txn: t,
      })),
    ...collections
      .filter((c) => c.account_id === account.id)
      .map((c) => ({
        key: `c-${c.id}`,
        date: c.entry_date,
        label: "Müşteri tahsilatı",
        detail:
          [c.document_no, c.description].filter(Boolean).join(" · ") || null,
        amount: Number(c.amount),
        source: "tahsilat" as const,
      })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
  let running = Number(account.opening_balance);
  const withBalance = rows.map((r) => {
    running = round2(running + r.amount);
    return { ...r, balance: running };
  });
  return { rows: withBalance, balance: round2(running) };
}

/** Alış faturasının ödenen ve kalan tutarı. */
export function billPayments(bills: PurchaseBill[], txns: CashTxn[]) {
  const paid = new Map<string, number>();
  for (const t of txns) {
    if (!t.purchase_bill_id) continue;
    const sign = t.direction === "cikis" ? 1 : -1;
    paid.set(
      t.purchase_bill_id,
      round2((paid.get(t.purchase_bill_id) ?? 0) + sign * Number(t.amount)),
    );
  }
  return new Map(
    bills.map((b) => {
      const p = paid.get(b.id) ?? 0;
      return [
        b.id,
        { paid: p, remaining: round2(Math.max(Number(b.total_amount) - p, 0)) },
      ];
    }),
  );
}

/** Tedarikçi bazında borç: alış faturaları − ödemeler (para birimi bazında). */
export function supplierBalances(bills: PurchaseBill[], txns: CashTxn[]) {
  const map = new Map<string, Map<Currency, number>>();
  const add = (supplier: string, cur: Currency, v: number) => {
    const m = map.get(supplier) ?? new Map<Currency, number>();
    m.set(cur, round2((m.get(cur) ?? 0) + v));
    map.set(supplier, m);
  };
  for (const b of bills) {
    if (b.supplier_id) add(b.supplier_id, b.currency, Number(b.total_amount));
  }
  const billCurrency = new Map(bills.map((b) => [b.id, b.currency]));
  for (const t of txns) {
    if (!t.supplier_id) continue;
    const cur =
      (t.purchase_bill_id && billCurrency.get(t.purchase_bill_id)) || "TRY";
    add(
      t.supplier_id,
      cur,
      t.direction === "cikis" ? -Number(t.amount) : Number(t.amount),
    );
  }
  return map;
}

export type MonthSummary = {
  month: string; // YYYY-MM
  /** Satış (kesilen faturalar), TL karşılığı, KDV hariç. */
  salesNet: number;
  /** Hesaplanan KDV (tevkif edilen kısım düşülmüş: satıcının beyan edeceği). */
  salesVat: number;
  /** Alış / gider (KDV hariç), TL. */
  purchaseNet: number;
  /** İndirilecek KDV (alış faturalarındaki KDV), TL. */
  purchaseVat: number;
  /** Tahmini ödenecek KDV = hesaplanan − indirilecek (eksi ise devreden). */
  vatPayable: number;
  /** Brüt sonuç = satış − gider (KDV hariç). */
  result: number;
  cashIn: number;
  cashOut: number;
};

/** Aylık KDV ve gelir-gider özeti (TL). Tahmindir; beyannameyi mali
 * müşavir hazırlar (devreden KDV, tevkifat beyanı vb. dahil değildir). */
export function monthlySummary(
  invoices: IssuedInvoice[],
  bills: PurchaseBill[],
  txns: CashTxn[],
  collections: LedgerCollection[],
  accounts: CashAccount[],
): MonthSummary[] {
  const months = new Map<string, MonthSummary>();
  const get = (date: string) => {
    const m = date.slice(0, 7);
    let s = months.get(m);
    if (!s) {
      s = {
        month: m,
        salesNet: 0,
        salesVat: 0,
        purchaseNet: 0,
        purchaseVat: 0,
        vatPayable: 0,
        result: 0,
        cashIn: 0,
        cashOut: 0,
      };
      months.set(m, s);
    }
    return s;
  };
  for (const inv of invoices) {
    const rate = inv.currency === "TRY" ? 1 : Number(inv.exchange_rate) || 1;
    const sign = inv.invoice_type === "IADE" ? -1 : 1;
    const s = get(inv.issue_date);
    s.salesNet += sign * Number(inv.subtotal) * rate;
    s.salesVat +=
      sign * (Number(inv.vat_total) - Number(inv.withholding_total)) * rate;
  }
  for (const b of bills) {
    const rate = b.currency === "TRY" ? 1 : Number(b.exchange_rate) || 1;
    const s = get(b.issue_date);
    s.purchaseNet += Number(b.net_amount) * rate;
    s.purchaseVat += Number(b.vat_amount) * rate;
  }
  const tryAccounts = new Set(
    accounts.filter((a) => a.currency === "TRY").map((a) => a.id),
  );
  for (const t of txns) {
    if (!tryAccounts.has(t.account_id) || t.kind === "virman") continue;
    const s = get(t.txn_date);
    if (t.direction === "giris") s.cashIn += Number(t.amount);
    else s.cashOut += Number(t.amount);
  }
  for (const c of collections) {
    if (c.currency !== "TRY") continue;
    get(c.entry_date).cashIn += Number(c.amount);
  }
  return [...months.values()]
    .map((s) => ({
      ...s,
      salesNet: round2(s.salesNet),
      salesVat: round2(s.salesVat),
      purchaseNet: round2(s.purchaseNet),
      purchaseVat: round2(s.purchaseVat),
      vatPayable: round2(s.salesVat - s.purchaseVat),
      result: round2(s.salesNet - s.purchaseNet),
      cashIn: round2(s.cashIn),
      cashOut: round2(s.cashOut),
    }))
    .sort((a, b) => b.month.localeCompare(a.month));
}

export function tl(value: number) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 2,
  }).format(value);
}

export function cur(value: number, currency: Currency | string) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

export const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-");
  const names = [
    "Ocak",
    "Şubat",
    "Mart",
    "Nisan",
    "Mayıs",
    "Haziran",
    "Temmuz",
    "Ağustos",
    "Eylül",
    "Ekim",
    "Kasım",
    "Aralık",
  ];
  return `${names[Number(m) - 1]} ${y}`;
};

/** Tutar girişi: "1.234,56" ve "1234.56" ikisini de kabul eder. */
export function parseAmount(text: string) {
  const t = text.trim();
  if (!t) return NaN;
  const normalized = t.includes(",")
    ? t.replace(/\./g, "").replace(",", ".")
    : t;
  return Number(normalized);
}

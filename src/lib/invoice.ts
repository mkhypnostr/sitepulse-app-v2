// Fatura: tutar hesabı (veritabanı tetikleyicisiyle aynı yuvarlama), yazıyla
// tutar, müşteriye gidecek fatura görünümü (HTML) ve UBL-TR 1.2 XML.
//
// Yasal not: Fatura hukuken GİB sisteminde (GİB e-Belge portalı veya özel
// entegratör) kesilir. Burada hazırlanan belge GİB'e girilecek bilgilerin
// eksiksiz ve doğru hesaplanmış halidir; kesildikten sonra GİB numarası ve
// ETTN ile arşivlenir.

import { NES_COMPANY } from "@/lib/company";

export type InvoiceStatus = "taslak" | "kesildi" | "iptal";
export type InvoiceProfile = "TEMELFATURA" | "TICARIFATURA" | "EARSIVFATURA";
export type InvoiceType = "SATIS" | "IADE" | "TEVKIFAT" | "ISTISNA";
export type InvoiceCurrency = "TRY" | "USD" | "EUR";

export const invoiceStatusLabels: Record<InvoiceStatus, string> = {
  taslak: "Taslak",
  kesildi: "Kesildi",
  iptal: "İptal",
};

export const invoiceProfileLabels: Record<InvoiceProfile, string> = {
  TICARIFATURA: "e-Fatura · Ticari",
  TEMELFATURA: "e-Fatura · Temel",
  EARSIVFATURA: "e-Arşiv",
};

export const invoiceTypeLabels: Record<InvoiceType, string> = {
  SATIS: "Satış",
  TEVKIFAT: "Tevkifatlı satış",
  IADE: "İade",
  ISTISNA: "KDV istisnalı",
};

/** Sık kullanılan KDV tevkifat kodları (KDV Genel Uygulama Tebliği).
 * Oran ve kod uygulamadan önce mali müşavirle teyit edilmeli. */
export const withholdingOptions = [
  {
    code: "601",
    rate: 0.4,
    label: "601 · Yapım işleri ve mühendislik-mimarlık, etüt-proje (4/10)",
  },
  {
    code: "602",
    rate: 0.9,
    label: "602 · Etüt, plan-proje, danışmanlık, denetim (9/10)",
  },
  {
    code: "603",
    rate: 0.7,
    label: "603 · Makine, teçhizat bakım ve onarım (7/10)",
  },
  { code: "606", rate: 0.9, label: "606 · İşgücü temin hizmetleri (9/10)" },
] as const;

export const vatRates = [0.2, 0.1, 0.01, 0] as const;
export const invoiceUnits = [
  "Adet",
  "Metre",
  "Kg",
  "Set",
  "Takım",
  "Saat",
  "Gün",
  "Ay",
  "m²",
  "kWp",
  "Hizmet",
] as const;

export type InvoiceLineInput = {
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  discount_rate: number;
  vat_rate: number;
};

export type InvoiceHeader = {
  draft_no: string | null;
  status: InvoiceStatus;
  profile: InvoiceProfile;
  invoice_type: InvoiceType;
  buyer_title: string;
  buyer_tax_no: string | null;
  buyer_tax_office: string | null;
  buyer_address: string | null;
  buyer_email: string | null;
  issue_date: string;
  due_date: string | null;
  currency: InvoiceCurrency;
  exchange_rate: number;
  withholding_code: string | null;
  withholding_rate: number;
  exemption_code: string | null;
  exemption_reason: string | null;
  notes: string | null;
  ettn: string;
  gib_invoice_no: string | null;
  issued_at: string | null;
};

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

export function lineAmounts(line: InvoiceLineInput) {
  const gross = round2(Number(line.quantity) * Number(line.unit_price));
  const net = round2(
    Number(line.quantity) *
      Number(line.unit_price) *
      (1 - Number(line.discount_rate)),
  );
  const vat = round2(net * Number(line.vat_rate));
  return { gross, net, discount: round2(Math.max(gross - net, 0)), vat };
}

export type InvoiceTotals = {
  gross: number;
  discount: number;
  subtotal: number;
  vat: number;
  withholding: number;
  grand: number;
  payable: number;
  /** KDV oranı bazında matrah ve vergi. */
  byRate: { rate: number; base: number; vat: number }[];
};

export function invoiceTotals(
  lines: InvoiceLineInput[],
  type: InvoiceType,
  withholdingRate: number,
): InvoiceTotals {
  let gross = 0;
  let subtotal = 0;
  let vat = 0;
  const byRate = new Map<number, { base: number; vat: number }>();
  for (const line of lines) {
    const a = lineAmounts(line);
    gross += a.gross;
    subtotal += a.net;
    vat += a.vat;
    const r = byRate.get(Number(line.vat_rate)) ?? { base: 0, vat: 0 };
    r.base += a.net;
    r.vat += a.vat;
    byRate.set(Number(line.vat_rate), r);
  }
  subtotal = round2(subtotal);
  vat = round2(vat);
  const withholding =
    type === "TEVKIFAT" ? round2(vat * Number(withholdingRate)) : 0;
  return {
    gross: round2(gross),
    discount: round2(Math.max(gross - subtotal, 0)),
    subtotal,
    vat,
    withholding,
    grand: round2(subtotal + vat),
    payable: round2(subtotal + vat - withholding),
    byRate: [...byRate.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([rate, v]) => ({ rate, base: round2(v.base), vat: round2(v.vat) })),
  };
}

// ---------------------------------------------------------------------------
// Yazıyla tutar (GİB faturalarındaki "Yazıyla Toplam Tutar" notu)

const ONES = [
  "",
  "Bir",
  "İki",
  "Üç",
  "Dört",
  "Beş",
  "Altı",
  "Yedi",
  "Sekiz",
  "Dokuz",
];
const TENS = [
  "",
  "On",
  "Yirmi",
  "Otuz",
  "Kırk",
  "Elli",
  "Altmış",
  "Yetmiş",
  "Seksen",
  "Doksan",
];
const SCALES = ["", "Bin", "Milyon", "Milyar", "Trilyon"];

function threeDigits(n: number) {
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const o = n % 10;
  return (h === 0 ? "" : (h === 1 ? "" : ONES[h]) + "Yüz") + TENS[t] + ONES[o];
}

export function integerToTurkishWords(value: number) {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return "Sıfır";
  const parts: string[] = [];
  let scale = 0;
  while (n > 0) {
    const chunk = n % 1000;
    if (chunk > 0) {
      // "Bir Bin" denmez: 1.000 = "Bin"
      const words = scale === 1 && chunk === 1 ? "" : threeDigits(chunk);
      parts.unshift(words + SCALES[scale]);
    }
    n = Math.floor(n / 1000);
    scale += 1;
  }
  return parts.join("");
}

const CURRENCY_WORDS: Record<InvoiceCurrency, [string, string]> = {
  TRY: ["TürkLirası", "Kuruş"],
  USD: ["ABDDoları", "Sent"],
  EUR: ["Avro", "Sent"],
};

export function amountInWords(value: number, currency: InvoiceCurrency) {
  const fixed = round2(Math.abs(value));
  const whole = Math.floor(fixed);
  const cents = Math.round((fixed - whole) * 100);
  const [main, sub] = CURRENCY_WORDS[currency];
  return `${integerToTurkishWords(whole)}${main}${integerToTurkishWords(cents)}${sub}`;
}

// ---------------------------------------------------------------------------
// Biçimlendirme

export function invoiceMoney(value: number, currency: InvoiceCurrency) {
  const symbol = currency === "TRY" ? "TL" : currency;
  return `${new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)} ${symbol}`;
}

const qtyFmt = (v: number) =>
  new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 4 }).format(v);

const dateTr = (iso: string | null) =>
  iso ? iso.slice(0, 10).split("-").reverse().join(".") : "";

const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export function isTckn(taxNo: string | null) {
  return !!taxNo && taxNo.length === 11;
}

// ---------------------------------------------------------------------------
// Fatura görünümü (A4, yazdır / PDF). Kesilmemiş belgede "TASLAK" filigranı.

export function invoiceHtml(
  header: InvoiceHeader,
  lines: InvoiceLineInput[],
  origin: string,
) {
  const totals = invoiceTotals(
    lines,
    header.invoice_type,
    header.withholding_rate,
  );
  const c = NES_COMPANY;
  const issued = header.status === "kesildi";
  const cancelled = header.status === "iptal";
  const docLabel =
    header.profile === "EARSIVFATURA" ? "e-Arşiv Fatura" : "e-Fatura";
  const rows = lines
    .map((line, index) => {
      const a = lineAmounts(line);
      return `<tr>
        <td class="c">${index + 1}</td>
        <td>${esc(line.description)}</td>
        <td class="r">${qtyFmt(Number(line.quantity))}</td>
        <td class="c">${esc(line.unit)}</td>
        <td class="r">${invoiceMoney(Number(line.unit_price), header.currency)}</td>
        ${totals.discount > 0 ? `<td class="r">${Number(line.discount_rate) > 0 ? `%${qtyFmt(Number(line.discount_rate) * 100)}` : "-"}</td>` : ""}
        <td class="r">%${qtyFmt(Number(line.vat_rate) * 100)}</td>
        <td class="r">${invoiceMoney(a.vat, header.currency)}</td>
        <td class="r">${invoiceMoney(a.net, header.currency)}</td>
      </tr>`;
    })
    .join("");
  const rateRows = totals.byRate
    .map(
      (r) =>
        `<tr><td>Hesaplanan KDV (%${qtyFmt(r.rate * 100)})</td><td class="r">${invoiceMoney(r.vat, header.currency)}</td></tr>`,
    )
    .join("");
  const withholdingLabel =
    withholdingOptions.find((o) => o.code === header.withholding_code)?.label ??
    header.withholding_code ??
    "";
  const notes = [
    header.notes,
    header.invoice_type === "ISTISNA" && header.exemption_reason
      ? `İstisna: ${header.exemption_code ?? ""} ${header.exemption_reason}`
      : null,
    header.currency !== "TRY"
      ? `Döviz kuru: 1 ${header.currency} = ${qtyFmt(Number(header.exchange_rate))} TL · TL karşılığı ${invoiceMoney(round2(totals.payable * Number(header.exchange_rate)), "TRY")}`
      : null,
    `${c.bank} IBAN (${header.currency === "TRY" ? "TRL" : header.currency}): ${c.iban}`,
    `Yazıyla Toplam Tutar: ${amountInWords(totals.payable, header.currency)}`,
  ]
    .filter(Boolean)
    .map((n) => `<div>${esc(n)}</div>`)
    .join("");

  return `<!doctype html><html lang="tr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(header.gib_invoice_no ?? header.draft_no ?? "Fatura")} · ${esc(header.buyer_title)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #e6eaeb; font-family: Arial, Helvetica, sans-serif; color: #1f2933; font-size: 11px; }
  .page { width: 794px; min-height: 1123px; margin: 16px auto; background: #fff; padding: 36px 40px; position: relative; }
  .top { display: grid; grid-template-columns: 1fr 120px 1fr; gap: 16px; align-items: start; }
  .logo { height: 54px; }
  .seller b, .buyer b { font-size: 12px; }
  .muted { color: #6b7780; font-size: 10px; margin-top: 6px; }
  .mid { text-align: center; padding-top: 18px; font-weight: bold; font-size: 15px; color: #0b5d6e; }
  .buyer { border-top: 1px solid #d6dde1; padding-top: 10px; margin-top: 8px; }
  .meta { margin-top: 12px; display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px; }
  table.items { width: 100%; border-collapse: collapse; margin-top: 26px; }
  table.items th { text-align: left; font-size: 10px; color: #4b5863; border-bottom: 2px solid #0b5d6e; padding: 6px 4px; }
  table.items td { border-bottom: 1px solid #e3e8eb; padding: 7px 4px; vertical-align: top; }
  .r { text-align: right; white-space: nowrap; } .c { text-align: center; }
  .foot { display: grid; grid-template-columns: 1fr 300px; gap: 24px; margin-top: 22px; }
  table.tot { width: 100%; border-collapse: collapse; }
  table.tot td { padding: 4px 2px; }
  table.tot tr.pay td { font-weight: bold; font-size: 13px; border-top: 2px solid #0b5d6e; padding-top: 8px; }
  .notes { margin-top: 22px; border-top: 1px solid #d6dde1; padding-top: 10px; line-height: 1.6; }
  .wm { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; font-size: 110px; font-weight: bold; color: rgba(200,40,40,0.10); transform: rotate(-28deg); }
  .warn { margin-top: 14px; padding: 8px 10px; border: 1px dashed #c0392b; color: #a3271c; font-size: 10px; }
  @media print { body { background: #fff; } .page { margin: 0; width: auto; min-height: 0; padding: 0; } }
</style></head><body><div class="page">
${issued ? "" : `<div class="wm">${cancelled ? "İPTAL" : "TASLAK"}</div>`}
<div class="top">
  <div class="seller">
    <img class="logo" src="${esc(origin)}/nes-enerji-logo.png" alt="NES Enerji">
    <div style="margin-top:10px"><b>${esc(c.legalName)}</b></div>
    <div>${esc(c.address)}</div><div>${esc(c.district)}</div>
    <div class="muted">Telefon</div><div>${esc(c.phone)}</div>
    <div class="muted">E-posta</div><div>${esc(c.email)}</div>
    <div class="muted">Vergi No</div><div>${esc(c.taxNo)} (${esc(c.taxOffice)})</div>
    <div class="muted">Ticaret Sicil No</div><div>${esc(c.tradeRegistryNo)}</div>
    <div class="muted">Mersis No</div><div>${esc(c.mersisNo)}</div>
  </div>
  <div class="mid">${docLabel}</div>
  <div>
    <div class="buyer">
      <div class="muted">Sayın</div>
      <div><b>${esc(header.buyer_title)}</b></div>
      <div>${esc(header.buyer_address ?? "")}</div>
      ${header.buyer_email ? `<div class="muted">E-posta</div><div>${esc(header.buyer_email)}</div>` : ""}
      <div class="muted">${isTckn(header.buyer_tax_no) ? "TCKN" : "Vergi No"}</div>
      <div>${esc(header.buyer_tax_no ?? "-")}${header.buyer_tax_office ? ` (${esc(header.buyer_tax_office)})` : ""}</div>
    </div>
    <div class="meta">
      <div><div class="muted">Fatura Numarası</div><div>${esc(header.gib_invoice_no ?? `${header.draft_no ?? ""} (taslak)`)}</div></div>
      <div><div class="muted">Fatura Tarihi</div><div>${dateTr(header.issue_date)}</div></div>
      <div><div class="muted">Fatura Tipi</div><div>${esc(header.invoice_type)}</div></div>
      <div><div class="muted">Ödeme Tarihi</div><div>${dateTr(header.due_date) || "-"}</div></div>
    </div>
  </div>
</div>
<table class="items"><thead><tr>
  <th class="c">No</th><th>Hizmet / Ürün Adı</th><th class="r">Miktar</th><th class="c">Birim</th><th class="r">Birim Fiyat</th>
  ${totals.discount > 0 ? '<th class="r">İndirim</th>' : ""}<th class="r">KDV Oranı</th><th class="r">KDV Tutarı</th><th class="r">Toplam</th>
</tr></thead><tbody>${rows}</tbody></table>
<div class="foot">
  <div>
    <div class="muted">Senaryo</div><div>${esc(header.profile)}</div>
    <div class="muted">Özelleştirme No</div><div>TR1.2</div>
    <div class="muted">ETTN</div><div>${esc(header.ettn)}</div>
    ${header.invoice_type === "TEVKIFAT" ? `<div class="muted">Tevkifat</div><div>${esc(withholdingLabel)}</div>` : ""}
  </div>
  <table class="tot">
    <tr><td>Mal Hizmet Toplam Tutarı</td><td class="r">${invoiceMoney(totals.gross, header.currency)}</td></tr>
    <tr><td>Toplam İndirim</td><td class="r">${invoiceMoney(totals.discount, header.currency)}</td></tr>
    ${rateRows}
    <tr><td>Vergiler Dahil Toplam Tutar</td><td class="r">${invoiceMoney(totals.grand, header.currency)}</td></tr>
    ${totals.withholding > 0 ? `<tr><td>Tevkif Edilen KDV</td><td class="r">-${invoiceMoney(totals.withholding, header.currency)}</td></tr>` : ""}
    <tr class="pay"><td>Ödenecek Tutar</td><td class="r">${invoiceMoney(totals.payable, header.currency)}</td></tr>
  </table>
</div>
<div class="notes"><div class="muted">Fatura Notu</div>${notes}</div>
${issued ? "" : `<div class="warn">${cancelled ? "Bu fatura iptal edilmiştir." : "Bu belge taslaktır; yasal fatura değildir. Fatura GİB sisteminde kesildikten sonra GİB numarası ve ETTN ile geçerlidir."}</div>`}
</div></body></html>`;
}

// ---------------------------------------------------------------------------
// UBL-TR 1.2 (imzasız). Arşiv, mali müşavir ve XML kabul eden entegratörler
// için. İmza GİB portalı / entegratör tarafından eklenir.

const x = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
const amt = (v: number) => round2(v).toFixed(2);

const UNIT_CODES: Record<string, string> = {
  Adet: "C62",
  Metre: "MTR",
  Kg: "KGM",
  Set: "SET",
  Takım: "SET",
  Saat: "HUR",
  Gün: "DAY",
  Ay: "MON",
  "m²": "MTK",
  kWp: "KWT",
  Hizmet: "C62",
};

function partyXml(opts: {
  idScheme: "VKN" | "TCKN";
  id: string;
  name: string;
  address: string;
  city: string;
  taxOffice: string;
  extraIds?: { scheme: string; id: string }[];
}) {
  const person =
    opts.idScheme === "TCKN"
      ? (() => {
          const parts = opts.name.trim().split(/\s+/);
          const family = parts.length > 1 ? parts.pop() : "";
          return `<cac:Person><cbc:FirstName>${x(parts.join(" "))}</cbc:FirstName><cbc:FamilyName>${x(family)}</cbc:FamilyName></cac:Person>`;
        })()
      : "";
  return `<cac:Party>
      <cac:PartyIdentification><cbc:ID schemeID="${opts.idScheme}">${x(opts.id)}</cbc:ID></cac:PartyIdentification>
      ${(opts.extraIds ?? []).map((e) => `<cac:PartyIdentification><cbc:ID schemeID="${x(e.scheme)}">${x(e.id)}</cbc:ID></cac:PartyIdentification>`).join("")}
      ${opts.idScheme === "VKN" ? `<cac:PartyName><cbc:Name>${x(opts.name)}</cbc:Name></cac:PartyName>` : ""}
      <cac:PostalAddress>
        <cbc:StreetName>${x(opts.address)}</cbc:StreetName>
        <cbc:CitySubdivisionName>${x(opts.city)}</cbc:CitySubdivisionName>
        <cbc:CityName>${x(opts.city)}</cbc:CityName>
        <cac:Country><cbc:Name>Türkiye</cbc:Name></cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme><cac:TaxScheme><cbc:Name>${x(opts.taxOffice)}</cbc:Name></cac:TaxScheme></cac:PartyTaxScheme>
      ${person}
    </cac:Party>`;
}

export function invoiceUblXml(
  header: InvoiceHeader,
  lines: InvoiceLineInput[],
) {
  const totals = invoiceTotals(
    lines,
    header.invoice_type,
    header.withholding_rate,
  );
  const c = NES_COMPANY;
  const cur = header.currency;
  const buyerTax = header.buyer_tax_no ?? "11111111111";
  const lineXml = lines
    .map((line, i) => {
      const a = lineAmounts(line);
      return `<cac:InvoiceLine>
    <cbc:ID>${i + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${UNIT_CODES[line.unit] ?? "C62"}">${Number(line.quantity)}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${cur}">${amt(a.net)}</cbc:LineExtensionAmount>
    ${a.discount > 0 ? `<cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:MultiplierFactorNumeric>${Number(line.discount_rate)}</cbc:MultiplierFactorNumeric><cbc:Amount currencyID="${cur}">${amt(a.discount)}</cbc:Amount><cbc:BaseAmount currencyID="${cur}">${amt(a.gross)}</cbc:BaseAmount></cac:AllowanceCharge>` : ""}
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="${cur}">${amt(a.vat)}</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="${cur}">${amt(a.net)}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="${cur}">${amt(a.vat)}</cbc:TaxAmount>
        <cbc:Percent>${round2(Number(line.vat_rate) * 100)}</cbc:Percent>
        <cac:TaxCategory>
          ${Number(line.vat_rate) === 0 && header.exemption_code ? `<cbc:TaxExemptionReasonCode>${x(header.exemption_code)}</cbc:TaxExemptionReasonCode><cbc:TaxExemptionReason>${x(header.exemption_reason)}</cbc:TaxExemptionReason>` : ""}
          <cac:TaxScheme><cbc:Name>KDV</cbc:Name><cbc:TaxTypeCode>0015</cbc:TaxTypeCode></cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:Item><cbc:Name>${x(line.description)}</cbc:Name></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="${cur}">${Number(line.unit_price)}</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>`;
    })
    .join("\n  ");

  const taxSubtotals = totals.byRate
    .map(
      (r) => `<cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${cur}">${amt(r.base)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${cur}">${amt(r.vat)}</cbc:TaxAmount>
      <cbc:Percent>${round2(r.rate * 100)}</cbc:Percent>
      <cac:TaxCategory>
        ${r.rate === 0 && header.exemption_code ? `<cbc:TaxExemptionReasonCode>${x(header.exemption_code)}</cbc:TaxExemptionReasonCode><cbc:TaxExemptionReason>${x(header.exemption_reason)}</cbc:TaxExemptionReason>` : ""}
        <cac:TaxScheme><cbc:Name>KDV</cbc:Name><cbc:TaxTypeCode>0015</cbc:TaxTypeCode></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>`,
    )
    .join("\n    ");

  const withholdingXml =
    totals.withholding > 0
      ? `<cac:WithholdingTaxTotal>
    <cbc:TaxAmount currencyID="${cur}">${amt(totals.withholding)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${cur}">${amt(totals.vat)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${cur}">${amt(totals.withholding)}</cbc:TaxAmount>
      <cbc:Percent>${round2(Number(header.withholding_rate) * 100)}</cbc:Percent>
      <cac:TaxCategory><cac:TaxScheme><cbc:Name>KDV TEVKİFAT</cbc:Name><cbc:TaxTypeCode>${x(header.withholding_code)}</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:WithholdingTaxTotal>`
      : "";

  const notes = [
    header.notes,
    `Yazıyla Toplam Tutar: ${amountInWords(totals.payable, cur)}`,
    `${c.bank} IBAN: ${c.iban}`,
  ]
    .filter(Boolean)
    .map((n) => `<cbc:Note>${x(n)}</cbc:Note>`)
    .join("\n  ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
  xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>TR1.2</cbc:CustomizationID>
  <cbc:ProfileID>${header.profile === "EARSIVFATURA" ? "EARSIVFATURA" : header.profile}</cbc:ProfileID>
  <cbc:ID>${x(header.gib_invoice_no ?? "")}</cbc:ID>
  <cbc:CopyIndicator>false</cbc:CopyIndicator>
  <cbc:UUID>${x(header.ettn)}</cbc:UUID>
  <cbc:IssueDate>${x(header.issue_date)}</cbc:IssueDate>
  <cbc:InvoiceTypeCode>${x(header.invoice_type)}</cbc:InvoiceTypeCode>
  ${notes}
  <cbc:DocumentCurrencyCode>${cur}</cbc:DocumentCurrencyCode>
  <cbc:LineCountNumeric>${lines.length}</cbc:LineCountNumeric>
  <cac:AccountingSupplierParty>
    ${partyXml({
      idScheme: "VKN",
      id: c.taxNo,
      name: c.legalName,
      address: c.address,
      city: c.city,
      taxOffice: c.taxOffice,
      extraIds: [
        { scheme: "MERSISNO", id: c.mersisNo },
        { scheme: "TICARETSICILNO", id: c.tradeRegistryNo },
      ],
    })}
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    ${partyXml({
      idScheme: isTckn(buyerTax) ? "TCKN" : "VKN",
      id: buyerTax,
      name: header.buyer_title,
      address: header.buyer_address ?? "",
      city: "",
      taxOffice: header.buyer_tax_office ?? "",
    })}
  </cac:AccountingCustomerParty>
  ${header.due_date ? `<cac:PaymentMeans><cbc:PaymentMeansCode>42</cbc:PaymentMeansCode><cbc:PaymentDueDate>${x(header.due_date)}</cbc:PaymentDueDate><cac:PayeeFinancialAccount><cbc:ID>${x(c.iban.replace(/\s/g, ""))}</cbc:ID></cac:PayeeFinancialAccount></cac:PaymentMeans>` : ""}
  ${cur !== "TRY" ? `<cac:PricingExchangeRate><cbc:SourceCurrencyCode>${cur}</cbc:SourceCurrencyCode><cbc:TargetCurrencyCode>TRY</cbc:TargetCurrencyCode><cbc:CalculationRate>${Number(header.exchange_rate)}</cbc:CalculationRate></cac:PricingExchangeRate>` : ""}
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${cur}">${amt(totals.vat)}</cbc:TaxAmount>
    ${taxSubtotals}
  </cac:TaxTotal>
  ${withholdingXml}
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${cur}">${amt(totals.subtotal)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${cur}">${amt(totals.subtotal)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${cur}">${amt(totals.grand)}</cbc:TaxInclusiveAmount>
    <cbc:AllowanceTotalAmount currencyID="${cur}">${amt(totals.discount)}</cbc:AllowanceTotalAmount>
    <cbc:PayableAmount currencyID="${cur}">${amt(totals.payable)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  ${lineXml}
</Invoice>
`;
}

/** GİB portal adresleri (ücretsiz). e-Fatura portalı mali mühür / e-imza,
 * e-Arşiv portalı İnteraktif Vergi Dairesi bilgileriyle açılır. */
export const GIB_PORTALS = {
  efatura: "https://portal.efatura.gov.tr/efaturaportal/",
  earsiv: "https://earsivportal.efatura.gov.tr/intragiris.html",
  mukellefSorgu: "https://sorgu.efatura.gov.tr/kullanicilar/xliste.php",
} as const;

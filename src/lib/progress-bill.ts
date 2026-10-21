// Hakediş: taşeronun getirdiği liste (alış) → müşteriye giden hakediş
// (alış + kâr). İki belge üretilir:
//  - Müşteri hakedişi: yalnız satış fiyatları; alış, kâr oranı ve taşeron
//    adı GEÇMEZ.
//  - Taşeron kaydı (iç): alış tutarları, kâr özeti ve taşeronun asıl listesinin
//    fotoğrafı. Dışarıya verilmez.
import { integerToTurkishWords } from "@/lib/invoice";
import type { CompanyInfo } from "@/lib/company";

export type BillStatus = "taslak" | "gonderildi" | "onaylandi" | "iptal";
export const billStatusLabels: Record<BillStatus, string> = {
  taslak: "Taslak",
  gonderildi: "Müşteriye gönderildi",
  onaylandi: "Onaylandı",
  iptal: "İptal",
};

export type BillLine = {
  id: string;
  quantity: number;
  unit: string;
  description: string;
  cost_amount: number;
  note: string | null;
};

export type BillHeader = {
  bill_no: string | null;
  title: string;
  customer_name: string | null;
  subcontractor_name: string;
  margin_pct: number;
  vat_rate: number;
  written_total: number | null;
  bill_date: string;
  notes: string | null;
};

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/** Müşteri tutarı: alış × (1 + kâr oranı), kuruşa yuvarlanmış. */
export const sellAmount = (cost: number, marginPct: number) =>
  r2(Number(cost) * (1 + Number(marginPct) / 100));

export function billTotals(
  lines: BillLine[],
  marginPct: number,
  vatRate: number,
) {
  const cost = r2(lines.reduce((s, l) => s + Number(l.cost_amount || 0), 0));
  const sell = r2(
    lines.reduce((s, l) => s + sellAmount(l.cost_amount || 0, marginPct), 0),
  );
  const vat = r2(sell * (Number(vatRate) / 100));
  return {
    cost,
    sell,
    vat,
    grand: r2(sell + vat),
    profit: r2(sell - cost),
    marginOfSale: sell > 0 ? r2(((sell - cost) / sell) * 100) : 0,
  };
}

const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
export const tl = (v: number) =>
  new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v) + " ₺";
const qty = (v: number) =>
  new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 3 }).format(v);
const dateTr = (iso: string) => iso.slice(0, 10).split("-").reverse().join(".");

function inWords(v: number) {
  const whole = Math.floor(v);
  const kurus = Math.round((v - whole) * 100);
  // integerToTurkishWords kelimeleri bitişik yazar (fatura usulü); burada
  // okunurluk için büyük harflerden ayrılır.
  const spaced = (n: number) =>
    integerToTurkishWords(n).replace(/(?<=[a-zçğıöşü])(?=[A-ZÇĞİÖŞÜ])/g, " ");
  return `${spaced(whole)} Türk Lirası${kurus ? ` ${spaced(kurus)} Kuruş` : ""}`;
}

const CSS = `
@page{size:A4;margin:12mm}
*{box-sizing:border-box}
body{margin:0;background:#e6eaeb;font-family:"Segoe UI",Arial,Helvetica,sans-serif;color:#1f2933;font-size:10.5px}
.page{width:794px;min-height:1080px;margin:16px auto;background:#fff;padding:30px 34px}
.head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0b4ea2;padding-bottom:10px}
.head img{height:42px}
.firm{text-align:right;font-size:9px;line-height:1.45;color:#52606d}
.firm b{color:#1f2933;font-size:10px}
h1{font-size:19px;margin:14px 0 2px;color:#0b4ea2}
.sub{color:#52606d;margin-bottom:10px}
.meta{display:grid;grid-template-columns:1fr 1fr;gap:6px 18px;background:#f3f6fa;border:1px solid #dde4ee;border-radius:8px;padding:9px 12px;margin-bottom:10px}
.meta span{display:block;color:#7b8794;font-size:8.5px;text-transform:uppercase;letter-spacing:.4px}
.meta b{font-size:11px}
table{width:100%;border-collapse:collapse}
th{background:#0b4ea2;color:#fff;font-weight:600;font-size:9.5px;padding:6px;text-align:left}
td{padding:3.5px 6px;border-bottom:1px solid #e4e9f0;vertical-align:top}
tr:nth-child(even) td{background:#f8fafc}
.n{text-align:right;white-space:nowrap}.c{text-align:center}
.flag td{background:#fff7e6!important}
.note{font-size:8.5px;color:#b45309;display:block}
.tot{margin-top:6px;margin-left:auto;width:58%}
.tot td{border:none;padding:3px 6px;font-size:11px;background:none!important}
.tot tr.g td{border-top:2px solid #0b4ea2;font-size:13px;font-weight:700;color:#0b4ea2;padding-top:6px}
.words{margin-top:5px;font-size:9.5px;color:#52606d;text-align:right}
.box{border:1px solid #dde4ee;border-radius:8px;padding:7px 11px;margin-top:9px;font-size:9.5px;line-height:1.55}
.warn{border-color:#f5c26b;background:#fff8eb}
.sign{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:18px}
.sign div{border-top:1px solid #9aa5b1;padding-top:6px;text-align:center;font-size:9.5px;min-height:48px}
.foot{margin-top:16px;font-size:8px;color:#9aa5b1;text-align:center}
.stamp{display:inline-block;border:1.5px solid #b91c1c;color:#b91c1c;font-weight:700;padding:2px 8px;border-radius:4px;font-size:9px;letter-spacing:.5px}
.orig{text-align:center}.orig img{max-width:100%;max-height:880px;border:1px solid #dde4ee}
@media print{body{background:#fff}.page{margin:0;width:auto;min-height:0;padding:0;page-break-after:always}.page:last-child{page-break-after:auto}}
`;

function header(company: CompanyInfo, origin: string) {
  return `<div class="head">
  <img src="${esc(origin)}${esc(company.logoUrl)}" alt="${esc(company.brand)}">
  <div class="firm"><b>${esc(company.legalName)}</b><br>
  ${esc(company.address)}, ${esc(company.district)}<br>
  ${esc(company.phone)} · ${esc(company.email)} · ${esc(company.web)}<br>
  ${esc(company.taxOffice)} ${esc(company.taxNo)}${company.mersisNo ? ` · Mersis ${esc(company.mersisNo)}` : ""}</div>
</div>`;
}

function doc(title: string, pages: string[]) {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head><body>
${pages.map((p) => `<div class="page">${p}</div>`).join("")}
</body></html>`;
}

/** Müşteriye giden hakediş. Alış tutarı, kâr oranı ve taşeron geçmez. */
export function customerBillHtml(
  h: BillHeader,
  lines: BillLine[],
  company: CompanyInfo,
  origin: string,
) {
  const t = billTotals(lines, h.margin_pct, h.vat_rate);
  const rows = lines
    .map((l, i) => {
      const amount = sellAmount(l.cost_amount, h.margin_pct);
      return `<tr><td class="c">${i + 1}</td><td>${esc(l.description)}</td><td class="n">${qty(l.quantity)}</td><td class="c">${esc(l.unit)}</td><td class="n">${tl(r2(amount / l.quantity))}</td><td class="n">${tl(amount)}</td></tr>`;
    })
    .join("");
  const body = `${header(company, origin)}
<h1>HAKEDİŞ RAPORU</h1>
<div class="sub">${esc(h.title)}</div>
<div class="meta">
  <div><span>İşveren</span><b>${esc(h.customer_name ? `Sayın ${h.customer_name}` : "-")}</b></div>
  <div><span>Hakediş no / tarihi</span><b>${esc(h.bill_no ?? "Taslak")} · ${dateTr(h.bill_date)}</b></div>
  <div><span>Yüklenici</span><b>${esc(company.legalName)}</b></div>
  <div><span>Kalem sayısı</span><b>${lines.length}</b></div>
</div>
<table><thead><tr><th class="c">#</th><th>İş kalemi</th><th class="n">Miktar</th><th class="c">Birim</th><th class="n">Birim fiyat</th><th class="n">Tutar</th></tr></thead><tbody>${rows}</tbody></table>
<table class="tot">
  <tr><td>Ara toplam (KDV hariç)</td><td class="n">${tl(t.sell)}</td></tr>
  <tr><td>KDV %${qty(h.vat_rate)}</td><td class="n">${tl(t.vat)}</td></tr>
  <tr class="g"><td>Genel toplam (KDV dahil)</td><td class="n">${tl(t.grand)}</td></tr>
</table>
<div class="words">Yalnız: ${esc(inWords(t.grand))}</div>
<div class="box">
  ${company.iban ? `<b>Ödeme bilgisi:</b> ${esc(company.bank)} · ${esc(company.legalName)} · IBAN ${esc(company.iban)}<br>` : ""}
  Hakediş, sahada yapılan ve yerine konan malzeme ile işçilik miktarlarına göre düzenlenmiştir. Miktarlarla ilgili itirazlarınızı 7 gün içinde iletmenizi rica ederiz. Fatura bu hakediş onayından sonra düzenlenecektir.
</div>
<div class="sign">
  <div><b>Düzenleyen</b><br>${esc(company.brand)}</div>
  <div><b>Onaylayan (İşveren)</b><br>${esc(h.customer_name ?? "")}<br>Tarih / imza</div>
</div>
<div class="foot">${esc(company.brand)} · ${esc(company.web)} · Bu belge hakediş bildirimidir, fatura yerine geçmez.</div>`;
  return doc(`${h.bill_no ?? "Hakediş"} · ${h.customer_name ?? ""}`, [body]);
}

/** Taşeron kaydı (iç belge): alış tutarları, fark kontrolü, kâr özeti ve
 * taşeronun asıl listesinin fotoğrafı. */
export function internalRecordHtml(
  h: BillHeader,
  lines: BillLine[],
  company: CompanyInfo,
  origin: string,
  photoUrl: string | null,
) {
  const t = billTotals(lines, h.margin_pct, h.vat_rate);
  const diff = h.written_total != null ? r2(t.cost - h.written_total) : null;
  const rows = lines
    .map(
      (l, i) =>
        `<tr class="${l.note ? "flag" : ""}"><td class="c">${i + 1}</td><td>${esc(l.description)}${l.note ? `<span class="note">⚠ ${esc(l.note)}</span>` : ""}</td><td class="n">${qty(l.quantity)}</td><td class="c">${esc(l.unit)}</td><td class="n">${tl(r2(l.cost_amount / l.quantity))}</td><td class="n">${tl(l.cost_amount)}</td></tr>`,
    )
    .join("");
  const page1 = `${header(company, origin)}
<h1>TAŞERON HAKEDİŞ KAYDI</h1>
<div class="sub"><span class="stamp">İÇ BELGE · MÜŞTERİYE GÖNDERİLMEZ</span></div>
<div class="meta">
  <div><span>Taşeron</span><b>${esc(h.subcontractor_name)}</b></div>
  <div><span>Kayıt tarihi</span><b>${dateTr(h.bill_date)}</b></div>
  <div><span>İş / işveren</span><b>${esc(h.title)}${h.customer_name ? ` · ${esc(h.customer_name)}` : ""}</b></div>
  <div><span>Müşteri hakedişi</span><b>${esc(h.bill_no ?? "Taslak")}</b></div>
</div>
<table><thead><tr><th class="c">#</th><th>Kalem</th><th class="n">Miktar</th><th class="c">Birim</th><th class="n">Birim fiyat</th><th class="n">Taşeron tutarı</th></tr></thead><tbody>${rows}</tbody></table>
<table class="tot">
  <tr><td>Satırların toplamı</td><td class="n">${tl(t.cost)}</td></tr>
  ${h.written_total != null ? `<tr><td>Taşeronun yazdığı toplam</td><td class="n">${tl(h.written_total)}</td></tr><tr><td>Fark</td><td class="n" style="color:${diff ? "#b91c1c" : "#15803d"};font-weight:700">${tl(diff ?? 0)}</td></tr>` : ""}
</table>
${diff ? `<div class="box warn"><b>Kontrol edilecek:</b> Satırların toplamı, taşeronun yazdığı toplamdan ${tl(Math.abs(diff))} ${diff > 0 ? "fazla" : "eksik"}. Bir rakam farklı okunmuş (sarı satırlar) ya da listede toplama hatası olabilir. Ödemeden ve müşteriye göndermeden önce taşeronla teyit edin.</div>` : ""}
<div class="box"><b>Kâr özeti (iç):</b> Taşeron maliyeti ${tl(t.cost)} · müşteriye hakediş (%${qty(h.margin_pct)} kâr, KDV hariç) ${tl(t.sell)} · brüt kâr ${tl(t.profit)} (satış üzerinden marj %${qty(t.marginOfSale)}).${h.notes ? `<br>${esc(h.notes)}` : ""}</div>
<div class="sign">
  <div><b>Teslim eden (taşeron)</b><br>${esc(h.subcontractor_name)}<br>Tarih / imza</div>
  <div><b>Teslim alan</b><br>${esc(company.brand)}</div>
</div>`;
  const page2 = photoUrl
    ? `<div class="orig">${header(company, origin)}
<h1 style="text-align:left">Taşeronun asıl listesi</h1>
<div class="sub" style="text-align:left">Fotoğraf değiştirilmeden eklenmiştir.</div>
<img src="${esc(photoUrl)}" alt="Taşeron listesi">
<div class="foot">İç kayıt · alış fiyatları ve kâr oranı içerir, dışarıya verilmez.</div></div>`
    : null;
  return doc(
    `${h.bill_no ?? "Hakediş"} · taşeron kaydı`,
    page2 ? [page1, page2] : [page1],
  );
}

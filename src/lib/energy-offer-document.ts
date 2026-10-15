// Müşteriye verilecek teklif dosyası (HTML -> yazdır / PDF).
//
// NES'in kendi tekliflerindeki iki düzen birebir izlenir:
//  1) GES içeren teklifler: "Fotovoltaik güneş enerjisinden elektrik üretim,
//     mühendislik ve kurulum fiyat teklifi" sunum dosyası (DG Otomotiv ve
//     B. Kolkesen teklifleri): kapak, proje/sistem özeti, teklifin konusu ve iş
//     akışı, hizmet kapsamı, donanımlar, proje süreci, fiyat ve ödeme.
//  2) Yalnız şarj / taahhüt teklifleri: logolu "TEKLİF" formu (SEMU, DG Otomotiv
//     şarj, Gürkan Demiröz teklifleri): kalem tablosu, ara toplam / KDV / genel
//     toplam ve gerekirse ikinci sayfada "Teklif ve teknik şartname".

import {
  formatKwp,
  gesBatteryKwh,
  gesCapacityKwp,
  gesInverterKw,
  type CatalogItem,
  type Currency,
  type ExchangeRates,
  type GesConfig,
  type OfferModule,
  type PaymentStep,
  type PricedLine,
  type SarjConfig,
} from "@/lib/energy-offer";

export const NES_COMPANY = {
  brand: "NES Enerji",
  legalName:
    "Nes Teknik Enerji Mühendislik İnşaat Sanayi ve Ticaret Limited Şirketi",
  legalNameUpper:
    "NES TEKNİK ENERJİ MÜHENDİSLİK İNŞAAT SANAYİ VE TİCARET LİMİTED ŞİRKETİ",
  addressUpper: "ORHANİYE MAHALLESİ 12 NOLU SOKAK NUR APARTMANI NO:6 C",
  cityUpper: "MUĞLA / Menteşe",
  footerLine: "0 554 610 24 16 | ORHANİYE MAH. 12 NOLU SK. NO:6C MENTEŞE/MUĞLA",
  address: "Orhaniye Mah. 12 Nolu Sk. Nur Apt. No:6/C Menteşe / Muğla",
  phone: "0 554 610 24 16",
  phoneCompact: "05546102416",
  taxOffice: "MUĞLA VERGİ DAİRESİ",
  taxNo: "6312027568",
  email: "info@nesgrup.com",
  bank: "Akbank",
  bankAccountName: "Nes Teknik Enerji Mühendislik İnş. San. ve Tic. Ltd. Şti.",
  iban: "TR21 0004 6001 2888 8000 3242 29",
  logoPath: "/nes-enerji-logo.png",
  assetsPath: "/offer-assets",
};

export type OfferDocumentInput = {
  offerNo: string;
  issueDate: Date;
  validUntil: string | null;
  title: string;
  recipientName: string;
  contactName: string;
  /** Müşteri adresi (kayıtlı müşteride fatura adresi). */
  recipientAddress?: string;
  location: string;
  currency: Currency;
  vatRate: number;
  rates: ExchangeRates;
  ges: GesConfig;
  sarj: SarjConfig;
  catalog: CatalogItem[];
  lines: PricedLine[];
  sale: number;
  vat: number;
  grandTotal: number;
  paymentPlan: PaymentStep[];
  terms: string;
  /** GES sunum dosyasına kalem bazında fiyat listesini ek sayfa olarak koy. */
  showLinePrices: boolean;
  specificYield: number;
  /** Uygulamanın kök adresi (logo ve görseller için), ör. https://app.nesgrup.com */
  origin: string;
};

const esc = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const num = (value: number, digits = 2) =>
  new Intl.NumberFormat("tr-TR", { maximumFractionDigits: digits }).format(
    value,
  );

const money = (value: number, currency: Currency) => {
  const formatted = new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
  return currency === "TRY" ? `${formatted} ₺` : `${formatted} ${currency}`;
};

const dateDots = (value: Date) =>
  `${String(value.getDate()).padStart(2, "0")}.${String(value.getMonth() + 1).padStart(2, "0")}.${value.getFullYear()}`;

const dateLong = (value: Date | string | null) =>
  value
    ? new Date(value).toLocaleDateString("tr-TR", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "-";

const upperTr = (value: string) => value.toLocaleUpperCase("tr-TR");

const unitLabel = (unit: string) => {
  const map: Record<string, string> = {
    adet: "Adet",
    "ad.": "Adet",
    m: "Metre",
    set: "Set",
    paket: "Paket",
    kg: "Kg",
    boy: "Boy",
  };
  return map[unit] ?? unit;
};

// ---------------------------------------------------------------- GES sabit metinleri
const gesScope: [string, boolean][] = [
  ["Keşif Yapılması", true],
  ["Bağlantı Çağrı Dosyası Mektubunun Hazırlanması & Başvuru ve Takibi", true],
  ["Statik Hesapların Yapılıp Projenin Hazırlanması", true],
  ["GES Uygunluk Yazısının Alınması", true],
  ["TEDAŞ Elektrik Projelerinin Hazırlanması", true],
  ["GES Statik Projesinin Üniversiteye Onaylatılması", true],
  ["Tek Hat Şemasının Hazırlanması", true],
  ["Yerleşim Planı Hazırlanması", true],
  ["Topraklama Projelerinin Hazırlanması", true],
  ["Projelerin Onaylatılması", true],
  ["Bağlantı Anlaşması Başvurusunda Bulunulması", true],
  ["GES Kullanım Anlaşması Başvurusunda Bulunulması ve İmzalanması", true],
  [
    "GES İçin İtfaiye Uygunluk Yazısının Hazırlanıp Başvurulması ve Takibi",
    true,
  ],
  ["GES'e ait Ürünlerin Tedarik ve Montajı", true],
  ["Online İzleme Sistemi Kurulması", true],
  ["Kamu Harçlarının Ödenmesi", false],
  ["İtfaiye Görüşü Sonrası GES Harici Talep Edilebilecek Düzeltmeler", false],
  ["Yangın önleme ve söndürme teçhizatının temini", false],
  ["Talep Edilebilecek Bağış, Yardım ve Ödemeler", false],
];

const sarjScope: [string, boolean][] = [
  ["Şarj İstasyonunun Tedarik ve Montajı", true],
  ["Besleme Kablosu, Boru ve Bağlantı Malzemelerinin Tedarik ve Montajı", true],
  ["Kaçak Akım ve Aşırı Akım Korumalı Şarj Panosunun Kurulması", true],
  ["Test, Devreye Alma ve Kullanım Eğitimi", true],
  ["Bağlantı Gücü Artışı İçin EDAŞ Başvuru Bedelleri", false],
  ["Kazı, Beton, Asfalt Gibi İnşai İşler", false],
];

const gesProcess: [string, string[]][] = [
  [
    "1.AY",
    [
      "Teklif ve Sözleşme İmzalanması",
      "Gerekli Evrakların Talebi",
      "Noter Onaylı Vekaletname",
      "Elektrik Dağıtım Şirketine Başvuru",
    ],
  ],
  [
    "2.-3. AY",
    [
      "Çağrı Mektubunun Alınması",
      "Elektrik Statik Projelerinin Hazırlanması",
      "Projelerin Onaylatılması",
      "Montaj ve Kurulum",
    ],
  ],
  [
    "4.-5. AY",
    [
      "Bağlantı Anlaşmasının Yapılması",
      "Çift Yönlü Sayaç Değişikliği",
      "Ön Kabul İşlemlerinin Yapılması",
      "Geçici Kabul",
      "Sistem Kullanım Anlaşmasının Yapılması",
    ],
  ],
];

const plugIcon = `<svg viewBox="0 0 120 120" width="100" height="100" fill="none" stroke="#5f7474" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><rect x="30" y="12" width="46" height="72" rx="8"/><rect x="40" y="24" width="26" height="16" rx="3"/><path d="M53 50l-6 12h12l-6 12"/><path d="M76 40h10a8 8 0 0 1 8 8v40a10 10 0 0 1-20 0V84"/><path d="M42 84v20M64 84v20"/></svg>`;

// ---------------------------------------------------------------- GES stili
const gesCss = `
@page{size:A4;margin:0}
*{box-sizing:border-box}
:root{--sage:#829797;--sage-dark:#5f7474;--mist:#dfe9ea;--mist2:#d3e1e2;--ink:#1f2324}
html,body{margin:0;padding:0;background:#e6eaeb}
body{font-family:"Raleway",Arial,sans-serif;color:var(--ink);font-size:10pt;line-height:1.55;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:210mm;height:297mm;margin:10mm auto;background:#fff;position:relative;overflow:hidden;break-after:page;page-break-after:always}
.page:last-child{break-after:auto;page-break-after:auto}
@media print{html,body{background:#fff}.page{margin:0}}
@media screen{.page{box-shadow:0 6px 30px rgba(20,40,40,.15)}}
.band{position:absolute;left:0;right:0;bottom:0;height:13mm;background:var(--sage);color:#fff;display:flex;align-items:center;justify-content:center;font-family:"Ubuntu",Arial,sans-serif;font-weight:700;font-size:8pt;letter-spacing:.04em}
.body{padding:16mm 15mm 22mm}
.h{font-family:"Raleway",Arial,sans-serif;font-weight:700;letter-spacing:.16em;text-transform:uppercase;font-size:13pt;margin:0 0 4mm}
.sub{font-size:8.5pt;color:#333;margin:-2mm 0 5mm}
p{margin:0 0 4mm;text-align:justify}
.grid-table{width:100%;border-collapse:collapse;font-family:"Ubuntu",Arial,sans-serif}
.grid-table th,.grid-table td{border:1.4px solid #222;padding:2.4mm 3mm;font-size:8.5pt;vertical-align:middle}
.grid-table th{font-weight:700;text-align:center;letter-spacing:.02em}
.grid-table td.c{text-align:center}
.grid-table.tight td{padding:1.5mm 3mm;font-size:8pt}
.grid-table td.r{text-align:right;white-space:nowrap}
/* kapak */
.cv-top{display:grid;grid-template-columns:1fr 1fr;height:96mm}
.cv-left{padding:9mm 9mm 0 9mm}
.cv-kicker{font-weight:400;letter-spacing:.2em;text-transform:uppercase;font-size:11.5pt;line-height:1.5}
.cv-title{font-weight:800;letter-spacing:.22em;font-size:25pt;line-height:1.3;margin-top:3mm}
.cv-right{background:var(--mist);display:flex;align-items:center;justify-content:center}
.cv-right img{width:52mm;opacity:.95}
.cv-photo{position:absolute;left:0;right:0;top:96mm;bottom:0;background-size:cover;background-position:center}
.cv-label{position:absolute;right:0;top:96mm;width:105mm;height:30mm;background:var(--mist);display:flex;flex-direction:column;justify-content:center;align-items:center}
.cv-label b{font-family:"Ubuntu",Arial,sans-serif;font-size:19pt;letter-spacing:.42em;color:#2d3434;font-weight:700}
.cv-label span{font-family:"Ubuntu",Arial,sans-serif;font-size:11pt;letter-spacing:.55em;color:#2d3434;font-weight:700}
/* proje sayfası */
.pj{display:grid;grid-template-columns:1fr 92mm;height:150mm}
.pj-left{padding:12mm 9mm 0 12mm}
.pj-title{font-weight:800;letter-spacing:.18em;font-size:21pt;line-height:1.3;margin:0 0 6mm}
.pj-cust{font-family:"Ubuntu",Arial,sans-serif;font-weight:700;font-size:9pt;letter-spacing:.04em}
.pj-addr{letter-spacing:.08em;font-size:9.5pt;margin-top:1mm}
.pj-bar{height:3.5mm;background:var(--mist2);margin:6mm -9mm 6mm -12mm}
.pj-photo{background-size:cover;background-position:center}
.pj-intro{font-size:9.5pt;line-height:1.6}
.pj-intro p{text-align:left;margin:0 0 3mm}
.summary{padding:0 12mm}
/* donanımlar */
.hw{display:grid;grid-template-columns:1fr 1fr;gap:6mm 10mm}
.hw.three{grid-template-columns:1fr 1fr 1fr}
.hw.four{grid-template-columns:1fr 1fr 1fr 1fr;gap:6mm 5mm}
.hw.four span{max-width:42mm}
.hw div{text-align:center}
.hw .img{height:34mm;display:flex;align-items:center;justify-content:center;margin-bottom:3mm}
.hw .img img{max-height:34mm;max-width:58mm;object-fit:contain}
.hw b{display:block;font-family:"Ubuntu",Arial,sans-serif;font-size:8.5pt;letter-spacing:.04em;margin-bottom:1mm}
.hw span{display:block;font-size:8pt;line-height:1.5;text-align:left;max-width:58mm;margin:0 auto}
/* süreç */
.proc td:first-child{width:38mm;font-family:"Raleway",Arial,sans-serif;font-weight:700;font-size:12pt;letter-spacing:.12em;padding-left:6mm}
.proc td{font-size:10pt;line-height:1.75;padding:4mm 5mm}
/* fiyat */
.price-title{font-weight:400;letter-spacing:.14em;font-size:13pt;margin:6mm 0 4mm;text-transform:uppercase}
.details{font-size:7.5pt;line-height:1.55;font-family:"Ubuntu",Arial,sans-serif}
.details p{margin:0 0 1mm;text-align:left}
`;

// ---------------------------------------------------------------- form stili
// Sayfa iskeleti (form tek başına kullanıldığında).
const formBaseCss = `
@page{size:A4;margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#e6eaeb}
body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:210mm;height:297mm;margin:10mm auto;background:#fff;position:relative;overflow:hidden;break-after:page;page-break-after:always}
.page:last-child{break-after:auto;page-break-after:auto}
@media print{html,body{background:#fff}.page{margin:0}}
@media screen{.page{box-shadow:0 6px 30px rgba(20,40,40,.15)}}
`;

// Form sayfalarının kendi stili; GES dosyasına ek olarak da eklenebilsin diye
// yalnız .form altında geçerlidir.
const formCss = `
.page.form{padding:14mm 12mm 18mm;font-family:"Montserrat",Arial,sans-serif;color:#333;font-size:8pt;line-height:1.35}
.form .top{display:grid;grid-template-columns:1fr 64mm;gap:10mm}
.form .top img{height:13mm}
.form .co{margin-top:6mm;font-weight:700;font-size:7.5pt;line-height:1.5;color:#222}
.form .co .n{font-weight:400}
.form .co p{margin:0 0 3mm}
.form .tk{font-family:"Montserrat",Arial,sans-serif;font-weight:900;font-size:17pt;text-align:right;color:#444;letter-spacing:.02em}
.form .tk-rule{border-top:2px solid #444;margin:5mm 0 3mm}
.form .lbl{font-weight:700;font-size:7.5pt;color:#222}
.form .cust{padding-bottom:2mm;border-bottom:1px solid #ccc;margin-bottom:3mm;font-size:7.5pt;line-height:1.45}
.form .dt{display:flex;justify-content:space-between;padding:2mm 0;border-bottom:1px solid #ccc;font-size:7.5pt}
.form .items{width:100%;border-collapse:collapse;margin-top:22mm}
.form .items th{font-weight:700;font-size:7.5pt;color:#222;text-align:left;padding:2mm 1.5mm;border-bottom:1px solid #999}
.form .items td{font-family:"Roboto Mono",monospace;font-size:7pt;padding:2.2mm 1.5mm;vertical-align:top;text-transform:uppercase;color:#333}
.form .items .r{text-align:right;white-space:nowrap}
.form .items tbody tr:first-child td{padding-top:5mm}
.form .line{border-top:1px solid #999;margin-top:6mm}
.form .totals{width:64mm;margin-left:auto;margin-top:4mm}
.form .totals div{display:flex;justify-content:space-between;padding:1.6mm 0;font-size:7.5pt}
.form .totals b{color:#222}
.form .totals span{font-family:"Roboto Mono",monospace}
.form .foot{position:absolute;left:12mm;right:12mm;bottom:9mm;display:flex;justify-content:space-between;font-size:6.5pt;color:#777;border-top:1px solid #bbb;padding-top:3mm}
.form .foot b{color:#333}
.form .spec{font-size:7.5pt;line-height:1.55;color:#333;width:120mm}
.form .spec h3{font-size:7.5pt;font-weight:600;margin:4mm 0 1mm;text-transform:uppercase}
.form .spec p{margin:0 0 1mm}
.form .spec-wrap{display:grid;grid-template-columns:1fr 60mm;gap:8mm}
`;

function fontLinks(families: string) {
  return `<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?${families}&display=swap" rel="stylesheet">`;
}

// ---------------------------------------------------------------- yardımcılar
type Ctx = {
  input: OfferDocumentInput;
  visible: PricedLine[];
  hasGes: boolean;
  hasSarj: boolean;
  hasTaahhut: boolean;
  kwp: number;
  acKw: number;
  batteryKwh: number;
  panel?: CatalogItem;
  inverter?: CatalogItem;
  battery?: CatalogItem;
  station?: CatalogItem;
  asset: (name: string) => string;
  logo: string;
};

function context(input: OfferDocumentInput): Ctx {
  const { ges, sarj, catalog } = input;
  const visible = input.lines.filter((line) => line.visibleToCustomer);
  const hasGes = ges.enabled && visible.some((line) => line.module === "ges");
  const hasSarj =
    sarj.enabled && visible.some((line) => line.module === "sarj");
  return {
    input,
    visible,
    hasGes,
    hasSarj,
    hasTaahhut: visible.some((line) => line.module === "taahhut"),
    kwp: hasGes ? gesCapacityKwp(ges, catalog) : 0,
    acKw: hasGes ? gesInverterKw(ges, catalog) : 0,
    batteryKwh: hasGes ? gesBatteryKwh(ges, catalog) : 0,
    panel: catalog.find((item) => item.id === ges.panelId),
    inverter: catalog.find((item) => item.id === ges.inverterId),
    battery: catalog.find((item) => item.id === ges.batteryId),
    station: catalog.find((item) => item.id === sarj.stationId),
    asset: (name) => `${input.origin}${NES_COMPANY.assetsPath}/${name}`,
    logo: `${input.origin}${NES_COMPANY.logoPath}`,
  };
}

function moduleTotal(ctx: Ctx, module: OfferModule) {
  return ctx.visible
    .filter((line) => line.module === module)
    .reduce((sum, line) => sum + line.saleAmount, 0);
}

function systemDetail(ctx: Ctx) {
  const parts = [
    ctx.input.ges.systemType === "hibrit"
      ? "Şebekeye Bağlı (hibrit)"
      : "Şebekeye Bağlı",
    "Mahsuplaşmalı",
  ];
  if (ctx.batteryKwh > 0) parts.push("Depolamalı");
  return parts.join(", ");
}

function termLines(input: OfferDocumentInput) {
  return input.terms
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function paymentRows(input: OfferDocumentInput) {
  return input.paymentPlan.map((step, index) => ({
    label: `${index + 1}. ÖDEME - ${upperTr(step.label)}`,
    percent: step.percent,
    amount: (input.grandTotal * step.percent) / 100,
  }));
}

// ---------------------------------------------------------------- GES sunum dosyası
function band() {
  return `<div class="band">${esc(NES_COMPANY.footerLine)}</div>`;
}

function buildGesPresentation(ctx: Ctx): string {
  const { input } = ctx;
  const { ges, sarj } = input;
  const pages: string[] = [];
  const projectTitle =
    ges.roofType === "arazi"
      ? "ARAZİ GES<br>PROJESİ"
      : "ÇATI ÜSTÜ<br>GES PROJESİ";
  const kwpText = `${formatKwp(ctx.kwp)}kWp`;

  // 1) Kapak
  pages.push(`<section class="page">
<div class="cv-top"><div class="cv-left"><div class="cv-kicker">Fotovoltaik güneş<br>enerjisinden<br>elektrik<br>üretim, mühendislik<br>ve kurulum</div><div class="cv-title">FİYAT<br>TEKLİFİ</div>
<svg width="64" height="40" viewBox="0 0 64 40" fill="none" stroke="#222" stroke-width="2" style="margin-top:4mm"><path d="M2 2h40v24H18l-8 8v-8H2z"/><path d="M42 12h20v20h-6v6l-6-6H22v-6"/><path d="M9 10h26M9 17h20"/></svg></div>
<div class="cv-right"><img src="${esc(ctx.asset("nes-mark-white.png"))}" alt=""></div></div>
<div class="cv-photo" style="background-image:url('${esc(ctx.asset("kapak-ev.jpg"))}')"></div>
<div class="cv-label"><b>NESENERJİ</b><span>MÜHENDİSLİK</span></div>
</section>`);

  // 2) Proje, giriş ve sistem özeti
  const summaryCols: [string, string][] = [
    ["DC GÜÇ", `${formatKwp(ctx.kwp)} kWp`],
    ["AC GÜÇ", `${formatKwp(ctx.acKw)} kWe`],
  ];
  if (ctx.batteryKwh > 0) {
    summaryCols.push(["DEPOLAMA", `${formatKwp(ctx.batteryKwh)} kWh`]);
  }
  if (ctx.hasSarj) {
    summaryCols.push([
      "EV ŞARJ",
      `${sarj.stationCount} x ${formatKwp(Number(ctx.station?.power_kw ?? 0))} kW`,
    ]);
  }
  summaryCols.push(["DETAY", systemDetail(ctx)]);
  pages.push(`<section class="page">
<div class="pj"><div class="pj-left"><div class="pj-title">${projectTitle}</div>
<div class="pj-cust">${esc(upperTr(input.recipientName || "-"))}</div>
${input.contactName ? `<div class="pj-addr">${esc(input.contactName)}</div>` : ""}
${input.recipientAddress ? `<div class="pj-addr">${esc(input.recipientAddress)}</div>` : ""}
${input.location ? `<div class="pj-addr">${esc(input.location)}</div>` : ""}
<div class="pj-addr">${dateDots(input.issueDate)}</div>
<div class="pj-bar"></div>
<div class="pj-intro"><p>Firmamıza göstermiş olduğunuz ilgiye teşekkür ederiz.</p>
<p>Talep ettiğiniz Güneş Enerji Santrali${ctx.hasSarj ? " ve Elektrikli Araç Şarj Sistemi" : ""} Anahtar Teslimi Projelendirilme ve Kurulumu İşleri'ne ait teklifimiz ile ilgili detaylar aşağıda bilgilerinize sunulmuştur.</p>
<p>Teklifimizin uygun görüleceğini ve birlikte çalışma imkânı bulacağımızı ümit eder, konu ile ilgili her türlü sorunuzu yanıtlamaya hazır olduğumuzu bilgilerinize sunarız.</p>
<p style="margin-top:5mm">Saygılarımızla,</p></div></div>
<div class="pj-photo" style="background-image:url('${esc(ctx.asset("kapak-ev-2.jpg"))}')"></div></div>
<div class="summary"><div class="h" style="margin-top:12mm">Sistem Özeti</div>
<table class="grid-table"><thead><tr>${summaryCols.map(([label]) => `<th>${esc(label)}</th>`).join("")}</tr></thead>
<tbody><tr>${summaryCols.map(([, value]) => `<td class="c">${esc(value)}</td>`).join("")}</tr></tbody></table></div>
${band()}</section>`);

  // 3) Teklifin konusu ve iş akışı
  pages.push(`<section class="page"><div class="body">
<div class="h">Teklifin konusu, taraflar ve şartlar</div>
<p>İş bu “mühendislik, ürün tedarik ve kurulum” teklifi, ${esc(kwpText)} güçte fotovoltaik güneş enerjisine dayalı ${ges.roofType === "arazi" ? "arazi/teras" : "çatı"} uygulamalı elektrik üretim tesisinin (GES)${ctx.hasSarj ? " ve elektrikli araç şarj sisteminin" : ""} projelendirme, ürün tedarik, kurulum, test, devreye alma ve geçici hizmetlerinin <b>${esc(NES_COMPANY.legalName)}</b> tarafından gerçekleştirilmesine dair iş ve işlemlerin sunulması amacıyla hazırlanmıştır.</p>
<p>Teklifin amacı ve konusu, söz konusu tesisin mühendislik, ürün tedarik, kurulum, test, devreye alma ve geçici kabul işlemlerinin gerçekleştirilerek, tesisin hatasız ve eksiksiz olarak, faal durumda, tarafınıza sözleşme süresi içinde şirketimiz tarafından teslim edilmesidir. Fotovoltaik modüllerin montajının yapılacağı çatı ve cephe alanlarının, uygulama öncesi montaja uygun hale getirilmiş ve tam izolasyona sahip olması gerekmektedir.</p>
<div class="h" style="margin-top:12mm">İş akışı</div>
<p>Güneş enerjisi santralinde kullanılacak tüm ana ve yardımcı teçhizat, elektrik piyasası güncel mevzuat hükümlerine ve TEDAŞ şartnamelerine uyumlu olacaktır. GES’in lisanssız üretim kapsamında aylık mahsuplaşma uygulamasına dahil edilmesi durumuna hazırlık olarak, GES bir bütün olarak projelendirmeye ve izin sürecine hazır halde kurulacaktır.</p>
<p>Santralde kullanılacak fotovoltaik modüller, alüminyum sabitleme elemanları ile ${ges.roofType === "arazi" ? "zemine" : "çatı zeminine"} uygun açıda konumlanacak şekilde sabitlenecektir. Santralin kurulacağı alanda fotovoltaik panellerin kabloları ve konstrüksiyon sisteminden kaynaklı herhangi bir görüntü kirliliği ortaya çıkmayacaktır.</p>
${ctx.batteryKwh > 0 ? `<p>Sistem, ${esc(formatKwp(ctx.batteryKwh))} kWh lityum batarya ile birlikte hibrit olarak kurulacak; gün içinde üretilen enerji önce tesisin ihtiyacını karşılayacak, fazlası bataryada depolanacak ve şebeke kesintilerinde yedeklenen yükler bataryadan beslenmeye devam edecektir.</p>` : ""}
${ctx.hasSarj ? `<p>Elektrikli araç şarj sistemi; ${sarj.stationCount} adet ${esc(`${ctx.station?.brand ?? ""} ${formatKwp(Number(ctx.station?.power_kw ?? 0))} kW`.trim())} şarj istasyonu, ${sarj.phase === "trifaze" ? "trifaze" : "monofaze"} besleme hattı ve kaçak akım / aşırı akım korumalı şarj panosu ile anahtar teslim kurulacaktır.</p>` : ""}
<p>Tesisin, mühendislik, ürün tedarik, kurulum, test, devreye alma ve geçici kabul işlemlerinin gerçekleştirilmesi tümüyle şirketimiz sorumluluğundadır. Şirketimiz, tesisin kurulumu ve işletilmesinde kullanılacak tüm araç, makine ve teçhizatın temin edilmesi, sahaya getirilmesi ve bunların montajının nitelikli personel tarafından gerçekleştirilmesini sağlayacaktır.</p>
</div>${band()}</section>`);

  // 4) Hizmet kapsamı
  const scope = [...gesScope, ...(ctx.hasSarj ? sarjScope : [])];
  pages.push(`<section class="page"><div class="body">
<div class="h">Hizmet kapsamı</div>
<div class="sub">(Hizmet Kapsamı Şebekeye bağlı Mahsuplaşmalı sistemler için geçerlidir. Öztüketim ve Off Grid Sistemlerde proje bulunmadığı için teklife dahil değildir.)</div>
<table class="grid-table${scope.length > 20 ? " tight" : ""}"><thead><tr><th>KAPSAM</th><th style="width:22mm">DAHİL</th><th style="width:22mm">HARİÇ</th></tr></thead><tbody>
${scope.map(([text, included]) => `<tr><td>${esc(text)}</td><td class="c">${included ? "X" : ""}</td><td class="c">${included ? "" : "X"}</td></tr>`).join("")}
</tbody></table></div>${band()}</section>`);

  // 5) Donanımlar
  const cards: [string, string, string[]][] = [];
  if (ctx.panel) {
    cards.push([
      ctx.asset("panel.png"),
      "PANEL",
      [
        `${ges.panelCount} Adet ${[ctx.panel.brand, `${num(Number(ctx.panel.power_w ?? 0), 0)} Wp`].filter(Boolean).join(" ")} ${/topcon/i.test(`${ctx.panel.name} ${ctx.panel.model ?? ""}`) ? "top-con " : ""}monokristalin panel`,
        "Garanti Süresi: 10 yıl",
        "25 yıl performans garantisi",
      ],
    ]);
  }
  if (ctx.inverter) {
    cards.push([
      ctx.asset("inverter.jpg"),
      "İNVERTER",
      [
        `Solar inverter - ${upperTr(ctx.inverter.brand ?? "")}`.trim(),
        `${/HV/.test(`${ctx.inverter.code} ${ctx.inverter.model ?? ""}`) ? "HV " : /LV/.test(`${ctx.inverter.code} ${ctx.inverter.model ?? ""}`) ? "LV " : ""}${ctx.inverter.phase === "mono" ? "Monofaze" : "Trifaze"} ${ges.systemType === "hibrit" ? "Hibrit" : "On-Grid"}`,
        `${ges.inverterCount > 1 ? `${ges.inverterCount} x ` : ""}${formatKwp(Number(ctx.inverter.power_kw ?? 0))}kwe`,
        "Garanti Süresi: 10 yıl",
      ],
    ]);
  }
  cards.push([
    ctx.asset("konstruksiyon.png"),
    "TAŞIYICI KONSTRUKSİYON",
    [
      ges.roofType === "kiremit"
        ? "Kiremit çatıya uygun alüminyum taşıyıcı"
        : "Alüminyum taşıyıcı sistem",
      "Kablo Taşıma Malzemeleri",
      "Profesyonel Kablo Tavaları ve Aksesuarları",
    ],
  ]);
  cards.push([
    ctx.asset("kablo.png"),
    "AC-DC VE TOPRAKLAMA KABLOLARI",
    ["N2HX Alev İletmeyen Bakır Kablolar", "Solar DC kablo 1x6 mm² PV1-F"],
  ]);
  const second: [string, string, string[]][] = [];
  if (ctx.battery && ctx.batteryKwh > 0) {
    second.push([
      ctx.asset("batarya.jpg"),
      "LİTYUM PİL",
      [
        upperTr(`${ctx.battery.brand ?? ""} ${ctx.battery.model ?? ""}`.trim()),
        `${formatKwp(Number(ctx.battery.capacity_kwh ?? 0))}KW X ${ges.batteryCount} ADET`,
        `${formatKwp(ctx.batteryKwh)}KW`,
      ],
    ]);
  }
  second.push([
    ctx.asset("konnektor.png"),
    "KONNEKTÖRLER",
    ["Paneller ile uyumlu Solar Konnektörler"],
  ]);
  second.push([
    ctx.asset("pano.png"),
    "GES PANOSU",
    ["TEDAŞ şartnamelerine uyumlu GES ACP"],
  ]);
  if (ctx.hasSarj && ctx.station) {
    second.push([
      "",
      "EV ŞARJ İSTASYONU",
      [
        `${sarj.stationCount} Adet ${ctx.station.brand ?? ""} ${formatKwp(Number(ctx.station.power_kw ?? 0))} kW`,
        sarj.phase === "trifaze"
          ? "Trifaze, 5x6 mm² besleme"
          : "Monofaze, 3x6 mm² besleme",
        sarj.withStand ? "Ayaklı (stand) montaj" : "Duvar tipi montaj",
      ],
    ]);
  }
  const card = ([img, title, lines]: [string, string, string[]]) =>
    `<div><div class="img">${img ? `<img src="${esc(img)}" alt="">` : plugIcon}</div><b>${esc(title)}</b><span>${lines.map(esc).join("<br>")}</span></div>`;
  pages.push(`<section class="page"><div class="body">
<div class="h">Donanımlar</div>
<div class="sub">Sisteminiz, ihtiyacınıza uygun konfigürasyon ile maksimum verimlilikte çalışması için tasarlanmıştır. Aşağıda sistem ana bileşenlerinin bir listesini yaptık.</div>
<div class="hw">${cards.map(card).join("")}</div>
<div class="hw ${second.length > 3 ? "four" : "three"}" style="margin-top:8mm">${second.map(card).join("")}</div>
</div>${band()}</section>`);

  // 6) Proje süreci
  pages.push(`<section class="page"><div class="body">
<div class="h">Proje süreci</div>
<div class="sub">(Şebekeye bağlı Mahsuplaşmalı sistemler için geçerlidir. Öztüketim ve Off Grid Sistemlerde proje bulunmadığı için teklife dahil değildir.)</div>
<table class="grid-table proc" style="margin-top:8mm"><tbody>
${gesProcess.map(([when, items]) => `<tr><td>${esc(when)}</td><td>${items.map(esc).join("<br>")}</td></tr>`).join("")}
</tbody></table></div>${band()}</section>`);

  // 7) Fiyat
  const priceRows: [string, string, number][] = [];
  const gesTotal = moduleTotal(ctx, "ges");
  if (gesTotal > 0) {
    priceRows.push([
      `${formatKwp(ctx.kwp)} kWp GES Sistemi${ctx.batteryKwh > 0 ? ` (${formatKwp(ctx.batteryKwh)} kWh depolamalı)` : ""}`,
      "1 Adet",
      gesTotal,
    ]);
  }
  const sarjTotal = moduleTotal(ctx, "sarj");
  if (sarjTotal > 0) {
    priceRows.push([
      `EV Şarj Sistemi (${formatKwp(Number(ctx.station?.power_kw ?? 0))} kW, montaj dahil)`,
      `${sarj.stationCount} Adet`,
      sarjTotal,
    ]);
  }
  const taahhutTotal = moduleTotal(ctx, "taahhut");
  if (taahhutTotal > 0)
    priceRows.push(["Elektrik Taahhüt İşleri", "1 Set", taahhutTotal]);
  const otherTotal = moduleTotal(ctx, "genel");
  if (otherTotal > 0) priceRows.push(["Diğer İşler", "1 Set", otherTotal]);
  const cur = input.currency;
  const curName = cur === "TRY" ? "TL" : cur;
  pages.push(`<section class="page"><div class="body">
<div class="h">Ödenene değer fiyat teklifimiz</div>
<div class="price-title">Anahtar teslim fiyat</div>
<table class="grid-table"><thead><tr><th style="text-align:left">AÇIKLAMA</th><th style="width:30mm">BİRİM</th><th style="width:42mm">TUTAR</th></tr></thead><tbody>
${priceRows.map(([label, unit, total]) => `<tr><td>${esc(label)}</td><td class="c">${esc(unit)}</td><td class="c">${money(total, cur)}</td></tr>`).join("")}
<tr><td>KDV (%${num(input.vatRate * 100)})</td><td class="c"></td><td class="c">${money(input.vat, cur)}</td></tr>
<tr><td><b>GENEL TOPLAM (KDV DAHİL)</b></td><td class="c"></td><td class="c"><b>${money(input.grandTotal, cur)}</b></td></tr>
</tbody></table>
${
  input.paymentPlan.length
    ? `<div class="price-title">Ödeme şekli</div><table class="grid-table"><thead><tr><th style="text-align:left">AÇIKLAMA</th><th style="width:26mm">YÜZDE</th><th style="width:42mm">TUTAR</th></tr></thead><tbody>
${paymentRows(input)
  .map(
    (row) =>
      `<tr><td style="font-size:7.5pt">${esc(row.label)}</td><td class="c">%${num(row.percent)}</td><td class="c">${money(row.amount, cur)}</td></tr>`,
  )
  .join("")}</tbody></table>`
    : ""
}
<div class="price-title" style="margin-top:10mm">Teklif detayları</div>
<div class="details">
<p>Fiyatlarımız ${esc(curName)} cinsindendir; KDV ayrıca gösterilmiştir.</p>
<p>Teklifimiz ${esc(dateLong(input.validUntil))} tarihine kadar geçerlidir.</p>
${termLines(input)
  .map((line) => `<p>${esc(line)}</p>`)
  .join("")}
${input.rates.USD > 0 || input.rates.EUR > 0 ? `<p>Hesaplamada kullanılan kurlar: ${[input.rates.USD > 0 ? `1 USD = ${num(input.rates.USD, 4)} TL` : "", input.rates.EUR > 0 ? `1 EUR = ${num(input.rates.EUR, 4)} TL` : ""].filter(Boolean).join(", ")}.</p>` : ""}
<p>Banka Hesap Bilgileri : ${esc(NES_COMPANY.bankAccountName)}<br>${esc(NES_COMPANY.bank)}<br>TL IBAN : ${esc(NES_COMPANY.iban)}</p>
</div></div>${band()}</section>`);

  let html = pages.join("\n");
  if (input.showLinePrices) {
    // Ek: kalem bazında fiyat listesi, NES "TEKLİF" formu düzeninde.
    html += "\n" + formPages(ctx, { annex: true, withSpec: false }).join("\n");
  }
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${esc(input.offerNo)} — ${esc(input.title)}</title>
${fontLinks("family=Raleway:wght@400;700;800&family=Ubuntu:wght@400;700&family=Montserrat:wght@400;700;900&family=Roboto+Mono")}
<style>${gesCss}${input.showLinePrices ? formCss : ""}</style></head><body>${html}</body></html>`;
}

// ---------------------------------------------------------------- NES "TEKLİF" formu
type FormRow = {
  name: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  total: number;
};

/** NES formunda olduğu gibi kalemleri sadeleştirir: şarjda istasyon(lar) ayrı,
 * diğer şarj kalemleri "montaj, devreye alma ve sarf malzeme dahil" tek satır;
 * taahhütte kalemler olduğu gibi listelenir. */
function formRows(ctx: Ctx, detailed: boolean): FormRow[] {
  const rows: FormRow[] = [];
  const toRow = (line: PricedLine): FormRow => ({
    name: line.description,
    quantity: line.quantity,
    unit: unitLabel(line.unit),
    unitPrice: line.quantity > 0 ? line.saleAmount / line.quantity : 0,
    total: line.saleAmount,
  });
  for (const module of ["ges", "sarj", "taahhut", "genel"] as OfferModule[]) {
    const lines = ctx.visible.filter((line) => line.module === module);
    if (lines.length === 0) continue;
    if (detailed || module === "taahhut" || module === "genel") {
      rows.push(...lines.filter((line) => line.saleAmount > 0).map(toRow));
      continue;
    }
    if (module === "sarj") {
      const stations = lines.filter(
        (line) =>
          ctx.input.catalog.find((item) => item.id === line.catalogItemId)
            ?.template_role === "sarj_station",
      );
      rows.push(...stations.map(toRow));
      const rest = lines.filter((line) => !stations.includes(line));
      const restTotal = rest.reduce((sum, line) => sum + line.saleAmount, 0);
      if (restTotal > 0) {
        rows.push({
          name: "Montaj, devreye alma ve sarf malzeme dahil",
          quantity: 1,
          unit: "Adet",
          unitPrice: restTotal,
          total: restTotal,
        });
      }
    }
  }
  return rows;
}

function formPages(
  ctx: Ctx,
  options: { annex: boolean; withSpec: boolean },
): string[] {
  const { input } = ctx;
  const cur = input.currency;
  const rows = formRows(ctx, options.annex);
  const perPage = 20;
  const chunks: FormRow[][] = [];
  for (let i = 0; i < Math.max(rows.length, 1); i += perPage) {
    chunks.push(rows.slice(i, i + perPage));
  }
  const specLines = termLines(input);
  const pageCount = chunks.length + (options.withSpec ? 1 : 0);
  const sale = rows.reduce((sum, row) => sum + row.total, 0);
  const vat = sale * input.vatRate;
  const totalsHtml = `<div class="totals">
<div><b>ARA TOPLAM</b><span>${money(sale, cur)}</span></div>
<div><b>BRÜT TOPLAM</b><span>${money(sale, cur)}</span></div>
<div><b>TOPLAM K.D.V</b><span>${money(vat, cur)}</span></div>
<div><b>GENEL TOPLAM</b><span>${money(sale + vat, cur)}</span></div></div>`;
  const foot = (page: number) =>
    `<div class="foot"><span><b>${dateDots(input.issueDate)}</b> tarihinde hazırlanmıştır.</span><span><b>SAYFA ${page} / ${pageCount}</b></span></div>`;
  const head = `<div class="top"><div><img src="${esc(ctx.logo)}" alt="NES Enerji">
<div class="co"><p>${esc(NES_COMPANY.legalNameUpper)}<br>${esc(NES_COMPANY.addressUpper)}</p><p>${esc(NES_COMPANY.cityUpper)}<br><span class="n">${esc(NES_COMPANY.phoneCompact)}</span></p><p>VD: ${esc(NES_COMPANY.taxOffice)}<br><span class="n">${esc(NES_COMPANY.taxNo)}</span></p></div></div>
<div><div class="tk">${options.annex ? "FİYAT LİSTESİ" : "TEKLİF"}</div><div class="tk-rule"></div>
<div class="lbl">MÜŞTERİ</div><div class="cust">${esc(upperTr(input.recipientName || "-"))}${input.recipientAddress ? `<br>${esc(input.recipientAddress)}` : ""}${input.location ? `<br>${esc(input.location)}` : ""}</div>
<div class="dt"><span class="lbl">TEKLİF NO</span><span>${esc(input.offerNo)}</span></div>
<div class="dt"><span class="lbl">TEKLİF TARİHİ</span><span>${esc(dateLong(input.issueDate))}</span></div>
<div class="dt"><span class="lbl">GEÇERLİLİK</span><span>${esc(dateLong(input.validUntil))}</span></div></div></div>`;

  const pages = chunks.map((chunk, index) => {
    const last = index === chunks.length - 1;
    return `<section class="page form">${index === 0 ? head : ""}
<table class="items"${index === 0 ? "" : ' style="margin-top:0"'}><thead><tr><th>Hizmet / Ürün</th><th class="r">Miktar</th><th class="r">Br. Fiyat</th><th class="r">KDV</th><th class="r">Toplam</th></tr></thead><tbody>
${chunk.map((row) => `<tr><td style="width:46%">${esc(row.name)}</td><td class="r">${num(row.quantity)} ${esc(row.unit)}</td><td class="r">${money(row.unitPrice, cur)}</td><td class="r">%${num(input.vatRate * 100)}</td><td class="r">${money(row.total, cur)}</td></tr>`).join("")}
</tbody></table>${last ? `<div class="line"></div>${totalsHtml}` : ""}${foot(index + 1)}</section>`;
  });

  if (options.withSpec) {
    const payment = paymentRows(input);
    pages.push(`<section class="page form"><div class="spec-wrap"><div class="spec">
<p style="text-transform:uppercase">Teklif ve teknik şartname</p>
<p style="text-transform:uppercase">Proje adı: ${esc(input.title)}${input.location ? ` · ${esc(input.location)}` : ""}</p>
<h3>1. Kapsam</h3><p>${esc(input.title)} kapsamında tabloda belirtilen malzemelerin tedariki, montajı, test ve devreye alma işleri anahtar teslim olarak teklif edilmiştir.</p>
${payment.length ? `<h3>2. Ödeme şekli</h3>${payment.map((row) => `<p>• ${esc(row.label)}: %${num(row.percent)} (${money(row.amount, cur)})</p>`).join("")}` : ""}
<h3>${payment.length ? "3" : "2"}. Şartlar</h3>${specLines.map((line) => `<p>• ${esc(line)}</p>`).join("")}
<p>• İşbu teklif ${esc(dateLong(input.validUntil))} tarihine kadar geçerlidir.</p>
${input.rates.USD > 0 || input.rates.EUR > 0 ? `<p>• Hesaplamada kullanılan kurlar: ${[input.rates.USD > 0 ? `1 USD = ${num(input.rates.USD, 4)} TL` : "", input.rates.EUR > 0 ? `1 EUR = ${num(input.rates.EUR, 4)} TL` : ""].filter(Boolean).join(", ")}.</p>` : ""}
<h3>Banka bilgileri</h3><p>${esc(NES_COMPANY.bankAccountName)} · ${esc(NES_COMPANY.bank)}<br>TL IBAN: ${esc(NES_COMPANY.iban)}</p>
</div>${totalsHtml}</div>${foot(pageCount)}</section>`);
  }
  return pages;
}

function buildTeklifForm(ctx: Ctx): string {
  const pages = formPages(ctx, { annex: false, withSpec: true });
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${esc(ctx.input.offerNo)} — ${esc(ctx.input.title)}</title>
${fontLinks("family=Montserrat:wght@400;600;700;900&family=Roboto+Mono")}
<style>${formBaseCss}${formCss}</style></head><body>${pages.join("\n")}</body></html>`;
}

/** GES içeren teklif NES sunum dosyası, diğerleri NES "TEKLİF" formu olarak üretilir. */
export function buildOfferDocument(input: OfferDocumentInput): string {
  const ctx = context(input);
  return ctx.hasGes ? buildGesPresentation(ctx) : buildTeklifForm(ctx);
}

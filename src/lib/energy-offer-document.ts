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
  MONTH_LABELS,
} from "@/lib/energy-offer";
import { formatUsdPerWp, type FinanceResult } from "@/lib/energy-offer-finance";
import {
  LETTERHEAD_PAGE_CSS,
  NES_COMPANY,
  letterheadHtml,
} from "@/lib/nes-company";

// Şirket bilgileri ve antet tek kaynaktan gelir (src/lib/nes-company.ts).
export { NES_COMPANY };

/** Keşiften gelen tekliflerde "Saha keşfi" sayfası. Fotoğraflar belgeye
 * gömülür (data URL), belge saklandığında bağlantı süresi dolmaz. */
export type SiteSurveySection = {
  surveyNo: string;
  date: string;
  workType: string;
  location: string;
  photos: { url: string; caption: string | null }[];
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
  /** Tahmini üretim (aylık kWh); GES yoksa null. */
  production?: {
    annual: number;
    daily: number;
    monthly: number[];
    co2Tons: number;
  } | null;
  /** Geri dönüş hesabı; tüketim/tarife girilmediyse null. */
  finance?: FinanceResult | null;
  /** Fiyat sayfasında watt başı fiyat gösterilsin mi. */
  showPricePerWp?: boolean;
  /** GES satışının USD/Wp karşılığı (KDV hariç). */
  salePerWp?: number | null;
  rateSource?: "TCMB" | "manual";
  /** Çatı yerleşim planı (SVG) ve yüzey özeti. */
  layout?: {
    svg: string;
    faces: {
      name: string;
      panels: number;
      tilt: number;
      direction: string;
      areaM2: number;
    }[];
  } | null;
  /** Üretim tahmininin kaynağı, ör. "PVGIS (PVGIS-SARAH3), 37.2, 28.3". */
  productionSource?: string;
  tcmbDate?: string;
  /** Uygulamanın kök adresi (logo ve görseller için), ör. https://app.nesgrup.com */
  origin: string;
  /** Keşiften gelen teklifte saha fotoğrafları sayfası. */
  siteSurvey?: SiteSurveySection | null;
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
/* üretim ve kazanç */
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:4mm;margin:2mm 0 7mm}
.kpis div{background:var(--mist);padding:3.5mm 3mm;text-align:center}
.kpis small{display:block;font-family:"Ubuntu",Arial,sans-serif;font-size:7pt;letter-spacing:.08em;text-transform:uppercase;color:#4a5556}
.kpis b{display:block;font-family:"Ubuntu",Arial,sans-serif;font-size:13pt;margin-top:1mm}
.chart{width:100%;height:auto;display:block;margin-bottom:6mm}
.plan{border:1.4px solid #222;padding:4mm;height:150mm;display:flex;align-items:center;justify-content:center}
.plan svg{max-width:100%;max-height:100%}
.note{font-size:7.5pt;line-height:1.5;color:#444;font-family:"Ubuntu",Arial,sans-serif}
/* bir bakışta */
.ov-head{display:flex;justify-content:space-between;align-items:flex-end;gap:6mm;margin-bottom:6mm}
.ov-head .who{font-family:"Ubuntu",Arial,sans-serif;font-size:8.5pt;color:#4a5556;text-align:right;line-height:1.5}
.ov-head .who b{display:block;color:var(--ink);font-size:10pt;letter-spacing:.04em}
.ov-hero{display:grid;grid-template-columns:1fr 1fr;gap:4mm;margin-bottom:5mm}
.ov-hero div{border-radius:4mm;padding:5mm 6mm;color:#fff;background:var(--sage-dark)}
.ov-hero div.alt{background:var(--sage)}
.ov-hero small{display:block;font-family:"Ubuntu",Arial,sans-serif;font-size:7.5pt;letter-spacing:.12em;text-transform:uppercase;opacity:.85}
.ov-hero b{display:block;font-family:"Montserrat",Arial,sans-serif;font-weight:900;font-size:24pt;line-height:1.15;margin-top:1.5mm}
.ov-hero span{display:block;font-family:"Ubuntu",Arial,sans-serif;font-size:8pt;opacity:.9;margin-top:1mm}
.ov-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:3mm;margin-bottom:6mm}
.ov-kpis div{background:var(--mist);border-radius:3mm;padding:3.5mm 3.5mm 3mm}
.ov-kpis small{display:block;font-family:"Ubuntu",Arial,sans-serif;font-size:6.8pt;letter-spacing:.08em;text-transform:uppercase;color:#4a5556}
.ov-kpis b{display:block;font-family:"Montserrat",Arial,sans-serif;font-weight:700;font-size:12.5pt;margin-top:1mm;white-space:nowrap}
.ov-kpis span{display:block;font-family:"Ubuntu",Arial,sans-serif;font-size:7pt;color:#4a5556;margin-top:.5mm}
.ov-sec{font-family:"Raleway",Arial,sans-serif;font-weight:700;letter-spacing:.14em;text-transform:uppercase;font-size:9pt;margin:0 0 2.5mm;color:var(--sage-dark)}
.ov-flow{border:1px solid var(--mist2);border-radius:4mm;padding:3mm 4mm;margin-bottom:6mm}
.ov-flow svg{display:block;width:100%;height:auto;max-height:80mm;margin:0 auto}
.ov-pay{border:1px solid var(--mist2);border-radius:4mm;padding:4mm 5mm}
.ov-pay svg{display:block;width:100%;height:auto}
.ov-pay p{font-family:"Ubuntu",Arial,sans-serif;font-size:8pt;margin:2mm 0 0;text-align:left;color:#333}
/* NES antet: kapak dışındaki sayfalar */
.page.lh .body{padding:28mm 15mm 26mm}
.page.lh .pj{margin-top:25mm;height:140mm}
.page.lh .pj-photo{margin-right:15mm}
${LETTERHEAD_PAGE_CSS}
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
.form table.items tr.grp td{background:#eef3f5;font-weight:700;font-size:7pt;text-transform:uppercase;letter-spacing:.04em;color:#0b4ea2;padding-top:2mm}
.form table.icmal{width:100%;margin-top:6mm;border-collapse:collapse;font-size:7.5pt}
.form table.icmal th{text-align:left;border-bottom:1px solid #222;padding:1.2mm 0;font-weight:700}
.form table.icmal td{padding:1.2mm 0;border-bottom:1px solid #e4e7ea}
.form table.icmal .r{text-align:right;font-family:"Roboto Mono",monospace}
.form .approve{width:100%;margin-top:8mm;border:1px solid #bbb;border-radius:2mm;padding:3mm;font-size:7.5pt;line-height:1.9}
.form .approve p{margin:0}
.form .survey{padding-top:6mm}
.form .survey h3{font-size:9pt;margin:0 0 1mm}
.form .survey .sv-meta{font-size:7.5pt;color:#555;margin:0 0 4mm}
.form .survey .sv-grid{display:grid;grid-template-columns:1fr 1fr;gap:4mm}
.form .survey figure{margin:0}
.form .survey img{width:100%;height:62mm;object-fit:cover;border-radius:1.5mm;border:1px solid #ddd}
.form .survey figcaption{font-size:6.8pt;color:#555;margin-top:1mm}
.form .survey .sv-note{font-size:6.8pt;color:#777;margin-top:4mm}
.form .totals div{display:flex;justify-content:space-between;padding:1.6mm 0;font-size:7.5pt}
.form .totals b{color:#222}
.form .totals span{font-family:"Roboto Mono",monospace}
.form .foot{position:absolute;left:12mm;right:12mm;bottom:9mm;display:flex;justify-content:space-between;font-size:6.5pt;color:#777;border-top:1px solid #bbb;padding-top:3mm}
.form .foot b{color:#333}
.form .spec{font-size:7.5pt;line-height:1.55;color:#333;width:120mm}
.form .spec h3{font-size:7.5pt;font-weight:600;margin:4mm 0 1mm;text-transform:uppercase}
.form .spec p{margin:0 0 1mm}
.form .spec-wrap{display:grid;grid-template-columns:1fr 60mm;gap:8mm}
.page.form.lh{padding-bottom:26mm}
.page.form.lh.cont{padding-top:28mm}
.form .lh-foot .lh-left{max-width:45mm}
${LETTERHEAD_PAGE_CSS}
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
/** Kapak dışındaki sunum sayfalarına NES anteti (üst logo, filigran, alt bilgi). */
function band(ctx: Ctx) {
  return letterheadHtml({
    logoUrl: ctx.logo,
    title: `${ctx.input.offerNo} | ${ctx.input.title}`,
  });
}

const tlWhole = (value: number) =>
  `${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(value)} ₺`;

/** Aylık üretim çubuk grafiği (SVG). */
function monthlyChart(monthly: number[]) {
  const w = 180;
  const h = 62;
  const max = Math.max(...monthly, 1);
  const bw = w / 12;
  const bars = monthly
    .map((value, i) => {
      const bh = (value / max) * (h - 14);
      const x = i * bw + bw * 0.18;
      const y = h - 8 - bh;
      return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${(bw * 0.64).toFixed(2)}" height="${bh.toFixed(2)}" fill="#829797"/><text x="${(i * bw + bw / 2).toFixed(2)}" y="${(y - 1.2).toFixed(2)}" font-size="2.6" text-anchor="middle" fill="#1f2324">${num(value, 0)}</text><text x="${(i * bw + bw / 2).toFixed(2)}" y="${h - 3}" font-size="2.8" text-anchor="middle" fill="#1f2324">${MONTH_LABELS[i]}</text>`;
    })
    .join("");
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" font-family="Ubuntu,Arial,sans-serif">${bars}<line x1="0" y1="${h - 8}" x2="${w}" y2="${h - 8}" stroke="#222" stroke-width=".3"/></svg>`;
}

/** Yıl sonu kümülatif nakit (SVG): kırmızı yatırımın henüz dönmediği yıllar. */
function cumulativeChart(values: number[]) {
  const w = 180;
  const h = 58;
  const pos = Math.max(...values, 0);
  const neg = Math.max(...values.map((v) => -v), 0);
  const span = Math.max(pos + neg, 1);
  const usable = h - 8;
  // Sıfır çizgisi pozitif/negatif aralığa göre kayar; boş yarım kalmaz.
  const zero = 2 + (pos / span) * (usable - 2);
  const bw = w / values.length;
  const bars = values
    .map((value, i) => {
      const bh = (Math.abs(value) / span) * (usable - 2);
      const x = i * bw + bw * 0.15;
      const y = value >= 0 ? zero - bh : zero;
      const label =
        (i + 1) % 5 === 0 || i === 0
          ? `<text x="${(i * bw + bw / 2).toFixed(2)}" y="${h - 1}" font-size="2.6" text-anchor="middle" fill="#1f2324">${i + 1}. yıl</text>`
          : "";
      return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${(bw * 0.7).toFixed(2)}" height="${bh.toFixed(2)}" fill="${value >= 0 ? "#5f9e6e" : "#d27a6d"}"/>${label}`;
    })
    .join("");
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" font-family="Ubuntu,Arial,sans-serif">${bars}<line x1="0" y1="${zero}" x2="${w}" y2="${zero}" stroke="#222" stroke-width=".3"/></svg>`;
}

function productionPage(ctx: Ctx): string | null {
  const production = ctx.input.production;
  if (!production || !(production.annual > 0)) return null;
  const finance = ctx.input.finance;
  const kpis: [string, string][] = [
    ["Yıllık üretim", `${num(production.annual, 0)} kWh`],
    ["Günlük ortalama", `${num(production.daily, 0)} kWh`],
    [
      "kWp başına",
      `${num(production.annual / Math.max(ctx.kwp, 0.001), 0)} kWh`,
    ],
    ["Önlenen CO₂", `${num(production.co2Tons, 1)} ton/yıl`],
  ];
  let financeHtml = "";
  if (finance) {
    const fk: [string, string][] = [
      ["Tüketimi karşılama", `%${num(finance.coverage * 100, 0)}`],
      ["1. yıl tasarruf", tlWhole(finance.firstYearSavingTl)],
      [
        "Geri dönüş",
        finance.paybackYears === null
          ? "25 yıl+"
          : `${num(finance.paybackYears, 1)} yıl`,
      ],
      ["25 yıl tasarruf", tlWhole(finance.totalSavingTl)],
    ];
    financeHtml = `<div class="h" style="margin-top:4mm">Kazanç ve geri dönüş</div>
<div class="kpis">${fk.map(([l, v]) => `<div><small>${esc(l)}</small><b>${esc(v)}</b></div>`).join("")}</div>
${cumulativeChart(finance.cumulative)}
<p class="note">Aylık ortalama ${num(finance.annualConsumptionKwh / 12, 0)} kWh tüketim ve aylık mahsuplaşma varsayımıyla hesaplanmıştır; yatırım tutarı ${tlWhole(finance.investmentTl)}. Grafik yıl sonu kümülatif nakdi gösterir (kırmızı: yatırım henüz geri dönmedi). Bakım, sigorta ve ekipman değişimi dahil değildir; sonuçlar gerçek tüketim, tarife ve hava koşullarına göre değişir.</p>`;
  }
  return `<section class="page lh"><div class="body">
<div class="h">Üretim ve kazanç</div>
<div class="sub">${esc(formatKwp(ctx.kwp))} kWp sistemin tahmini üretimi${ctx.input.location ? ` — ${esc(ctx.input.location)}` : ""}</div>
<div class="kpis">${kpis.map(([l, v]) => `<div><small>${esc(l)}</small><b>${esc(v)}</b></div>`).join("")}</div>
<div class="price-title" style="margin-top:0">Aylık tahmini üretim (kWh)</div>
${monthlyChart(production.monthly)}
${financeHtml}
<p class="note">Üretim tahminidir${ctx.input.productionSource ? `; kaynak: ${esc(ctx.input.productionSource)} — Avrupa Komisyonu JRC uydu ışınım verisi, sistem kayıpları dahil` : ""}. Panel yönü, eğimi, gölgelenme ve yıllık güneşlenme farkına göre ±%10 değişebilir.</p>
</div>${band(ctx)}</section>`;
}

/** Enerji akış şeması: güneş → paneller → inverter → tesis; yanlarda
 * batarya (varsa) ve şebeke (fazla üretim / mahsuplaşma). */
function flowDiagram(ctx: Ctx) {
  const { ges } = ctx.input;
  const sage = "#5f7474";
  const mist = "#dfe9ea";
  const hasBattery = ctx.batteryKwh > 0;
  const panelW = Number(ctx.panel?.power_w ?? 0);
  const node = (
    x: number,
    title: string,
    detail: string,
    icon: string,
    fill = mist,
  ) =>
    `<g transform="translate(${x} 14)"><rect width="34" height="34" rx="5" fill="${fill}"/>${icon}<text x="17" y="44" text-anchor="middle" font-size="3.6" font-weight="700" fill="#1f2324">${esc(title)}</text><text x="17" y="49" text-anchor="middle" font-size="3" fill="#4a5556">${esc(detail)}</text></g>`;
  const arrow = (x1: number, x2: number) =>
    `<line x1="${x1}" y1="31" x2="${x2 - 1.5}" y2="31" stroke="${sage}" stroke-width="1.1" stroke-dasharray="2.4 1.6"/><path d="M${x2 - 2} 28.6 L${x2 + 0.6} 31 L${x2 - 2} 33.4 Z" fill="${sage}"/>`;
  const sun = `<circle cx="17" cy="17" r="6.5" fill="#f2b84b"/>${Array.from(
    { length: 8 },
    (_, i) => {
      const a = (i * Math.PI) / 4;
      return `<line x1="${(17 + Math.cos(a) * 9).toFixed(2)}" y1="${(17 + Math.sin(a) * 9).toFixed(2)}" x2="${(17 + Math.cos(a) * 12).toFixed(2)}" y2="${(17 + Math.sin(a) * 12).toFixed(2)}" stroke="#f2b84b" stroke-width="1.4" stroke-linecap="round"/>`;
    },
  ).join("")}`;
  const panels = `<g transform="translate(6 9) skewX(-12)">${[0, 1, 2]
    .map((r) =>
      [0, 1, 2]
        .map(
          (c) =>
            `<rect x="${c * 7.6}" y="${r * 5.6}" width="7" height="5" rx=".6" fill="#2f5d7c"/>`,
        )
        .join(""),
    )
    .join("")}</g><rect x="15" y="26" width="1.6" height="4" fill="${sage}"/>`;
  const inverter = `<rect x="9" y="7" width="16" height="20" rx="2" fill="#fff" stroke="${sage}" stroke-width="1"/><rect x="12" y="10" width="10" height="5" rx="1" fill="${mist}"/><path d="M13 21 q2 -3 4 0 t4 0" fill="none" stroke="${sage}" stroke-width="1"/>`;
  const home = `<path d="M6 18 L17 8 L28 18 Z" fill="#d79a6a"/><rect x="9" y="18" width="16" height="10" fill="#fff" stroke="${sage}" stroke-width=".8"/><rect x="15" y="21" width="4" height="7" fill="${mist}"/>`;
  const battery = `<rect x="11" y="9" width="12" height="18" rx="2" fill="#5f9e6e"/><rect x="14.5" y="7" width="5" height="2" rx=".6" fill="#3f7a4e"/><path d="M18 12 L14.5 18.5 H17.5 L16 24 L20 16.5 H17 Z" fill="#fff"/>`;
  const grid = `<path d="M17 6 L11 28 M17 6 L23 28 M12.5 21 H21.5 M14 15 H20 M9 11 H25" stroke="${sage}" stroke-width="1.2" fill="none" stroke-linecap="round"/>`;
  const items = [
    node(2, "Güneş", "Muğla ışınımı", sun, "#fff6e3"),
    node(
      46,
      "Paneller",
      ges.panelCount > 0
        ? `${ges.panelCount} × ${num(panelW, 0)} Wp`
        : `${formatKwp(ctx.kwp)} kWp`,
      panels,
    ),
    node(
      90,
      "İnverter",
      `${formatKwp(ctx.acKw)} kW ${ges.systemType === "hibrit" ? "hibrit" : "on-grid"}`,
      inverter,
    ),
    node(134, "Tesisiniz", "Öz tüketim", home, "#fbefe5"),
  ];
  const lines = [arrow(36, 46), arrow(80, 90), arrow(124, 134)];
  // Alt dallar: inverterden bataryaya ve şebekeye.
  const branchY = 66;
  let branches = `<path d="M107 63 V${branchY + 4}" stroke="${sage}" stroke-width="1.1" stroke-dasharray="2.4 1.6"/>`;
  const sideNode = (x: number, title: string, detail: string, icon: string) =>
    `<g transform="translate(${x} ${branchY + 4})"><rect width="30" height="26" rx="5" fill="${mist}"/><g transform="translate(-2 -4) scale(.88)">${icon}</g><text x="15" y="33" text-anchor="middle" font-size="3.4" font-weight="700" fill="#1f2324">${esc(title)}</text><text x="15" y="38" text-anchor="middle" font-size="2.9" fill="#4a5556">${esc(detail)}</text></g>`;
  if (hasBattery) {
    branches += `<path d="M107 ${branchY + 4} H${70 + 15} V${branchY + 4}" stroke="${sage}" stroke-width="1.1" stroke-dasharray="2.4 1.6" fill="none"/>`;
    branches += sideNode(
      70,
      "Batarya",
      `${formatKwp(ctx.batteryKwh)} kWh · gece`,
      battery,
    );
  }
  branches += `<path d="M107 ${branchY + 4} H${130}" stroke="${sage}" stroke-width="1.1" stroke-dasharray="2.4 1.6" fill="none"/>`;
  branches += sideNode(126, "Şebeke", "fazlası mahsup", grid);
  return `<svg viewBox="0 0 170 ${branchY + 46}" xmlns="http://www.w3.org/2000/svg" font-family="Ubuntu,Arial,sans-serif">${lines.join("")}${items.join("")}${branches}</svg>`;
}

/** 25 yıllık geri dönüş çizgisi: yatırımın kendini ödediği yıl işaretli. */
function paybackStrip(paybackYears: number, years = 25) {
  const w = 170;
  const x0 = 4;
  const x1 = w - 4;
  const at = (year: number) => x0 + ((x1 - x0) * year) / years;
  const p = Math.min(paybackYears, years);
  const ticks = [0, 5, 10, 15, 20, 25]
    .map(
      (y) =>
        `<line x1="${at(y)}" y1="17" x2="${at(y)}" y2="19.5" stroke="#4a5556" stroke-width=".3"/><text x="${at(y)}" y="24" font-size="2.8" text-anchor="middle" fill="#4a5556">${y}. yıl</text>`,
    )
    .join("");
  return `<svg viewBox="0 0 ${w} 26" xmlns="http://www.w3.org/2000/svg" font-family="Ubuntu,Arial,sans-serif">
<rect x="${x0}" y="10" width="${at(p) - x0}" height="7" rx="1.5" fill="#d9a59b"/>
<rect x="${at(p)}" y="10" width="${x1 - at(p)}" height="7" rx="1.5" fill="#5f9e6e"/>
<text x="${(x0 + at(p)) / 2}" y="14.8" font-size="3" text-anchor="middle" fill="#fff" font-weight="700">${at(p) - x0 > 22 ? "Yatırım geri dönüyor" : ""}</text>
<text x="${(at(p) + x1) / 2}" y="14.8" font-size="3" text-anchor="middle" fill="#fff" font-weight="700">${x1 - at(p) > 22 ? "Kazanç dönemi" : ""}</text>
<path d="M${at(p)} 3 V17" stroke="#1f2324" stroke-width=".5"/>
<circle cx="${at(p)}" cy="4" r="2.2" fill="#1f2324"/>
<text x="${at(p) + (p > 20 ? -3.5 : 3.5)}" y="5.2" font-size="3.2" font-weight="700" text-anchor="${p > 20 ? "end" : "start"}" fill="#1f2324">${num(paybackYears, 1)}. yılda kendini öder</text>
${ticks}</svg>`;
}

/** "Bir bakışta": kapaktan sonra tek sayfada yatırımın özeti. */
function overviewPage(ctx: Ctx): string {
  const { input } = ctx;
  const production = input.production;
  const finance = input.finance;
  const cur = input.currency;
  const annual = production?.annual ?? 0;
  const hero: [string, string, string, boolean][] = [
    [
      "Kurulu güç",
      `${formatKwp(ctx.kwp)} kWp`,
      [
        input.ges.panelCount > 0 ? `${input.ges.panelCount} panel` : "",
        ctx.acKw > 0 ? `${formatKwp(ctx.acKw)} kW inverter` : "",
        ctx.batteryKwh > 0 ? `${formatKwp(ctx.batteryKwh)} kWh batarya` : "",
      ]
        .filter(Boolean)
        .join(" · "),
      false,
    ],
  ];
  if (finance && finance.paybackYears !== null) {
    hero.push([
      "Geri dönüş süresi",
      `${num(finance.paybackYears, 1)} yıl`,
      `Sonraki ${num(Math.max(0, 25 - finance.paybackYears), 0)} yıl net kazanç`,
      true,
    ]);
  } else {
    hero.push([
      "Anahtar teslim fiyat",
      money(input.grandTotal, cur),
      "KDV dahil",
      true,
    ]);
  }
  const kpis: [string, string, string][] = [];
  if (annual > 0) {
    kpis.push([
      "Yıllık üretim",
      `${num(annual, 0)} kWh`,
      `Günde ort. ${num(production?.daily ?? 0, 0)} kWh`,
    ]);
  }
  if (finance) {
    kpis.push([
      "1. yıl tasarruf",
      tlWhole(finance.firstYearSavingTl),
      `Ayda ort. ${tlWhole(finance.firstYearSavingTl / 12)}`,
    ]);
    kpis.push([
      "Tüketimi karşılama",
      `%${num(finance.coverage * 100, 0)}`,
      `Yıllık ${num(finance.annualConsumptionKwh, 0)} kWh tüketim`,
    ]);
    const net = finance.cumulative.at(-1) ?? 0;
    kpis.push([
      "25 yıl net kazanç",
      tlWhole(net),
      `Toplam tasarruf ${tlWhole(finance.totalSavingTl)}`,
    ]);
  }
  if (production && production.co2Tons > 0) {
    kpis.push([
      "Önlenen CO₂",
      `${num(production.co2Tons, 1)} ton/yıl`,
      `≈ ${num(production.co2Tons / 0.022, 0)} ağacın yıllık emdiği`,
    ]);
  }
  // Geri dönüş varsa fiyat büyük kartta değil; burada gösterilir.
  if (finance && finance.paybackYears !== null) {
    kpis.push([
      "Yatırım",
      money(input.grandTotal, cur),
      "KDV dahil, anahtar teslim",
    ]);
  }
  if (input.showPricePerWp && input.salePerWp) {
    kpis.push(["Watt başı", formatUsdPerWp(input.salePerWp), "KDV hariç"]);
  }
  // Tek sıra (4 kart) sayfaya sığar; öncelik sırasına göre seçilir. CO₂ ve
  // karşılama oranı "Üretim ve kazanç" sayfasında da var.
  const priority = [
    "Yıllık üretim",
    "1. yıl tasarruf",
    "25 yıl net kazanç",
    "Yatırım",
    "Önlenen CO₂",
    "Tüketimi karşılama",
    "Watt başı",
  ];
  const shown = priority
    .map((label) => kpis.find(([l]) => l === label))
    .filter((kpi): kpi is [string, string, string] => Boolean(kpi))
    .slice(0, 4);
  return `<section class="page lh"><div class="body">
<div class="ov-head"><div><div class="h" style="margin:0">Bir bakışta</div><div class="sub" style="margin:1mm 0 0">Teklifimizin özeti; ayrıntılar sonraki sayfalardadır.</div></div>
<div class="who"><b>${esc(upperTr(input.recipientName || "-"))}</b>${input.location ? `${esc(input.location)}<br>` : ""}${dateDots(input.issueDate)} · ${esc(input.offerNo)}</div></div>
<div class="ov-hero">${hero.map(([label, value, detail, alt]) => `<div class="${alt ? "alt" : ""}"><small>${esc(label)}</small><b>${esc(value)}</b>${detail ? `<span>${esc(detail)}</span>` : ""}</div>`).join("")}</div>
${shown.length ? `<div class="ov-kpis">${shown.map(([label, value, detail]) => `<div><small>${esc(label)}</small><b>${esc(value)}</b><span>${esc(detail)}</span></div>`).join("")}</div>` : ""}
<div class="ov-sec">Sisteminiz nasıl çalışır?</div>
<div class="ov-flow">${flowDiagram(ctx)}</div>
${
  finance && finance.paybackYears !== null
    ? `<div class="ov-sec">Yatırımın geri dönüşü</div><div class="ov-pay">${paybackStrip(finance.paybackYears)}<p>Panellerin 25 yıl performans garantisi vardır. Hesap; aylık ortalama ${num(finance.annualConsumptionKwh / 12, 0)} kWh tüketim, güncel tarife ve aylık mahsuplaşma varsayımıyla yapılmıştır.</p></div>`
    : ""
}
</div>${band(ctx)}</section>`;
}

function layoutPage(ctx: Ctx): string | null {
  const layout = ctx.input.layout;
  if (!layout || !layout.svg) return null;
  const rows = layout.faces.filter((face) => face.panels > 0);
  return `<section class="page lh"><div class="body">
<div class="h">Panel yerleşimi</div>
<div class="sub">Uydu görüntüsü üzerinden yapılan ön yerleşim; kesin yerleşim keşif ve statik inceleme sonrası netleşir.</div>
<div class="plan">${layout.svg}</div>
<table class="grid-table" style="margin-top:6mm"><thead><tr><th style="text-align:left">YÜZEY</th><th>PANEL</th><th>EĞİM</th><th>YÖN</th><th>ALAN</th></tr></thead><tbody>
${rows.map((face) => `<tr><td>${esc(face.name)}</td><td class="c">${face.panels}</td><td class="c">${face.tilt}°</td><td class="c">${esc(face.direction)}</td><td class="c">${num(face.areaM2, 0)} m²</td></tr>`).join("")}
</tbody></table>
</div>${band(ctx)}</section>`;
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

  // 1a) Bir bakışta: güç, üretim, tasarruf, geri dönüş ve enerji akışı.
  pages.push(overviewPage(ctx));

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
  pages.push(`<section class="page lh">
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
${band(ctx)}</section>`);

  // 3) Teklifin konusu ve iş akışı
  pages.push(`<section class="page lh"><div class="body">
<div class="h">Teklifin konusu, taraflar ve şartlar</div>
<p>İş bu “mühendislik, ürün tedarik ve kurulum” teklifi, ${esc(kwpText)} güçte fotovoltaik güneş enerjisine dayalı ${ges.roofType === "arazi" ? "arazi/teras" : "çatı"} uygulamalı elektrik üretim tesisinin (GES)${ctx.hasSarj ? " ve elektrikli araç şarj sisteminin" : ""} projelendirme, ürün tedarik, kurulum, test, devreye alma ve geçici hizmetlerinin <b>${esc(NES_COMPANY.legalName)}</b> tarafından gerçekleştirilmesine dair iş ve işlemlerin sunulması amacıyla hazırlanmıştır.</p>
<p>Teklifin amacı ve konusu, söz konusu tesisin mühendislik, ürün tedarik, kurulum, test, devreye alma ve geçici kabul işlemlerinin gerçekleştirilerek, tesisin hatasız ve eksiksiz olarak, faal durumda, tarafınıza sözleşme süresi içinde şirketimiz tarafından teslim edilmesidir. Fotovoltaik modüllerin montajının yapılacağı çatı ve cephe alanlarının, uygulama öncesi montaja uygun hale getirilmiş ve tam izolasyona sahip olması gerekmektedir.</p>
<div class="h" style="margin-top:12mm">İş akışı</div>
<p>Güneş enerjisi santralinde kullanılacak tüm ana ve yardımcı teçhizat, elektrik piyasası güncel mevzuat hükümlerine ve TEDAŞ şartnamelerine uyumlu olacaktır. GES’in lisanssız üretim kapsamında aylık mahsuplaşma uygulamasına dahil edilmesi durumuna hazırlık olarak, GES bir bütün olarak projelendirmeye ve izin sürecine hazır halde kurulacaktır.</p>
<p>Santralde kullanılacak fotovoltaik modüller, alüminyum sabitleme elemanları ile ${ges.roofType === "arazi" ? "zemine" : "çatı zeminine"} uygun açıda konumlanacak şekilde sabitlenecektir. Santralin kurulacağı alanda fotovoltaik panellerin kabloları ve konstrüksiyon sisteminden kaynaklı herhangi bir görüntü kirliliği ortaya çıkmayacaktır.</p>
${ctx.batteryKwh > 0 ? `<p>Sistem, ${esc(formatKwp(ctx.batteryKwh))} kWh lityum batarya ile birlikte hibrit olarak kurulacak; gün içinde üretilen enerji önce tesisin ihtiyacını karşılayacak, fazlası bataryada depolanacak ve şebeke kesintilerinde yedeklenen yükler bataryadan beslenmeye devam edecektir.</p>` : ""}
${ctx.hasSarj ? `<p>Elektrikli araç şarj sistemi; ${sarj.stationCount} adet ${esc(`${ctx.station?.brand ?? ""} ${formatKwp(Number(ctx.station?.power_kw ?? 0))} kW`.trim())} şarj istasyonu, ${sarj.phase === "trifaze" ? "trifaze" : "monofaze"} besleme hattı ve kaçak akım / aşırı akım korumalı şarj panosu ile anahtar teslim kurulacaktır.</p>` : ""}
<p>Tesisin, mühendislik, ürün tedarik, kurulum, test, devreye alma ve geçici kabul işlemlerinin gerçekleştirilmesi tümüyle şirketimiz sorumluluğundadır. Şirketimiz, tesisin kurulumu ve işletilmesinde kullanılacak tüm araç, makine ve teçhizatın temin edilmesi, sahaya getirilmesi ve bunların montajının nitelikli personel tarafından gerçekleştirilmesini sağlayacaktır.</p>
</div>${band(ctx)}</section>`);

  // 4) Hizmet kapsamı
  const scope = [...gesScope, ...(ctx.hasSarj ? sarjScope : [])];
  pages.push(`<section class="page lh"><div class="body">
<div class="h">Hizmet kapsamı</div>
<div class="sub">(Hizmet Kapsamı Şebekeye bağlı Mahsuplaşmalı sistemler için geçerlidir. Öztüketim ve Off Grid Sistemlerde proje bulunmadığı için teklife dahil değildir.)</div>
<table class="grid-table${scope.length > 20 ? " tight" : ""}"><thead><tr><th>KAPSAM</th><th style="width:22mm">DAHİL</th><th style="width:22mm">HARİÇ</th></tr></thead><tbody>
${scope.map(([text, included]) => `<tr><td>${esc(text)}</td><td class="c">${included ? "X" : ""}</td><td class="c">${included ? "" : "X"}</td></tr>`).join("")}
</tbody></table></div>${band(ctx)}</section>`);

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
  pages.push(`<section class="page lh"><div class="body">
<div class="h">Donanımlar</div>
<div class="sub">Sisteminiz, ihtiyacınıza uygun konfigürasyon ile maksimum verimlilikte çalışması için tasarlanmıştır. Aşağıda sistem ana bileşenlerinin bir listesini yaptık.</div>
<div class="hw">${cards.map(card).join("")}</div>
<div class="hw ${second.length > 3 ? "four" : "three"}" style="margin-top:8mm">${second.map(card).join("")}</div>
</div>${band(ctx)}</section>`);

  // 6) Proje süreci
  pages.push(`<section class="page lh"><div class="body">
<div class="h">Proje süreci</div>
<div class="sub">(Şebekeye bağlı Mahsuplaşmalı sistemler için geçerlidir. Öztüketim ve Off Grid Sistemlerde proje bulunmadığı için teklife dahil değildir.)</div>
<table class="grid-table proc" style="margin-top:8mm"><tbody>
${gesProcess.map(([when, items]) => `<tr><td>${esc(when)}</td><td>${items.map(esc).join("<br>")}</td></tr>`).join("")}
</tbody></table></div>${band(ctx)}</section>`);

  // 6a) Panel yerleşimi
  const planPage = layoutPage(ctx);
  if (planPage) pages.push(planPage);

  // 6b) Üretim ve kazanç
  const prodPage = productionPage(ctx);
  if (prodPage) pages.push(prodPage);

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
  pages.push(`<section class="page lh"><div class="body">
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
${input.showPricePerWp && input.salePerWp ? `<p>GES watt başı fiyatı: ${esc(formatUsdPerWp(input.salePerWp))} (KDV hariç, ${esc(formatKwp(ctx.kwp))} kWp).</p>` : ""}
<p>Teklifimiz ${esc(dateLong(input.validUntil))} tarihine kadar geçerlidir.</p>
${termLines(input)
  .map((line) => `<p>${esc(line)}</p>`)
  .join("")}
${input.rates.USD > 0 || input.rates.EUR > 0 ? `<p>Hesaplamada kullanılan kurlar: ${[input.rates.USD > 0 ? `1 USD = ${num(input.rates.USD, 4)} TL` : "", input.rates.EUR > 0 ? `1 EUR = ${num(input.rates.EUR, 4)} TL` : ""].filter(Boolean).join(", ")}${input.rateSource === "TCMB" && input.tcmbDate ? ` (TCMB döviz satış kuru, ${esc(input.tcmbDate.split("-").reverse().join("."))})` : ""}.</p>` : ""}
<p>Banka Hesap Bilgileri : ${esc(NES_COMPANY.bankAccountName)}<br>${esc(NES_COMPANY.bank)}<br>TL IBAN : ${esc(NES_COMPANY.iban)}</p>
</div></div>${band(ctx)}</section>`);

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
  /** İcmal ve tablo başlığı için iş grubu. */
  group: string;
};

const GROUP_ORDER = [
  "GES sistemi",
  "Şarj istasyonu",
  "Malzeme",
  "İşçilik ve montaj",
  "Nakliye ve sarf",
  "Diğer",
];

function lineGroup(line: PricedLine) {
  if (line.module === "ges") return "GES sistemi";
  if (line.module === "sarj") return "Şarj istasyonu";
  if (line.category === "malzeme") return "Malzeme";
  if (line.category === "iscilik") return "İşçilik ve montaj";
  if (line.category === "nakliye_sarf") return "Nakliye ve sarf";
  return "Diğer";
}

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
    group: lineGroup(line),
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
          group: "Şarj istasyonu",
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
  const rows = formRows(ctx, options.annex).sort(
    (a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group),
  );
  const groups = [...new Set(rows.map((r) => r.group))];
  const multiGroup = groups.length > 1;
  const survey = options.withSpec ? input.siteSurvey : null;
  const surveyPhotos = survey?.photos ?? [];
  // Antet alt bilgisine taşmasın diye sayfa başına satır sınırlı.
  const perPage = 16;
  const chunks: FormRow[][] = [];
  for (let i = 0; i < Math.max(rows.length, 1); i += perPage) {
    chunks.push(rows.slice(i, i + perPage));
  }
  // Toplamlar bloğu son sayfada yer bulamıyorsa son satırları yeni sayfaya al.
  const last = chunks[chunks.length - 1];
  if (last.length > 12) chunks.push(last.splice(12));
  const specLines = termLines(input);
  const pageCount =
    chunks.length + (options.withSpec ? 1 : 0) + (surveyPhotos.length ? 1 : 0);
  const sale = rows.reduce((sum, row) => sum + row.total, 0);
  const vat = sale * input.vatRate;
  const totalsHtml = `<div class="totals">
<div><b>ARA TOPLAM</b><span>${money(sale, cur)}</span></div>
<div><b>BRÜT TOPLAM</b><span>${money(sale, cur)}</span></div>
<div><b>TOPLAM K.D.V</b><span>${money(vat, cur)}</span></div>
<div><b>GENEL TOPLAM</b><span>${money(sale + vat, cur)}</span></div></div>`;
  // NES anteti: filigran ve alt bilgi her sayfada; üst logo, kendi başlığı
  // olmayan sayfalarda (ilk sayfada formun kendi logolu başlığı var).
  const foot = (page: number, withHead: boolean) =>
    letterheadHtml({
      logoUrl: ctx.logo,
      title: `${input.offerNo} | ${input.title}`,
      footLeft: `${dateDots(input.issueDate)} tarihinde hazırlanmıştır.`,
      pageLabel: `Sayfa ${page} / ${pageCount}`,
      head: withHead,
    });
  const head = `<div class="top"><div><img src="${esc(ctx.logo)}" alt="NES Enerji">
<div class="co"><p>${esc(NES_COMPANY.legalNameUpper)}<br>${esc(NES_COMPANY.addressUpper)}</p><p>${esc(NES_COMPANY.cityUpper)}<br><span class="n">${esc(NES_COMPANY.phoneCompact)}</span></p><p>VD: ${esc(NES_COMPANY.taxOffice)}<br><span class="n">${esc(NES_COMPANY.taxNo)}</span></p></div></div>
<div><div class="tk">${options.annex ? "FİYAT LİSTESİ" : "TEKLİF"}</div><div class="tk-rule"></div>
<div class="lbl">MÜŞTERİ</div><div class="cust">${esc(upperTr(input.recipientName || "-"))}${input.recipientAddress ? `<br>${esc(input.recipientAddress)}` : ""}${input.location ? `<br>${esc(input.location)}` : ""}</div>
<div class="dt"><span class="lbl">TEKLİF NO</span><span>${esc(input.offerNo)}</span></div>
<div class="dt"><span class="lbl">TEKLİF TARİHİ</span><span>${esc(dateLong(input.issueDate))}</span></div>
<div class="dt"><span class="lbl">GEÇERLİLİK</span><span>${esc(dateLong(input.validUntil))}</span></div></div></div>`;

  const pages = chunks.map((chunk, index) => {
    const last = index === chunks.length - 1;
    return `<section class="page form lh${index === 0 ? "" : " cont"}">${index === 0 ? head : ""}
<table class="items"${index === 0 ? "" : ' style="margin-top:0"'}><thead><tr><th>Hizmet / Ürün</th><th class="r">Miktar</th><th class="r">Br. Fiyat</th><th class="r">KDV</th><th class="r">Toplam</th></tr></thead><tbody>
${chunk.map((row, i) => `${multiGroup && (i === 0 || chunk[i - 1].group !== row.group) ? `<tr class="grp"><td colspan="5">${esc(row.group)}</td></tr>` : ""}<tr><td style="width:46%">${esc(row.name)}</td><td class="r">${num(row.quantity)} ${esc(row.unit)}</td><td class="r">${money(row.unitPrice, cur)}</td><td class="r">%${num(input.vatRate * 100)}</td><td class="r">${money(row.total, cur)}</td></tr>`).join("")}
</tbody></table>${last ? `<div class="line"></div>${totalsHtml}` : ""}${foot(index + 1, index > 0)}</section>`;
  });

  if (options.withSpec) {
    const payment = paymentRows(input);
    pages.push(`<section class="page form lh cont"><div class="spec-wrap"><div class="spec">
<p style="text-transform:uppercase">Teklif ve teknik şartname</p>
<p style="text-transform:uppercase">Proje adı: ${esc(input.title)}${input.location ? ` · ${esc(input.location)}` : ""}</p>
<h3>1. Kapsam</h3><p>${esc(input.title)} kapsamında tabloda belirtilen malzemelerin tedariki, montajı, test ve devreye alma işleri anahtar teslim olarak teklif edilmiştir.</p>
${payment.length ? `<h3>2. Ödeme şekli</h3>${payment.map((row) => `<p>• ${esc(row.label)}: %${num(row.percent)} (${money(row.amount, cur)})</p>`).join("")}` : ""}
<h3>${payment.length ? "3" : "2"}. Şartlar</h3>${specLines.map((line) => `<p>• ${esc(line)}</p>`).join("")}
<p>• İşbu teklif ${esc(dateLong(input.validUntil))} tarihine kadar geçerlidir.</p>
${input.rates.USD > 0 || input.rates.EUR > 0 ? `<p>• Hesaplamada kullanılan kurlar: ${[input.rates.USD > 0 ? `1 USD = ${num(input.rates.USD, 4)} TL` : "", input.rates.EUR > 0 ? `1 EUR = ${num(input.rates.EUR, 4)} TL` : ""].filter(Boolean).join(", ")}.</p>` : ""}
<h3>Banka bilgileri</h3><p>${esc(NES_COMPANY.bankAccountName)} · ${esc(NES_COMPANY.bank)}<br>TL IBAN: ${esc(NES_COMPANY.iban)}</p>
</div><div>${
      multiGroup
        ? `<table class="icmal"><thead><tr><th>İcmal</th><th class="r">Tutar</th></tr></thead><tbody>${groups
            .map(
              (g) =>
                `<tr><td>${esc(g)}</td><td class="r">${money(
                  rows
                    .filter((r) => r.group === g)
                    .reduce((a, r) => a + r.total, 0),
                  cur,
                )}</td></tr>`,
            )
            .join("")}</tbody></table>`
        : ""
    }${totalsHtml}<div class="approve"><b>MÜŞTERİ ONAYI</b><p>Teklifi kabul ediyorum.</p><p>Tarih: ____ / ____ / ________</p><p>Ad Soyad / Unvan:</p><p>Kaşe / İmza:</p></div></div></div>${foot(pageCount - (surveyPhotos.length ? 1 : 0), true)}</section>`);
    if (survey && surveyPhotos.length) {
      pages.push(
        `<section class="page form lh cont"><div class="survey"><h3>SAHA KEŞFİ</h3><p class="sv-meta">${[
          survey.surveyNo,
          survey.workType,
          survey.location,
          survey.date ? dateLong(survey.date) : "",
        ]
          .filter(Boolean)
          .map((v) => esc(String(v)))
          .join(
            " · ",
          )}</p><div class="sv-grid">${surveyPhotos.map((p, i) => `<figure><img src="${esc(p.url)}" alt="Saha fotoğrafı ${i + 1}"><figcaption>${esc(p.caption ?? "")}</figcaption></figure>`).join("")}</div><p class="sv-note">Fotoğraflar keşif sırasında çekilmiştir; teklif kapsamı yukarıdaki kalem listesidir.</p></div>${foot(pageCount, true)}</section>`,
      );
    }
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

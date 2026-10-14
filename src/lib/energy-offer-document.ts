// Müşteriye verilecek, sunum düzeninde A4 teklif dosyası (HTML -> yazdır / PDF).
// Metinler NES'in önceki GES tekliflerinden (DG Otomotiv, B. Kolkesen) alınmıştır.

import {
  formatKwp,
  formatMoney,
  gesBatteryKwh,
  gesCapacityKwp,
  gesInverterKw,
  MONTH_LABELS,
  productionEstimate,
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
  address: "Orhaniye Mah. 12 Nolu Sk. Nur Apt. No:6/C Menteşe / Muğla",
  phone: "0 554 610 24 16",
  email: "info@nesgrup.com",
  web: "nesgrup.com",
  bank: "Akbank",
  iban: "TR21 0004 6001 2888 8000 3242 29",
  logoPath: "/nes-enerji-logo.png",
};

export type OfferDocumentInput = {
  offerNo: string;
  issueDate: Date;
  validUntil: string | null;
  title: string;
  recipientName: string;
  contactName: string;
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
  showLinePrices: boolean;
  specificYield: number;
  logoUrl: string;
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

const dateTr = (value: Date | string | null) =>
  value
    ? new Date(value).toLocaleDateString("tr-TR", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "-";

const moduleTitles: Record<OfferModule, string> = {
  ges: "Güneş Enerji Sistemi",
  sarj: "Elektrikli Araç Şarj Sistemi",
  taahhut: "Elektrik Taahhüt İşleri",
  genel: "Diğer Kalemler",
};

const gesScope: [string, boolean][] = [
  ["Keşif yapılması", true],
  ["Bağlantı çağrı mektubu dosyasının hazırlanması, başvuru ve takibi", true],
  ["Statik hesapların yapılması ve projenin hazırlanması", true],
  ["GES uygunluk yazısının alınması", true],
  ["TEDAŞ elektrik projelerinin hazırlanması ve onaylatılması", true],
  ["Tek hat şeması, yerleşim planı ve topraklama projeleri", true],
  ["Bağlantı ve GES kullanım anlaşması başvurularının yapılması", true],
  ["İtfaiye uygunluk yazısı başvurusu ve takibi", true],
  ["GES ürünlerinin tedariki, montajı, test ve devreye alma", true],
  ["Online izleme sisteminin kurulması", true],
  ["Kamu harçlarının ödenmesi", false],
  ["İtfaiye görüşü sonrası GES harici istenebilecek düzeltmeler", false],
  ["Yangın önleme ve söndürme teçhizatının temini", false],
];

const sarjScope: [string, boolean][] = [
  ["Keşif ve kablo güzergâhının belirlenmesi", true],
  ["Şarj istasyonunun tedariki ve montajı", true],
  ["Besleme kablosu, boru ve bağlantı malzemeleri", true],
  ["Kaçak akım ve aşırı akım korumalı şarj panosu", true],
  ["Test, devreye alma ve kullanım eğitimi", true],
  ["Bağlantı gücü artışı için EDAŞ başvuru bedelleri", false],
  ["Kazı, beton, asfalt gibi inşai işler (aksi belirtilmedikçe)", false],
];

const gesProcess: [string, string[]][] = [
  [
    "1. ay",
    [
      "Teklif ve sözleşmenin imzalanması",
      "Gerekli evrakların ve noter onaylı vekâletnamenin alınması",
      "Elektrik dağıtım şirketine başvuru",
    ],
  ],
  [
    "2.–3. ay",
    [
      "Çağrı mektubunun alınması",
      "Elektrik ve statik projelerin hazırlanıp onaylatılması",
      "Montaj ve kurulum",
    ],
  ],
  [
    "4.–5. ay",
    [
      "Bağlantı anlaşması ve çift yönlü sayaç değişikliği",
      "Ön kabul ve geçici kabul işlemleri",
      "Sistem kullanım anlaşmasının yapılması",
    ],
  ],
];

const css = `
@page{size:A4;margin:0}
*{box-sizing:border-box}
:root{--blue:#0B4EA2;--navy:#0E1B33;--sun:#F59E0B;--ink:#1B2333;--muted:#6B7385;--line:#E3E7EE;--soft:#F4F7FB}
html,body{margin:0;padding:0;background:#E9EDF3}
body{font-family:"Inter","Segoe UI",Arial,sans-serif;color:var(--ink);font-size:10.5pt;line-height:1.45;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:210mm;min-height:297mm;margin:10mm auto;background:#fff;position:relative;padding:18mm 16mm 22mm;break-after:page;page-break-after:always;overflow:hidden}
.page:last-child{break-after:auto;page-break-after:auto}
@media print{html,body{background:#fff}.page{margin:0;box-shadow:none}}
@media screen{.page{box-shadow:0 6px 30px rgba(15,30,60,.12)}}
.top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:1px solid var(--line);padding-bottom:5mm;margin-bottom:6mm}
.top img{height:9mm}
.eyebrow{font-size:7.5pt;letter-spacing:.18em;text-transform:uppercase;color:var(--sun);font-weight:700}
.section{font-size:13pt;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--navy);margin:1mm 0 0}
.foot{position:absolute;left:16mm;right:16mm;bottom:9mm;display:flex;justify-content:space-between;font-size:7.5pt;color:var(--muted);border-top:1px solid var(--line);padding-top:3mm}
h2{font-size:10.5pt;color:var(--navy);margin:5mm 0 2.5mm;padding-left:3mm;border-left:3px solid var(--sun);text-transform:uppercase;letter-spacing:.04em}
table{width:100%;border-collapse:collapse}
th{background:var(--navy);color:#fff;font-size:7.5pt;text-transform:uppercase;letter-spacing:.06em;text-align:left;padding:2mm 3mm}
td{border-bottom:1px solid var(--line);padding:1.5mm 3mm;vertical-align:top;font-size:9pt}
thead{display:table-header-group}tr{break-inside:avoid}
.r{text-align:right;white-space:nowrap}.c{text-align:center}
.muted{color:var(--muted)}.small{font-size:8.5pt}
/* kapak */
.cover{padding:0;display:flex;flex-direction:column}
.cover .band{height:3mm;background:linear-gradient(90deg,var(--blue),var(--sun))}
.cover .inner{padding:16mm 16mm 0;flex:1;display:flex;flex-direction:column}
.cover .meta{font-size:8.5pt;min-width:70mm}
.cover .meta div{display:flex;justify-content:space-between;gap:8mm;border-bottom:1px solid var(--line);padding:1.6mm 0}
.cover .meta span:first-child{color:var(--muted);letter-spacing:.12em;text-transform:uppercase;font-size:7pt}
.cover .hero{margin-top:auto;margin-bottom:12mm}
.cover h1{font-size:34pt;line-height:1.05;margin:4mm 0;color:var(--navy);font-weight:300}
.cover h1 b{font-weight:800;display:block}
.cover h1 i{color:var(--sun);font-style:normal}
.cover .lead{color:var(--muted);font-size:11pt;max-width:120mm}
.cover .facts{display:grid;grid-template-columns:repeat(3,1fr);border-top:2px solid var(--navy);margin:0 16mm}
.cover .facts div{padding:4mm 3mm;border-bottom:1px solid var(--line)}
.cover .facts span{display:block;font-size:7pt;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.cover .facts b{font-size:11.5pt;color:var(--navy)}
.cover .facts .big{font-size:18pt;font-weight:300}
.cover .facts .big small{font-size:9pt;color:var(--sun);font-weight:700}
.cover .bottom{display:flex;justify-content:space-between;align-items:center;padding:8mm 16mm 10mm;margin-top:8mm;background:var(--soft)}
.cover .bottom img{height:11mm}
/* kartlar */
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:3mm;margin:5mm 0}
.kpi{border:1px solid var(--line);border-radius:3mm;padding:4mm}
.kpi b{display:block;font-size:17pt;color:var(--navy);font-weight:800;line-height:1.1}
.kpi b small{font-size:8.5pt;color:var(--muted);font-weight:600}
.kpi span{font-size:7.5pt;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.intro{display:grid;grid-template-columns:62mm 1fr;gap:8mm}
.intro .claim{font-size:20pt;line-height:1.15;color:var(--navy);font-weight:300}
.intro .claim b{color:var(--blue);font-weight:800}
.quote{background:#FFF8EB;border-left:3px solid var(--sun);padding:3mm 4mm;margin-top:4mm;font-style:italic}
.flow{display:flex;align-items:center;gap:2mm;margin-top:3mm;flex-wrap:wrap}
.flow div{border:1px solid var(--line);border-radius:2mm;padding:2.5mm 3.5mm;font-size:8.5pt;background:#fff}
.flow div b{display:block;color:var(--navy);font-size:9pt}
.flow i{color:var(--sun);font-style:normal;font-weight:800}
.benefits{display:grid;grid-template-columns:repeat(3,1fr);gap:4mm}
.benefits div b{display:block;color:var(--navy);margin-bottom:1mm}
.two{display:grid;grid-template-columns:1fr 1fr;gap:7mm}
.params td:first-child{color:var(--muted);width:42%}
.params td{padding:1.4mm 2mm}
.compact td{padding:0.9mm 3mm;font-size:8.3pt}
.params td:last-child{font-weight:700;color:var(--navy)}
.chart{border:1px solid var(--line);border-radius:3mm;padding:4mm}
.bars{display:flex;align-items:flex-end;gap:2mm;height:34mm;margin-top:3mm}
.bars div{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;font-size:6pt;color:var(--muted)}
.bars em{display:block;width:100%;background:#D6E3F5;border-radius:1mm 1mm 0 0}
.bars em.max{background:var(--sun)}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:2mm;margin-top:3mm}
.stats div{background:var(--soft);border-radius:2mm;padding:2.5mm;text-align:center}
.stats b{display:block;color:var(--navy);font-size:11pt}
.stats span{font-size:6.5pt;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.note{background:#FFF8EB;border:1px solid #F7D9A3;border-radius:2mm;padding:3mm 4mm;font-size:8.5pt;margin-top:5mm}
.note.blue{background:#EEF4FC;border-color:#C9DBF3}
.cat td:first-child{font-weight:800;color:var(--navy);font-size:8pt;text-transform:uppercase;width:24mm}
.yes{color:#0B8A4A;font-weight:800}.no{color:#B42318;font-weight:800}
.timeline{display:grid;grid-template-columns:repeat(3,1fr);gap:4mm}
.timeline div{border-top:3px solid var(--blue);background:var(--soft);padding:3mm 4mm;border-radius:0 0 2mm 2mm}
.timeline b{color:var(--blue);display:block;margin-bottom:1mm}
.timeline ul{margin:0;padding-left:4mm;font-size:8.5pt}
.price{border:1px solid var(--line);border-radius:3mm;padding:2mm 6mm}
.price div{display:flex;justify-content:space-between;padding:2.5mm 0;border-bottom:1px solid var(--line)}
.price div:last-child{border:none}
.price .total{font-size:15pt;font-weight:800;color:var(--blue)}
.pay{display:flex;align-items:center;gap:4mm;border:1px solid var(--line);border-radius:3mm;padding:3mm 5mm;margin-bottom:3mm}
.pay .pct{width:13mm;height:13mm;border-radius:50%;background:var(--navy);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:9pt;flex:none}
.pay:nth-child(even) .pct{background:var(--sun)}
.pay .what{flex:1}.pay .amt{font-weight:800;color:var(--navy)}
.terms li{margin-bottom:1.5mm;font-size:9pt}
.closing{display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center}
.closing h1{font-size:24pt;font-weight:300;color:var(--navy);margin:0}
.closing h1 b{font-weight:800}
.closing hr{width:14mm;border:none;border-top:2px solid var(--sun);margin:7mm auto}
`;

function header(section: string, title: string, logoUrl: string) {
  return `<div class="top"><div><div class="eyebrow">${esc(section)}</div><div class="section">${esc(title)}</div></div><img src="${esc(logoUrl)}" alt="NES Enerji"></div>`;
}

function footer(input: OfferDocumentInput) {
  return `<div class="foot"><span>${esc(NES_COMPANY.phone)} · ${esc(NES_COMPANY.address)}</span><span>${esc(input.offerNo)}</span></div>`;
}

export function buildOfferDocument(input: OfferDocumentInput): string {
  const { ges, sarj, catalog, currency } = input;
  const visible = input.lines.filter((line) => line.visibleToCustomer);
  const hasGes = ges.enabled && visible.some((line) => line.module === "ges");
  const hasSarj =
    sarj.enabled && visible.some((line) => line.module === "sarj");
  const hasTaahhut = visible.some((line) => line.module === "taahhut");
  const kwp = hasGes ? gesCapacityKwp(ges, catalog) : 0;
  const acKw = hasGes ? gesInverterKw(ges, catalog) : 0;
  const batteryKwh = hasGes ? gesBatteryKwh(ges, catalog) : 0;
  const panel = catalog.find((item) => item.id === ges.panelId);
  const inverter = catalog.find((item) => item.id === ges.inverterId);
  const battery = catalog.find((item) => item.id === ges.batteryId);
  const station = catalog.find((item) => item.id === sarj.stationId);
  const prod = productionEstimate(kwp, input.specificYield);
  const hybrid = ges.systemType === "hibrit";
  const systemLabel = hybrid
    ? "Hibrit (şebeke + batarya)"
    : "Şebeke bağlantılı (on-grid)";
  const roofLabel =
    ges.roofType === "kiremit"
      ? "Kiremit çatı uygulaması"
      : ges.roofType === "trapez"
        ? "Trapez / sandviç panel çatı"
        : "Arazi / teras uygulaması";

  const subjectParts = [
    hasGes ? "GES" : "",
    hasSarj ? "EV Şarj" : "",
    hasTaahhut ? "Elektrik Taahhüt" : "",
  ].filter(Boolean);
  const coverTitle = hasGes
    ? `${hybrid ? "Hibrit" : "Çatı Üstü"}<b>GES Projesi<i>.</i></b>`
    : hasSarj
      ? `Elektrikli Araç<b>Şarj Projesi<i>.</i></b>`
      : `Elektrik<b>Taahhüt Teklifi<i>.</i></b>`;
  const lead = hasGes
    ? `${hasSarj ? "Güneş enerji sistemi ve elektrikli araç şarj altyapısı" : "Güneş enerji sistemi"} için anahtar teslim mühendislik, tedarik ve kurulum teklifi.`
    : "Projelendirme, tedarik, kurulum ve devreye alma teklifi.";

  const coverFacts: [string, string, boolean?][] = [
    ["Teklif sunulan", input.recipientName || "-"],
    ["Proje lokasyonu", input.location || "-"],
    ["Kapsam", subjectParts.join(" + ") || input.title],
  ];
  if (hasGes) {
    coverFacts.push([
      "Kurulu güç",
      `${formatKwp(kwp)} <small>kWp</small>`,
      true,
    ]);
    coverFacts.push(
      batteryKwh > 0
        ? ["Batarya", `${formatKwp(batteryKwh)} <small>kWh</small>`, true]
        : ["İnverter", `${formatKwp(acKw)} <small>kWe</small>`, true],
    );
    coverFacts.push([
      "Tahmini yıllık üretim",
      `${num(prod.annual, 0)} <small>kWh</small>`,
      true,
    ]);
  } else if (hasSarj) {
    coverFacts.push([
      "Şarj noktası",
      `${sarj.stationCount} <small>adet</small>`,
      true,
    ]);
    coverFacts.push([
      "Toplam güç",
      `${formatKwp((station?.power_kw ?? 0) * sarj.stationCount)} <small>kW</small>`,
      true,
    ]);
    coverFacts.push([
      "Besleme",
      sarj.phase === "trifaze" ? "Trifaze" : "Monofaze",
    ]);
  }

  const pages: string[] = [];

  // 1) Kapak
  pages.push(`<section class="page cover"><div class="band"></div><div class="inner">
<div style="display:flex;justify-content:space-between;align-items:flex-start"><img src="${esc(input.logoUrl)}" alt="NES Enerji" style="height:12mm"><div class="meta"><div><span>Belge no</span><b>${esc(input.offerNo)}</b></div><div><span>Tarih</span><b>${dateTr(input.issueDate)}</b></div><div><span>Son geçerlilik</span><b>${dateTr(input.validUntil)}</b></div></div></div>
<div class="hero"><div class="eyebrow">— Mühendislik, tedarik ve kurulum teklifi</div><h1>${coverTitle}</h1><div class="lead">${esc(lead)}</div></div></div>
<div class="facts">${coverFacts
    .map(
      ([label, value, big]) =>
        `<div><span>${esc(label)}</span><b class="${big ? "big" : ""}">${big ? value : esc(value)}</b></div>`,
    )
    .join("")}</div>
<div class="bottom"><img src="${esc(input.logoUrl)}" alt="NES Enerji"><div class="small muted" style="text-align:right">${esc(NES_COMPANY.address)}<br>${esc(NES_COMPANY.phone)} · ${esc(NES_COMPANY.email)}</div></div></section>`);

  // 2) Giriş ve özet
  const kpis: [string, string, string][] = [];
  if (hasGes) {
    kpis.push([formatKwp(kwp), "kWp", "DC kurulu güç"]);
    kpis.push([String(ges.panelCount), "adet", "Güneş paneli"]);
    kpis.push([
      `${ges.inverterCount} × ${formatKwp(Number(inverter?.power_kw ?? 0))}`,
      "kW",
      hybrid ? "Hibrit inverter" : "İnverter",
    ]);
    kpis.push(
      batteryKwh > 0
        ? [formatKwp(batteryKwh), "kWh", "Batarya kapasitesi"]
        : [num(prod.annual, 0), "kWh", "Yıllık üretim (tahmini)"],
    );
  }
  if (hasSarj) {
    kpis.push([String(sarj.stationCount), "adet", "Şarj istasyonu"]);
    kpis.push([
      formatKwp(Number(station?.power_kw ?? 0)),
      "kW",
      "İstasyon gücü",
    ]);
  }
  const flow = hasGes
    ? `<h2>Sistem nasıl çalışır?</h2><div class="flow"><div><b>Güneş panelleri</b>${formatKwp(kwp)} kWp · ${ges.panelCount} adet</div><i>→</i><div><b>${hybrid ? "Hibrit inverter" : "İnverter"}</b>${ges.inverterCount} × ${formatKwp(Number(inverter?.power_kw ?? 0))} kW</div><i>→</i><div><b>Tüketim</b>Öncelikli besleme</div>${batteryKwh > 0 ? `<i>⇄</i><div><b>Batarya</b>${formatKwp(batteryKwh)} kWh depolama</div>` : ""}<i>⇄</i><div><b>Şebeke</b>Çift yönlü sayaç</div>${hasSarj ? `<i>→</i><div><b>EV şarj</b>${sarj.stationCount} × ${formatKwp(Number(station?.power_kw ?? 0))} kW</div>` : ""}</div>
<p class="small muted">Üretilen enerji önce tesiste tüketilir${batteryKwh > 0 ? ", fazlası bataryayı şarj eder; şebeke kesintisinde yedeklenen yükler bataryadan beslenir" : "; fazlası mahsuplaşma kapsamında şebekeye verilir"}.</p>`
    : "";
  const benefits = hasGes
    ? `<h2>Sistemin sağladıkları</h2><div class="benefits"><div><b>${batteryKwh > 0 ? "Kesintisiz enerji" : "Mahsuplaşma"}</b>${batteryKwh > 0 ? "Şebeke kesintilerinde yedeklenen yükler bataryadan beslenmeye devam eder." : "Fazla üretim şebekeye verilir, tüketimle aylık mahsuplaşılır."}</div><div><b>Fatura tasarrufu</b>Şebekeden çekilen enerjiyi azaltarak elektrik giderini düşürür.</div><div><b>Temiz enerji</b>Yılda yaklaşık ${num(prod.co2Tons, 1)} ton CO₂ salımının önüne geçer.</div></div>`
    : "";
  pages.push(`<section class="page">${header("Giriş", "Yönetici özeti", input.logoUrl)}
<div class="intro"><div class="claim">${hasGes ? "Çatınızdan<br><b>kendi enerjiniz.</b>" : "Güvenilir<br><b>elektrik altyapısı.</b>"}<p class="small muted" style="margin-top:6mm">SAYIN<br><b style="color:var(--navy);font-size:11pt">${esc(input.recipientName || "-")}</b>${input.contactName ? `<br>${esc(input.contactName)}` : ""}</p></div>
<div><p>Firmamıza göstermiş olduğunuz ilgiye teşekkür ederiz. Talep ettiğiniz ${esc(subjectParts.join(", ") || input.title)} işlerine ait teklifimiz ile ilgili detaylar aşağıda bilgilerinize sunulmuştur.</p>
${hasGes ? `<p>${esc(input.location || "Tesisiniz")} için ${formatKwp(kwp)} kWp güneş enerji sistemi${batteryKwh > 0 ? ` ile ${formatKwp(batteryKwh)} kWh lityum batarya depolamayı birleştiren hibrit bir sistem` : ""} tasarladık. Sistemde kullanılacak tüm ana ve yardımcı teçhizat güncel elektrik piyasası mevzuatına ve TEDAŞ şartnamelerine uyumludur.</p>` : ""}
<p>Teklifimizin uygun görüleceğini ve birlikte çalışma imkânı bulacağımızı ümit eder, her türlü sorunuzu yanıtlamaya hazır olduğumuzu bilgilerinize sunarız.</p>
<div class="quote">Hedefimiz, tesisinizi hatasız ve eksiksiz, çalışır durumda ve sözleşme süresi içinde teslim etmektir.</div></div></div>
<div class="kpis">${kpis
    .slice(0, 4)
    .map(
      ([value, unit, label]) =>
        `<div class="kpi"><b>${esc(value)} <small>${esc(unit)}</small></b><span>${esc(label)}</span></div>`,
    )
    .join("")}</div>
${flow}${benefits}${footer(input)}</section>`);

  // 3) Teknik tasarım
  if (hasGes || hasSarj) {
    const params: [string, string][] = [];
    if (hasGes) {
      params.push(
        ["Proje konumu", input.location || "-"],
        ["Montaj tipi", roofLabel],
        ["Sistem tipi", systemLabel],
        [
          "Panel",
          `${panel?.brand ? `${panel.brand} ` : ""}${panel?.model ?? panel?.name ?? "-"}`,
        ],
        ["Panel gücü", `${num(Number(panel?.power_w ?? 0), 0)} Wp`],
        ["Panel sayısı", `${ges.panelCount} adet`],
        ["Toplam DC güç", `${formatKwp(kwp)} kWp`],
        [
          "İnverter",
          `${ges.inverterCount} × ${inverter?.brand ? `${inverter.brand} ` : ""}${formatKwp(Number(inverter?.power_kw ?? 0))} kW${inverter?.phase === "trifaze" ? " (trifaze)" : inverter?.phase === "mono" ? " (monofaze)" : ""}`,
        ],
        ["Toplam AC güç", `${formatKwp(acKw)} kWe`],
        ["DC/AC oranı", acKw > 0 ? num(kwp / acKw) : "-"],
      );
      if (ges.contractPowerKw > 0) {
        params.push(["Sözleşme gücü", `${formatKwp(ges.contractPowerKw)} kW`]);
      }
      if (batteryKwh > 0) {
        params.push(
          [
            "Batarya",
            `${ges.batteryCount} × ${battery?.brand ? `${battery.brand} ` : ""}${battery?.model ?? battery?.name ?? ""}`,
          ],
          ["Toplam batarya", `${formatKwp(batteryKwh)} kWh`],
        );
      }
    }
    const maxMonth = Math.max(...prod.monthly, 1);
    const chart = hasGes
      ? `<div class="chart"><b style="color:var(--navy)">Üretim simülasyonu</b><div class="small muted">Tahmini aylık dağılım · ${num(input.specificYield, 0)} kWh/kWp</div>
<div class="bars">${prod.monthly
          .map(
            (value, index) =>
              `<div>${num(value, 0)}<em class="${value === maxMonth ? "max" : ""}" style="height:${Math.round((value / maxMonth) * 30)}mm"></em>${MONTH_LABELS[index]}</div>`,
          )
          .join("")}</div>
<div class="stats"><div><b>${num(prod.annual, 0)}</b><span>kWh / yıl</span></div><div><b>~${num(prod.daily, 0)}</b><span>kWh / gün</span></div><div><b>~${num(prod.co2Tons, 1)} t</b><span>CO₂ / yıl</span></div></div>
<p class="small muted" style="margin:3mm 0 0">Üretim; çatı yönü, eğimi, gölgelenme ve hava koşullarına göre değişir. Değerler tahminidir.</p></div>`
      : "";
    const sarjBlock = hasSarj
      ? `<h2>Şarj altyapısı</h2><table class="params"><tbody>
<tr><td>Şarj istasyonu</td><td>${esc(`${station?.brand ?? ""} ${station?.model ?? station?.name ?? ""}`.trim())}</td></tr>
<tr><td>Adet</td><td>${sarj.stationCount}</td></tr>
<tr><td>İstasyon gücü</td><td>${formatKwp(Number(station?.power_kw ?? 0))} kW</td></tr>
<tr><td>Besleme</td><td>${sarj.phase === "trifaze" ? "Trifaze, 5x6 mm² NYY" : "Monofaze, 3x6 mm² NYY"}</td></tr>
<tr><td>Montaj</td><td>${sarj.withStand ? "Ayaklı (stand)" : "Duvar tipi"}</td></tr>
${sarj.connectionPowerKw > 0 ? `<tr><td>Bina bağlantı gücü</td><td>${formatKwp(sarj.connectionPowerKw)} kW</td></tr>` : ""}
</tbody></table>`
      : "";
    pages.push(`<section class="page">${header("Bölüm 01", "Teknik tasarım ve kapasite", input.logoUrl)}
${chart}
${hasGes ? `<h2>Sistem tasarım parametreleri</h2><div class="two">${[params.slice(0, Math.ceil(params.length / 2)), params.slice(Math.ceil(params.length / 2))].map((part) => `<table class="params"><tbody>${part.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</tbody></table>`).join("")}</div>` : ""}
${sarjBlock}
${hasGes ? `<div class="note"><b>Şebeke bağlantısı:</b> Sistem lisanssız üretim mevzuatı kapsamında şebekeye bağlanır. Kurulu AC güç, tüketim tesisinin sözleşme gücü ile sınırlıdır; bağlantı, kabul ve sayaç işlemleri dağıtım şirketi süreçlerine tabidir.</div>` : ""}
${footer(input)}</section>`);
  }

  // 4) Malzeme listesi
  const moduleOrder: OfferModule[] = ["ges", "sarj", "taahhut", "genel"];
  const groups = moduleOrder
    .map((module) => ({
      module,
      rows: visible.filter((line) => line.module === module),
    }))
    .filter((group) => group.rows.length > 0);
  const notesHtml = `<div class="two"><div class="note blue"><b>Anahtar teslim kurulum:</b> Tüm yatay ve dikey taşıma, montaj, kablolama, test ve devreye alma işlemleri NES Enerji tarafından nitelikli personelle yapılır.</div><div class="note blue"><b>Garanti:</b> Ürünler üretici garanti koşullarına tabidir. Markalar stok durumuna göre muadili ile değişebilir.</div></div>`;
  const priceCols = input.showLinePrices;
  pages.push(`<section class="page">${header("Bölüm 02", "Detaylı malzeme ve hizmet listesi", input.logoUrl)}
${groups
  .map(
    (
      group,
    ) => `<h2>${esc(moduleTitles[group.module])}</h2><table class="compact"><thead><tr><th>Malzeme / hizmet</th><th>Marka</th><th class="r">Miktar</th>${priceCols ? `<th class="r">Birim fiyat</th><th class="r">Tutar</th>` : ""}</tr></thead><tbody>
${group.rows
  .map(
    (line) =>
      `<tr><td>${esc(line.description)}</td><td>${esc(line.brand ?? "NES Enerji")}</td><td class="r">${num(line.quantity)} ${esc(line.unit)}</td>${
        priceCols
          ? `<td class="r">${line.saleAmount > 0 ? formatMoney(line.saleAmount / line.quantity, currency) : "Dahil"}</td><td class="r">${line.saleAmount > 0 ? formatMoney(line.saleAmount, currency) : "Dahil"}</td>`
          : ""
      }</tr>`,
  )
  .join("")}
</tbody></table>`,
  )
  .join("")}
${hasGes || hasSarj ? "" : notesHtml}
${footer(input)}</section>`);

  // 5) Kapsam ve süreç
  if (hasGes || hasSarj) {
    const scope = [
      ...(hasGes ? gesScope.map((row) => ["GES", ...row] as const) : []),
      ...(hasSarj ? sarjScope.map((row) => ["Şarj", ...row] as const) : []),
    ];
    pages.push(`<section class="page">${header("Bölüm 03", "Hizmet kapsamı ve proje süreci", input.logoUrl)}
<table class="compact"><thead><tr><th>Kapsam</th>${hasGes && hasSarj ? "<th>Modül</th>" : ""}<th class="c">Dahil</th><th class="c">Hariç</th></tr></thead><tbody>
${scope
  .map(
    ([module, text, included]) =>
      `<tr><td>${esc(text)}</td>${hasGes && hasSarj ? `<td class="small muted">${module}</td>` : ""}<td class="c yes">${included ? "✓" : ""}</td><td class="c no">${included ? "" : "✕"}</td></tr>`,
  )
  .join("")}
</tbody></table>
${notesHtml}
${hasGes ? `<p class="small muted">Proje ve başvuru kalemleri şebekeye bağlı, mahsuplaşmalı sistemler için geçerlidir.</p><h2>Proje süreci</h2><div class="timeline">${gesProcess.map(([when, items]) => `<div><b>${when}</b><ul>${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul></div>`).join("")}</div>` : ""}
${footer(input)}</section>`);
  }

  // 6) Ticari koşullar
  const moduleTotals = groups.map((group) => ({
    module: group.module,
    total: group.rows.reduce((sum, line) => sum + line.saleAmount, 0),
  }));
  const termLines = input.terms
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  pages.push(`<section class="page">${header("Bölüm 04", "Ticari koşullar ve fiyat", input.logoUrl)}
<h2 style="margin-top:0">Yatırım bedeli</h2><div class="price">
${moduleTotals.map((row) => `<div><span>${esc(moduleTitles[row.module])} (anahtar teslim)</span><b>${formatMoney(row.total, currency)}</b></div>`).join("")}
${moduleTotals.length > 1 ? `<div><span>Ara toplam</span><b>${formatMoney(input.sale, currency)}</b></div>` : ""}
<div><span>KDV (%${num(input.vatRate * 100)})</span><b>${formatMoney(input.vat, currency)}</b></div>
<div class="total"><span>Genel toplam</span><span>${formatMoney(input.grandTotal, currency)}</span></div></div>
${input.paymentPlan.length ? `<h2>Ödeme takvimi</h2>${input.paymentPlan.map((step, index) => `<div class="pay"><div class="pct">%${num(step.percent)}</div><div class="what"><b>${index + 1}. ödeme</b><div class="small muted">${esc(step.label)}</div></div><div class="amt">${formatMoney((input.grandTotal * step.percent) / 100, currency)}</div></div>`).join("")}` : ""}
<h2>Koşul ve şartlar</h2><ul class="terms">${termLines.map((line) => `<li>${esc(line)}</li>`).join("")}
<li>İşbu teklif ${dateTr(input.validUntil)} tarihine kadar geçerlidir.</li>
${input.rates.USD > 0 || input.rates.EUR > 0 ? `<li>Hesaplamada kullanılan kurlar: ${[input.rates.USD > 0 ? `1 USD = ${num(input.rates.USD, 4)} TL` : "", input.rates.EUR > 0 ? `1 EUR = ${num(input.rates.EUR, 4)} TL` : ""].filter(Boolean).join(" · ")}.</li>` : ""}</ul>
<div class="note blue"><b>Banka bilgileri:</b> ${esc(NES_COMPANY.legalName)} · ${esc(NES_COMPANY.bank)} · IBAN ${esc(NES_COMPANY.iban)}</div>
${footer(input)}</section>`);

  // 7) Kapanış
  pages.push(
    `<section class="page closing"><img src="${esc(input.logoUrl)}" alt="NES Enerji" style="height:16mm;margin-bottom:14mm"><h1>Temiz enerji ile<br><b>geleceğe değer katın.</b></h1><hr><p class="muted">${esc(NES_COMPANY.legalName)}<br>${esc(NES_COMPANY.address)}<br>${esc(NES_COMPANY.phone)} · ${esc(NES_COMPANY.email)} · ${esc(NES_COMPANY.web)}</p></section>`,
  );

  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${esc(input.offerNo)} — ${esc(input.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700;800&display=swap" rel="stylesheet">
<style>${css}</style></head><body>${pages.join("\n")}</body></html>`;
}

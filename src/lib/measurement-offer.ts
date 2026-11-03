// Ölçüm ve periyodik kontrol raporlama teklifi: hesap ve 2 sayfalık belge.
//
// Kaynak: NES_Olcum_Raporlama_Teklifi_2026.xlsx ("Çalışma", "Teklif",
// "Şartlar" sayfaları). Birim fiyatlar TMMOB EMO 2026 Yılı En Az Ücretleri,
// Kısım V (Test ve Ölçüm Hizmetleri). Her kalemin iskontolu birimi Excel'deki
// gibi ROUND(birim × (1 − iskonto), 2), net tutar ROUND(miktar × birim, 2).
// Fiyat yılı değişince yalnız EMO_2026 tablosu güncellenir.

import {
  LETTERHEAD_PAGE_CSS,
  NES_COMPANY,
  letterheadHtml,
} from "@/lib/nes-company";

export const EMO_2026 = {
  agFixed: 7041,
  agPerPoint: 410,
  agPerPointOver50: 297,
  ygFixed: 10563,
  ygPerPoint: 645,
  lightningFixed: 10832,
  lightningPerExtra: 5282,
  /** Gözle kontrol, 500 m²'ye kadar sabit bedel; yapı sınıfı 1–5. */
  inspectionFixed: [5832, 9716, 17484, 26239, 42748],
  /** Gözle kontrol, 500 m²'den sonra artan her m²; yapı sınıfı 1–5. */
  inspectionPerM2: [6.43, 6.82, 7.14, 7.37, 7.89],
  rcdFixed: 6960,
  rcdPerExtra: 235,
  thermalFixed: 10563,
  thermalPerExtra: 645,
  insulationFixed: 11584,
  insulationPerExtra: 596,
  luxFixed: 6960,
  luxPerExtra: 235,
  survey: 6500,
} as const;

export type MeasurementOfferInput = {
  customerName: string;
  address: string;
  offerNo: string;
  /** YYYY-MM-DD */
  offerDate: string;
  validityDays: number;
  reportDays: number;
  /** 0.2 = %20 */
  vatRate: number;
  /** 0.5 = %50 */
  discount: number;
  areaM2: number;
  /** 1–5 */
  buildingClass: number;
  agPoints: number;
  ygPoints: number;
  lightningCount: number;
  rcdCount: number;
  thermalCount: number;
  insulationCount: number;
  luxCount: number;
  includeSurvey: boolean;
};

export type MeasurementLine = {
  group: 1 | 2 | 3 | 4 | 5;
  label: string;
  unit: string;
  qty: number;
  unitPrice: number;
  netUnit: number;
  list: number;
  net: number;
};

export type MeasurementGroup = {
  group: 1 | 2 | 3 | 4 | 5;
  service: string;
  scope: string;
  list: number;
  net: number;
};

export type MeasurementOfferResult = {
  lines: MeasurementLine[];
  groups: MeasurementGroup[];
  listTotal: number;
  netTotal: number;
  discountAmount: number;
  /** Ortalama iskonto oranı (0–1). */
  averageDiscount: number;
  vat: number;
  grandTotal: number;
};

export const GROUP_SERVICES: Record<MeasurementGroup["group"], string> = {
  1: "Topraklama ölçümü ve raporu",
  2: "Yıldırımdan korunma (paratoner) tesisatı kontrolü ve raporu",
  3: "Elektrik iç tesisatı uygunluk (periyodik kontrol) raporu",
  4: "Aydınlatma seviyesi (lux) ölçümü ve raporu",
  5: "Keşif",
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const whole = (n: number) =>
  Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;

export function defaultMeasurementOffer(
  now = new Date(),
): MeasurementOfferInput {
  const pad = (n: number) => String(n).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(2);
  return {
    customerName: "",
    address: "",
    offerNo: `NES-OLC-${yy}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`,
    offerDate: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    validityDays: 15,
    reportDays: 7,
    vatRate: 0.2,
    discount: 0.5,
    areaM2: 0,
    buildingClass: 1,
    agPoints: 0,
    ygPoints: 0,
    lightningCount: 0,
    rcdCount: 0,
    thermalCount: 0,
    insulationCount: 0,
    luxCount: 0,
    includeSurvey: false,
  };
}

export function calculateMeasurementOffer(
  input: MeasurementOfferInput,
): MeasurementOfferResult {
  const discount = Math.min(Math.max(input.discount || 0, 0), 1);
  const cls = Math.min(Math.max(Math.round(input.buildingClass || 1), 1), 5);
  const area = whole(input.areaM2);
  const ag = whole(input.agPoints);
  const yg = whole(input.ygPoints);
  const lightning = whole(input.lightningCount);
  const rcd = whole(input.rcdCount);
  const thermal = whole(input.thermalCount);
  const insulation = whole(input.insulationCount);
  const lux = whole(input.luxCount);
  const E = EMO_2026;

  const raw: Array<[MeasurementLine["group"], string, string, number, number]> =
    [
      [
        1,
        "AG topraklama ölçümü — 3 ölçüme kadar",
        "Sabit",
        ag > 0 ? 1 : 0,
        E.agFixed,
      ],
      [
        1,
        "AG topraklama — artan her ölçüm (4.–50. nokta)",
        "Ölçüm",
        Math.max(0, Math.min(ag, 50) - 3),
        E.agPerPoint,
      ],
      [
        1,
        "AG topraklama — artan her ölçüm (51. noktadan sonra)",
        "Ölçüm",
        Math.max(0, ag - 50),
        E.agPerPointOver50,
      ],
      [
        1,
        "YG topraklama ölçümü — 3 ölçüme kadar",
        "Sabit",
        yg > 0 ? 1 : 0,
        E.ygFixed,
      ],
      [
        1,
        "YG topraklama — artan her ölçüm",
        "Ölçüm",
        Math.max(0, yg - 3),
        E.ygPerPoint,
      ],
      [
        2,
        "Yıldırımdan korunma tesisat kontrolü — 1 tesisat",
        "Sabit",
        lightning > 0 ? 1 : 0,
        E.lightningFixed,
      ],
      [
        2,
        "Yıldırımdan korunma — artan her tesisat",
        "Tesisat",
        Math.max(0, lightning - 1),
        E.lightningPerExtra,
      ],
      [
        3,
        `AG tesisat denetimi (gözle kontrol) — 500 m²'ye kadar, ${cls}. sınıf`,
        "Sabit",
        area > 0 ? 1 : 0,
        E.inspectionFixed[cls - 1],
      ],
      [
        3,
        "AG tesisat denetimi — 500 m²'den sonra artan her m²",
        "m²",
        Math.max(0, area - 500),
        E.inspectionPerM2[cls - 1],
      ],
      [
        3,
        "Kaçak akım rölesi (RCD) testi — 3 ölçüme kadar",
        "Sabit",
        rcd > 0 ? 1 : 0,
        E.rcdFixed,
      ],
      [
        3,
        "RCD testi — artan her ölçüm",
        "Ölçüm",
        Math.max(0, rcd - 3),
        E.rcdPerExtra,
      ],
      [
        3,
        "Termal kamera ile ölçüm — 3 ölçüme kadar",
        "Sabit",
        thermal > 0 ? 1 : 0,
        E.thermalFixed,
      ],
      [
        3,
        "Termal kamera — artan her ölçüm",
        "Ölçüm",
        Math.max(0, thermal - 3),
        E.thermalPerExtra,
      ],
      [
        3,
        "Yalıtım (izolasyon) direnci ölçümü — 3 ölçüme kadar",
        "Sabit",
        insulation > 0 ? 1 : 0,
        E.insulationFixed,
      ],
      [
        3,
        "Yalıtım direnci — artan her ölçüm",
        "Ölçüm",
        Math.max(0, insulation - 3),
        E.insulationPerExtra,
      ],
      [
        4,
        "Aydınlatma seviyesi (lux) ölçümü — 3 ölçüme kadar",
        "Sabit",
        lux > 0 ? 1 : 0,
        E.luxFixed,
      ],
      [
        4,
        "Aydınlatma seviyesi — artan her ölçüm",
        "Ölçüm",
        Math.max(0, lux - 3),
        E.luxPerExtra,
      ],
      [
        5,
        "Test ölçüm keşif bedeli",
        "Sabit",
        input.includeSurvey ? 1 : 0,
        E.survey,
      ],
    ];

  const lines: MeasurementLine[] = raw.map(
    ([group, label, unit, qty, unitPrice]) => {
      const netUnit = round2(unitPrice * (1 - discount));
      return {
        group,
        label,
        unit,
        qty,
        unitPrice,
        netUnit,
        list: round2(qty * unitPrice),
        net: round2(qty * netUnit),
      };
    },
  );

  const scopeParts3 = [
    area > 0 ? `${area} m², ${cls}. sınıf` : "",
    rcd > 0 ? "RCD" : "",
    thermal > 0 ? "termal kamera" : "",
    insulation > 0 ? "yalıtım direnci" : "",
  ].filter(Boolean);
  const scopes: Record<MeasurementGroup["group"], string> = {
    1:
      ag + yg === 0
        ? "-"
        : `${[ag > 0 ? `${ag} AG` : "", yg > 0 ? `${yg} YG` : ""].filter(Boolean).join(" + ")} ölçüm noktası`,
    2: lightning === 0 ? "-" : `${lightning} tesisat`,
    3: scopeParts3.length ? scopeParts3.join("; ") : "-",
    4: lux === 0 ? "-" : `${lux} ölçüm noktası`,
    5: input.includeSurvey ? "Test ölçüm keşfi" : "-",
  };

  const groups = ([1, 2, 3, 4, 5] as const).map((group) => {
    const own = lines.filter((l) => l.group === group);
    return {
      group,
      service: GROUP_SERVICES[group],
      scope: scopes[group],
      list: round2(own.reduce((s, l) => s + l.list, 0)),
      net: round2(own.reduce((s, l) => s + l.net, 0)),
    };
  });

  const listTotal = round2(lines.reduce((s, l) => s + l.list, 0));
  const netTotal = round2(lines.reduce((s, l) => s + l.net, 0));
  const vat = round2(netTotal * (input.vatRate || 0));
  return {
    lines,
    groups,
    listTotal,
    netTotal,
    discountAmount: round2(listTotal - netTotal),
    averageDiscount: listTotal === 0 ? 0 : 1 - netTotal / listTotal,
    vat,
    grandTotal: round2(netTotal + vat),
  };
}

// ---------------------------------------------------------------- belge

const esc = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const money = (n: number) =>
  new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);

const pct = (n: number) =>
  new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(n * 100);

function trDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}.${m}.${y}` : iso;
}

/** Ek-1 maddeleri (Excel "Şartlar" sayfası; Ek-2 PDF'e girmediği için
 *  Ek-2 atıfları EMO 2026 birim fiyatlarına yönlendirildi). */
export const MEASUREMENT_TERMS: Array<{ title: string; items: string[] }> = [
  {
    title: "1. Hizmet kapsamı",
    items: [
      "Topraklama ölçümü: AG/YG topraklama, çevrim/hat empedansı ve süreklilik ölçümleri; ölçüm sonuçlarının değerlendirilmesi ve raporlanması.",
      "Yıldırımdan korunma tesisatı: paratoner/Faraday tesisatının gözle kontrolü, iniş iletkenleri ve topraklama ölçümleri, uygunluk raporu.",
      "Elektrik iç tesisatı uygunluk (periyodik kontrol): gözle kontrol, kaçak akım (RCD) testleri, termal kamera kontrolü, gerektiğinde yalıtım direnci ölçümü; TS HD 60364-6'ya göre doğrulama.",
      "Aydınlatma seviyesi: çalışma alanlarında lux ölçümü ve TS EN 12464-1 değerleriyle karşılaştırmalı rapor.",
      "Kontroller sonucunda tespit edilen uygunsuzlukların giderilmesi (onarım, malzeme, işçilik) bu teklif kapsamında değildir; talep hâlinde ayrıca fiyatlandırılır.",
    ],
  },
  {
    title: "2. Ödeme ve uygulama koşulları",
    items: [
      "Teklifin onaylanmasının ardından fatura düzenlenir ve ödeme gerçekleşir.",
      "Ödemenin gerçekleşmesiyle saha planlaması yapılır ve iş, iş planına alınır; ölçüm tarihi müşteriyle birlikte belirlenir.",
      "İşe başlamadan önce fatura bilgileri ve konum bilgileri 0554 610 24 16 numaralı telefonla paylaşılacaktır.",
      "Raporlar, ölçümün tamamlanmasından sonra teklifte belirtilen süre içinde elektronik ortamda ve imzalı olarak teslim edilir.",
      "Ölçüm süresi hava koşullarına ve sahanın durumuna göre değişebilir; sahada çalışılabilir koşulların ve yetkili bir refakatçinin sağlanması müşterinin sorumluluğundadır.",
      "Ölçüm için gerekli kısa süreli enerji kesintileri müşterinin onayıyla ve planlı olarak yapılır.",
    ],
  },
  {
    title: "3. Artan ve azalan işler",
    items: [
      "Sahada teklifte öngörülenden fazla veya az ölçüm noktası, alan ya da tesisat çıkması hâlinde bedel, EMO 2026 Test ve Ölçüm Hizmetleri birim fiyatları üzerinden teklifteki iskonto oranı uygulanarak yeniden hesaplanır.",
      "Uygunsuzluk giderildikten sonra tekrar ölçüm istenmesi hâlinde EMO esaslarına göre ilgili bedelin %50'si uygulanır.",
      "Muğla il sınırları dışındaki işlerde yol, konaklama ve iaşe giderleri ayrıca faturalandırılır.",
    ],
  },
  {
    title: "4. Uygulanacak mevzuat",
    items: [
      "6331 sayılı İş Sağlığı ve Güvenliği Kanunu.",
      "İş Ekipmanlarının Kullanımında Sağlık ve Güvenlik Şartları Yönetmeliği (periyodik kontrol esasları).",
      "Elektrik Tesislerinde Topraklamalar Yönetmeliği (RG 21.08.2001, sayı 24500).",
      "Elektrik İç Tesisleri Yönetmeliği ve Elektrik Kuvvetli Akım Tesisleri Yönetmeliği.",
      "İşyeri Bina ve Eklentilerinde Alınacak Sağlık ve Güvenlik Önlemlerine İlişkin Yönetmelik (aydınlatma).",
      "Binaların Yangından Korunması Hakkında Yönetmelik.",
      "1 Eylül 2025'ten itibaren zorunlu olan, Çalışma ve Sosyal Güvenlik Bakanlığınca yayımlanan elektrik tesisatı, topraklama ve yıldırımdan korunma tesisatı periyodik kontrol rapor formatları.",
      "TMMOB Elektrik Mühendisleri Odası 2026 Yılı En Az Ücretleri ve periyodik kontrol kriterleri.",
    ],
  },
  {
    title: "5. Standartlar",
    items: [
      "TS HD 60364 serisi (alçak gerilim elektrik tesisleri), özellikle TS HD 60364-6 (doğrulama) ve TS HD 60364-4-41 (elektrik çarpmasına karşı koruma).",
      "TS EN 62305 serisi (yıldırımdan korunma).",
      "TS EN 12464-1 (iç mekân çalışma alanlarının aydınlatılması).",
      "TS EN 61008-1 / TS EN 61009-1 (artık akımla çalışan devre kesiciler).",
      "TS EN 61557 serisi (ölçüm, test ve izleme cihazları).",
    ],
  },
  {
    title: "6. Raporlama",
    items: [
      "Raporlar, Bakanlık rapor formatlarında ve ölçümü yapan yetkin mühendisin imzasıyla düzenlenir; kullanılan cihazların kalibrasyon bilgileri raporda yer alır.",
      "Raporların Bakanlık denetimine sunulabilmesi için ölçüm öncesinde İSG-KATİP üzerinden NES Enerji'ye talep oluşturulması gerekir.",
      "Tespit edilen uygunsuzluklar raporda öncelik derecesiyle belirtilir; giderilmesi için öneri sunulur.",
    ],
  },
  {
    title: "7. Genel şartlar",
    items: [
      "Fiyatlar Türk Lirası cinsinden olup KDV hariçtir; KDV ayrıca faturalandırılır.",
      "Teklif, teklif tarihinden itibaren belirtilen süre boyunca geçerlidir.",
      "Teklifin yazılı onayı, bu şartlarla birlikte taraflar arasında sözleşme hükmündedir.",
      "Uyuşmazlıklarda Muğla Mahkemeleri ve İcra Daireleri yetkilidir.",
    ],
  },
];

/** Tam iki A4 sayfa: 1) Teklif, 2) Ek-1 Şartlar ve Yönetmelikler. */
export function measurementOfferHtml(
  input: MeasurementOfferInput,
  result: MeasurementOfferResult,
  origin: string,
): string {
  const logoUrl = `${origin}${NES_COMPANY.logoPath}`;
  const title = `${input.offerNo} · Ölçüm teklifi`;
  const rows = result.groups.filter((g) => g.net > 0 || g.list > 0);
  const tableRows = rows
    .map(
      (g, i) =>
        `<tr><td class="c">${i + 1}</td><td>${esc(g.service)}</td><td>${esc(g.scope)}</td><td class="r">${money(g.net)}</td></tr>`,
    )
    .join("");
  const payment = [
    "Teklifin onaylanmasının ardından fatura düzenlenir; ödeme gerçekleşir.",
    "Ödemenin gerçekleşmesiyle saha planlaması yapılır ve iş, iş planına alınır.",
    `Ölçümler planlanan tarihte yapılır; raporlar ölçümden sonra ${input.reportDays} iş günü içinde teslim edilir.`,
    "İşe başlamadan önce fatura bilgileri ve konum bilgileri 0554 610 24 16 numaralı telefonla paylaşılacaktır.",
    "Artan ve azalan işler ile ölçümler, EMO 2026 birim fiyatları üzerinden bu teklifteki iskonto oranıyla hesaplanır.",
    "Uygulanacak yönetmelikler, standartlar ve genel şartlar Ek-1'dedir; bu teklifin onayı Ek-1 şartlarının kabulü anlamına gelir.",
  ];
  const terms = MEASUREMENT_TERMS.map(
    (section) =>
      `<h3>${esc(section.title)}</h3><ul>${section.items.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`,
  ).join("");

  return `<!doctype html><html lang="tr"><head><meta charset="utf-8">
<title>${esc(input.offerNo)} Ölçüm Teklifi</title>
<style>
*{box-sizing:border-box}
html,body{margin:0;background:#e6eaeb;font-family:Arial,Helvetica,sans-serif;color:#1d2a2e}
@page{size:A4;margin:0}
.page{width:210mm;height:297mm;margin:10mm auto;background:#fff;position:relative;overflow:hidden;break-after:page;page-break-after:always}
.page:last-child{break-after:auto;page-break-after:auto}
@media print{html,body{background:#fff}.page{margin:0}}
@media screen{.page{box-shadow:0 6px 30px rgba(20,40,40,.15)}}
${LETTERHEAD_PAGE_CSS}
.body{padding:27mm 16mm 24mm;font-size:8.6pt;line-height:1.42}
h1{margin:0;font-size:15pt;letter-spacing:.01em;color:#0f4c4c}
.sub{margin:1mm 0 4mm;font-size:8.2pt;color:#4b5b60}
.meta{width:100%;border-collapse:collapse;margin-bottom:3.5mm}
.meta td{padding:1mm 0;vertical-align:top}
.meta td:first-child{width:30mm;color:#4b5b60}
.meta td:last-child{font-weight:bold}
.intro{margin:0 0 3.5mm}
table.lines{width:100%;border-collapse:collapse}
table.lines th{background:#0f4c4c;color:#fff;font-size:7.8pt;text-align:left;padding:1.8mm 2mm}
table.lines td{border-bottom:.4pt solid #cfd8da;padding:1.8mm 2mm;vertical-align:top}
.c{text-align:center;width:8mm}.r{text-align:right;white-space:nowrap;width:34mm}
table.totals{width:62%;margin:2.5mm 0 0 auto;border-collapse:collapse}
table.totals td{padding:1.2mm 2mm}
table.totals td:last-child{text-align:right;white-space:nowrap}
table.totals tr.muted td{color:#4b5b60}
table.totals tr.grand td{background:#0f4c4c;color:#fff;font-weight:bold;font-size:9.6pt}
h2{font-size:9.6pt;margin:5mm 0 1.5mm;color:#0f4c4c}
ol{margin:0;padding:0;list-style:none;counter-reset:pay}ol li{position:relative;margin:.6mm 0;padding-left:5mm;counter-increment:pay}ol li::before{content:counter(pay) ".";position:absolute;left:0;top:0}
.sign{display:flex;gap:10mm;margin-top:6mm}
.sign div{flex:1;border-top:.6pt solid #1d2a2e;padding-top:1.5mm;font-size:7.8pt;min-height:22mm}
.sign b{display:block;margin-bottom:1mm}
.terms{font-size:7.6pt;line-height:1.36}
.terms h3{font-size:8.4pt;margin:2.6mm 0 .8mm;color:#0f4c4c}
.terms ul{margin:0;padding:0;list-style:none}.terms li{position:relative;margin:.35mm 0;padding-left:4mm}.terms li::before{content:"•";position:absolute;left:.8mm;top:0}
.accept{margin-top:4mm;border-top:.6pt solid #1d2a2e;padding-top:1.6mm;font-size:7.8pt;min-height:16mm}
</style></head><body>
<section class="page lh">
${letterheadHtml({ logoUrl, title, footLeft: esc(trDate(input.offerDate)), pageLabel: "Sayfa 1 / 2" })}
<div class="body">
<h1>FİYAT TEKLİFİ</h1>
<p class="sub">Ölçüm ve periyodik kontrol raporlama hizmetleri · Topraklama, yıldırımdan korunma, elektrik iç tesisat uygunluk, aydınlatma (lux)</p>
<table class="meta">
<tr><td>Sayın</td><td>${esc(input.customerName || "-")}</td></tr>
<tr><td>Tesis adresi</td><td>${esc(input.address || "-")}</td></tr>
<tr><td>Teklif no</td><td>${esc(input.offerNo)}</td></tr>
<tr><td>Teklif tarihi</td><td>${esc(trDate(input.offerDate))}</td></tr>
<tr><td>Geçerlilik</td><td>${input.validityDays} gün</td></tr>
</table>
<p class="intro">Tesisinizde yapılacak ölçüm ve periyodik kontrol hizmetlerine ait fiyat teklifimiz aşağıdadır. Ölçümler şirketimiz bünyesindeki yetkin mühendislerce, kalibrasyonlu cihazlarla yapılır ve raporlar Çalışma ve Sosyal Güvenlik Bakanlığı rapor formatlarına uygun olarak düzenlenir.</p>
<table class="lines"><thead><tr><th class="c">No</th><th>Hizmet</th><th>Kapsam</th><th class="r">Tutar (TL, KDV hariç)</th></tr></thead>
<tbody>${tableRows || `<tr><td colspan="4">Kalem seçilmedi.</td></tr>`}</tbody></table>
<table class="totals">
<tr class="muted"><td>EMO 2026 liste bedeli</td><td>${money(result.listTotal)}</td></tr>
<tr class="muted"><td>İskonto (%${pct(result.averageDiscount)})</td><td>-${money(result.discountAmount)}</td></tr>
<tr><td><b>Toplam (KDV hariç)</b></td><td><b>${money(result.netTotal)}</b></td></tr>
<tr class="muted"><td>KDV (%${pct(input.vatRate)})</td><td>${money(result.vat)}</td></tr>
<tr class="grand"><td>GENEL TOPLAM (KDV DAHİL)</td><td>${money(result.grandTotal)} TL</td></tr>
</table>
<h2>Ödeme ve uygulama</h2>
<ol>${payment.map((p) => `<li>${esc(p)}</li>`).join("")}</ol>
<div class="sign">
<div><b>${esc(NES_COMPANY.legalNameShort)}</b>Kaşe / İmza</div>
<div><b>TEKLİF ONAYI (Müşteri)</b>Ad Soyad:<br><br>Tarih / Kaşe / İmza:</div>
</div>
</div>
</section>
<section class="page lh">
${letterheadHtml({ logoUrl, title, footLeft: esc(trDate(input.offerDate)), pageLabel: "Sayfa 2 / 2" })}
<div class="body terms">
<h1>EK-1 · ŞARTLAR, YÖNETMELİKLER VE STANDARTLAR</h1>
<p class="sub">${esc(input.offerNo)} numaralı teklifin ekidir.</p>
${terms}
<div class="accept">Teklifi kabul eden (Müşteri) — Ad Soyad / Tarih / Kaşe / İmza:</div>
</div>
</section>
</body></html>`;
}

/** Dosya adı yalnız ASCII: bazı tarayıcılar Türkçe harfli indirme adını
 *  "download" olarak kaydediyor. */
export function measurementOfferFileName(input: MeasurementOfferInput) {
  const ascii = (v: string) =>
    v
      .replace(/[çÇ]/g, (c) => (c === "ç" ? "c" : "C"))
      .replace(/[ğĞ]/g, (c) => (c === "ğ" ? "g" : "G"))
      .replace(/ı/g, "i")
      .replace(/İ/g, "I")
      .replace(/[öÖ]/g, (c) => (c === "ö" ? "o" : "O"))
      .replace(/[şŞ]/g, (c) => (c === "ş" ? "s" : "S"))
      .replace(/[üÜ]/g, (c) => (c === "ü" ? "u" : "U"))
      .replace(/[^\w-]+/g, "_")
      .replace(/^_+|_+$/g, "");
  const name = ascii(input.customerName || "").slice(0, 50) || "Musteri";
  const no = ascii(input.offerNo || "") || "NES-OLC";
  return `${no}_Olcum_Teklifi_${name}.pdf`;
}

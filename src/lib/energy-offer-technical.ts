// "Teknik ve Ticari Teklif" düzeni (NES-TKF-061026-01 Algı GES ENH teklifi
// örnek alınmıştır). Büyük taahhüt / OG bağlantı işleri için Word tarzı,
// akışkan sayfalı belge: kapak, giriş yazısı, teklif özeti, NES Grup hakkında,
// proje tanımı ve teknik veriler, iş kapsamı ve metodoloji, iş programı
// (Gantt), fiyat teklifi + ödeme planı + ticari şartlar, kalite/İSG/garanti,
// referanslar, iletişim ve onay, Ek-1 birim fiyat cetveli.

import type { OfferDocumentInput } from "@/lib/energy-offer-document";
import { NES_COMPANY, NES_CONTACT_LINE } from "@/lib/nes-company";
import type {
  CatalogItem,
  Currency,
  PricedLine,
  TechnicalContent,
} from "@/lib/energy-offer";

const esc = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const num = (value: number, digits = 2) =>
  new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);

const qty = (value: number) =>
  new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(value);

const curLabel = (currency: Currency) => (currency === "TRY" ? "TL" : currency);

const dateDots = (value: Date) =>
  `${String(value.getDate()).padStart(2, "0")}.${String(value.getMonth() + 1).padStart(2, "0")}.${value.getFullYear()}`;

function daysBetween(from: Date, to: string | null) {
  if (!to) return null;
  const end = new Date(to);
  const ms = end.getTime() - new Date(from.toDateString()).getTime();
  return Math.max(0, Math.round(ms / 86400000));
}

const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

/** "Başlık: açıklama" satırını ayırır; iki nokta yoksa başlık boş döner. */
function splitPair(line: string): [string, string] {
  const index = line.indexOf(":");
  if (index <= 0 || index > 60) return ["", line];
  return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
}

const bullets = (items: string[]) =>
  `<ul>${items
    .map((item) => {
      const [head, body] = splitPair(item);
      return `<li>${head ? `<b>${esc(head)}:</b> ${esc(body)}` : esc(body)}</li>`;
    })
    .join("")}</ul>`;

// ---------------------------------------------------------------- NES sabit metinleri
const brands: [string, string][] = [
  [
    "nesenerji",
    "Güneş enerji santralleri (çatı, arazi, hibrit ve off-grid), depolama sistemleri",
  ],
  ["nesşarj", "Elektrikli araç şarj istasyonu altyapısı ve kurulumu"],
  [
    "nesproje",
    "Elektrik iç tesisat, GES, OG/AG ve topraklama projelendirme; statik ve TEDAŞ/EDAŞ onayları",
  ],
  [
    "nestaahhüt",
    "Elektrik taahhüt, şantiye elektriği, OG bağlantı hatları, dağıtım merkezleri, pano ve kablolama",
  ],
  [
    "neskontrol",
    "Fenni mesuliyet, ölçüm, test, periyodik kontrol ve kabul hizmetleri",
  ],
];
const brandColors: Record<string, string> = {
  enerji: "#0046a4",
  şarj: "#8cc63f",
  proje: "#ed1c24",
  taahhüt: "#f48220",
  kontrol: "#662d91",
};

const whyNes = [
  "Yerel süreç hâkimiyeti: ADM EDAŞ bölgesinde çağrı mektubu, proje onayı, bağlantı anlaşması ve geçici kabul süreçlerini düzenli yürütüyoruz.",
  "Sahaya yakınlık: Menteşe merkezli ekibimizle hızlı mobilizasyon, sahada sürekli şantiye şefi ve kısa müdahale süresi sağlıyoruz.",
  "Tek muhatap: Projelendirme, taahhüt ve kontrol aynı çatı altında olduğu için arayüz kaybı ve kabul revizyonu riski düşük kalıyor.",
  "GES tecrübesi: GES tarafındaki tecrübemiz sayesinde santral sahası, trafo ve bağlantı hattı arasındaki koordinasyonu baştan planlıyoruz.",
];

const quality: [string, string][] = [
  [
    "Kalite",
    "Malzeme kabul kontrolü, üretici test sertifikaları, montaj kontrol formları, ölçüm ve test protokolleri ile kayıt altında uygulama",
  ],
  [
    "İSG",
    "Proje özel İSG planı, risk değerlendirmesi, YG çalışma izin ve kilitleme-etiketleme prosedürü, yüksekte çalışma ve kazı güvenliği",
  ],
  [
    "Raporlama",
    "Haftalık ilerleme raporu ve fotoğraflı saha kayıtları; kritik aşamalarda işveren bilgilendirmesi",
  ],
  [
    "Dokümantasyon",
    "As-built proje, test raporları, malzeme sertifikaları ve kabul dosyasının dijital ve basılı teslimi",
  ],
];

const references: [string, string, string, string, string][] = [
  [
    "Elektrik taahhüt",
    "3 villalık konut projesi elektrik işleri",
    "Düğerek / Menteşe",
    "2025",
    "Şantiye elektrik projesi ve ADM onayı, temel topraklama, sıva altı tesisat, EV şarj ve akıllı ev altyapısı",
  ],
  [
    "Endüstriyel",
    "Çalcalar Gıda – laboratuvar ve kazan dairesi",
    "Muğla",
    "2026",
    "Kablo tavası, dağıtım ve mekanik panolar, UPS/data altyapısı, kazan dairesi güç ve kontrol kablolaması",
  ],
  [
    "Kurumsal GES",
    "DG Otomotiv – hibrit depolamalı GES",
    "Muğla",
    "2026",
    "22,5 kWp DC / 20 kWe AC, 20 kWh BYD batarya, Deye hibrit inverter, statik ve elektrik projesi",
  ],
  [
    "Çatı GES",
    "Ünver İnşaat – çatı üstü mahsuplaşmalı GES",
    "Emirbeyazıt / Menteşe",
    "2026",
    "14 kWp, Huawei inverter; çağrı mektubu, TEDAŞ projesi, kurulum ve kabul",
  ],
  [
    "Çatı GES",
    "Has Yapı – çatı üstü mahsuplaşmalı GES",
    "Ortaköy / Menteşe",
    "2025",
    "12 kWp DC / 12 kWe AC, Fronius Symo; anahtar teslim proje ve kurulum",
  ],
  [
    "Off-grid GES",
    "İnşaat şantiyesi off-grid depolamalı GES",
    "Muğla",
    "2026",
    "11,8 kWp, şantiye yükünü besleyen inverter ve batarya grubu, saha konstrüksiyonu ve beton işleri",
  ],
  [
    "Konut GES",
    "Konut çatı GES'leri (mahsuplaşmalı, öztüketim, depolamalı)",
    "Şirinköy, Yeniköy, Ortaköy, Köprübaşı, Cedit",
    "2025–2026",
    "7–12 kWp sistemler; Fronius, Huawei, SolarEdge, Deye; Jinko, CWT, Viessmann paneller",
  ],
];

const competencies = [
  "EDAŞ/TEDAŞ süreçleri: Çağrı mektubu, bağlantı anlaşması, TEDAŞ elektrik projesi, statik proje ve itfaiye uygunluk süreçleri",
  "GES ve depolama: Şebekeye bağlı, öztüketim, hibrit ve off-grid sistemler; Fronius, Huawei, SolarEdge, Deye, BYD",
  "Endüstriyel elektrik: Kablo tavası, dağıtım panoları, mekanik ekipman besleme ve kontrol, UPS/data altyapısı",
  "Bina elektriği: Temel topraklama, şantiye elektriği, sıva altı tesisat, EV şarj ve akıllı ev altyapısı",
];

// ---------------------------------------------------------------- stil
const css = `
@page{size:A4;margin:0 17mm}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font-family:"Carlito","Calibri",Arial,sans-serif;font-size:10.5pt;line-height:1.38;color:#1a1a1a;-webkit-print-color-adjust:exact;print-color-adjust:exact}
:root{--blue:#0046a4;--soft:#eef3fa;--line:#c9d4e5;--orange:#f48220;--muted:#5f6b7a}
.wrap{width:100%;border-collapse:collapse}
.wrap>thead td{height:24mm;padding:0}.wrap>tfoot td{height:17mm;padding:0}
.wrap>tbody>tr>td{padding:0}
.run-head,.run-foot{position:fixed;left:0;right:0;z-index:1;background:#fff}
/* NES anteti: sağ üstte logo ve ince çizgi, altta çizgi ve adres/iletişim,
   sayfa ortasında soluk logo filigranı (yazdırılan her sayfada tekrarlanır). */
.run-head{top:0;height:20mm;display:flex;justify-content:space-between;align-items:flex-end;padding-bottom:2mm;border-bottom:.6pt solid #222}
.run-head img{height:10mm}
.run-head span{font-size:7.5pt;color:#666}
.run-foot{bottom:0;height:14mm;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:7pt;line-height:1.45;color:#333;border-top:.6pt solid #222}
.run-mark{position:fixed;left:50%;top:50%;width:150mm;transform:translate(-50%,-50%);opacity:.13;z-index:-1;pointer-events:none}
@media screen{
  body{background:#e9edf3}
  .run-head,.run-foot,.run-mark{display:none}
  .sheet{width:210mm;margin:8mm auto;background:#fff;padding:12mm 17mm;box-shadow:0 6px 30px rgba(20,40,80,.12)}
  .wrap>thead td,.wrap>tfoot td{height:0}
}
.cover{position:relative;z-index:2;background:#fff;margin-top:-24mm;padding-top:22mm;min-height:260mm;break-after:page;page-break-after:always}
@media screen{.cover{margin-top:0;padding-top:4mm;min-height:0;border-bottom:1px dashed #ccc;margin-bottom:10mm;padding-bottom:10mm}}
.cover .logo{height:26mm}
.kicker{color:var(--orange);font-weight:700;font-size:11pt;margin:30mm 0 4mm;text-transform:uppercase}
.cover h1{color:var(--blue);font-size:24pt;line-height:1.28;margin:0 0 7mm}
.cover .subtitle{color:var(--muted);font-size:12pt;margin-bottom:22mm}
.cover .brands{margin-top:14mm;height:8mm}
table.info{width:100%;border-collapse:collapse;font-size:9.5pt}
table.info td{border:1px solid var(--line);padding:1.6mm 2.4mm;vertical-align:top}
table.info td:first-child{background:var(--soft);font-weight:700;width:31%}
.page-break{break-before:page;page-break-before:always}
h2{color:var(--blue);font-size:15pt;margin:7mm 0 3mm;break-after:avoid}
h3{color:var(--blue);font-size:12pt;margin:5mm 0 2mm;break-after:avoid}
p{margin:0 0 3mm;text-align:left}
ul{margin:0 0 3mm;padding-left:5mm}li{margin-bottom:1.3mm}
ol{margin:0 0 3mm;padding-left:5mm}ol li{margin-bottom:1.6mm}
table.grid{width:100%;border-collapse:collapse;font-size:9.3pt;margin-bottom:3mm}
table.grid th{background:var(--blue);color:#fff;text-align:left;padding:1.6mm 2.2mm;font-weight:700;border:1px solid var(--blue)}
table.grid td{border:1px solid var(--line);padding:1.4mm 2.2mm;vertical-align:top}
table.grid td.r,table.grid th.r{text-align:right;white-space:nowrap}
table.grid td.c,table.grid th.c{text-align:center}
table.grid tr{break-inside:avoid}
table.grid tr.group td{background:var(--soft);font-weight:700;color:var(--blue)}
table.grid tr.total td{font-weight:700}
table.grid tr.grand td{background:var(--blue);color:#fff;font-weight:700}
.cards{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--blue);margin:2mm 0 4mm}
.cards div{text-align:center;border-right:1px solid var(--line)}
.cards div:last-child{border-right:none}
.cards span{display:block;background:var(--blue);color:#fff;font-weight:700;font-size:9pt;padding:1.4mm}
.cards b{display:block;color:var(--blue);font-size:13pt;padding:2.4mm 1mm}
.flow{display:flex;gap:2mm;margin:2mm 0 4mm}
.flow div{flex:1;border:1px solid var(--line);font-size:8.5pt;text-align:center}
.flow div b{display:block;background:var(--blue);color:#fff;padding:1.2mm}
.flow div span{display:block;padding:1.6mm}
.gantt{width:100%;border-collapse:collapse;font-size:8.5pt}
.gantt th{background:var(--blue);color:#fff;border:1px solid #fff;padding:1.2mm;font-weight:700}
.gantt td{border:1px solid var(--line);height:7mm;padding:0 1.6mm}
.gantt td.on{background:var(--blue)}.gantt td.on.m{background:var(--orange)}
.legend{font-size:8pt;color:var(--muted);margin:1.5mm 0 3mm}
.sign{display:grid;grid-template-columns:1fr 1fr;gap:0;border:1px solid var(--line);margin-top:4mm;break-inside:avoid}
.sign div{padding:2.4mm 3mm;border-right:1px solid var(--line)}
.sign div:last-child{border-right:none}
.sign b{display:block;background:var(--soft);margin:-2.4mm -3mm 2mm;padding:1.6mm 3mm}
.sign p{margin:0 0 6mm}
.annex{break-before:page;page-break-before:always}
.keep{break-inside:avoid;page-break-inside:avoid}
.small{font-size:9pt;color:#333}
`;

type Group = { key: string; title: string; lines: PricedLine[] };

function groupTitle(line: PricedLine, catalog: CatalogItem[]) {
  const item = catalog.find((entry) => entry.id === line.catalogItemId);
  if (line.module === "taahhut" && item?.category) {
    // Birim fiyat kütüphanesindeki "A ŞANTİYE" gibi kategorilerden harfi at.
    return item.category
      .replace(/^[A-Z]\s+/, "")
      .toLocaleLowerCase("tr-TR")
      .replace(/^\p{L}/u, (c) => c.toLocaleUpperCase("tr-TR"));
  }
  return (
    {
      ges: "Güneş enerji sistemi",
      sarj: "Elektrikli araç şarj sistemi",
      taahhut: "Elektrik taahhüt işleri",
      genel: "Genel giderler ve diğer işler",
    } as const
  )[line.module];
}

function groupsOf(input: OfferDocumentInput): Group[] {
  const visible = input.lines.filter((line) => line.visibleToCustomer);
  const map = new Map<string, Group>();
  for (const line of visible) {
    const title = groupTitle(line, input.catalog);
    const group = map.get(title) ?? { key: title, title, lines: [] };
    group.lines.push(line);
    map.set(title, group);
  }
  // "Genel giderler" en sona.
  return [...map.values()].sort(
    (a, b) =>
      Number(a.title.startsWith("Genel")) - Number(b.title.startsWith("Genel")),
  );
}

const letter = (index: number) => String.fromCharCode(65 + index);

function parseSchedule(text: string, weeks: number) {
  return lines(text).map((row) => {
    const [task, range = "", kind = ""] = row
      .split("|")
      .map((part) => part.trim());
    const match = range.match(/(\d+)\s*[-–]\s*(\d+)/) ?? range.match(/(\d+)/);
    const start = Math.max(1, Number(match?.[1] ?? 1));
    const end = Math.min(weeks, Math.max(start, Number(match?.[2] ?? start)));
    return { task, start, end, material: /malzeme|tedarik/i.test(kind) };
  });
}

export function buildTechnicalOffer(
  input: OfferDocumentInput,
  content: TechnicalContent,
): string {
  const cur = input.currency;
  const curName = curLabel(cur);
  const money = (value: number) => `${num(value)} ${curName}`;
  const logo = `${input.origin}${NES_COMPANY.logoPath}`;
  const brandsImg = `${input.origin}${NES_COMPANY.assetsPath}/nes-markalar.png`;
  const groups = groupsOf(input);
  const validDays = daysBetween(input.issueDate, input.validUntil);
  const subtitle = content.subtitle.trim();
  const project = input.title.trim();
  const runTitle = `${input.offerNo} | ${project}`;
  const payment = input.paymentPlan;
  const recipient = input.recipientName || "-";
  const vatPct = qty(input.vatRate * 100);

  const groupTotals = groups.map((group) => {
    const labor = group.lines
      .filter((line) => line.category === "iscilik")
      .reduce((sum, line) => sum + line.saleAmount, 0);
    const total = group.lines.reduce((sum, line) => sum + line.saleAmount, 0);
    return { ...group, labor, material: total - labor, total };
  });

  // ---- Kapak
  const cover = `<section class="cover">
<img class="logo" src="${esc(logo)}" alt="NES Enerji">
<div class="kicker">Teknik ve ticari teklif</div>
<h1>${esc(project)}</h1>
${subtitle ? `<div class="subtitle">${esc(subtitle)}</div>` : '<div style="height:16mm"></div>'}
<table class="info"><tbody>
<tr><td>Müşteri</td><td>${esc(recipient)}</td></tr>
${input.location || input.recipientAddress ? `<tr><td>Proje yeri</td><td>${esc(input.location || input.recipientAddress || "")}</td></tr>` : ""}
<tr><td>Teklif no</td><td>${esc(input.offerNo)}</td></tr>
<tr><td>Tarih</td><td>${dateDots(input.issueDate)}</td></tr>
<tr><td>Geçerlilik</td><td>${validDays !== null ? `${validDays} takvim günü` : "-"}</td></tr>
<tr><td>Hazırlayan</td><td>${esc(NES_COMPANY.legalNameShort)}</td></tr>
</tbody></table>
<img class="brands" src="${esc(brandsImg)}" alt="nesenerji nesşarj nesproje nestaahhüt neskontrol">
</section>`;

  // ---- Giriş yazısı
  const introText = content.intro.trim()
    ? lines(content.intro)
        .map((line) => `<p>${esc(line)}</p>`)
        .join("")
    : `<p>${esc(input.location ? `${input.location} adresinde yapılacak ` : "")}${esc(project)} işine ilişkin teknik ve ticari teklifimizi bilgilerinize sunarız.</p>
<p>Teklifimiz; kapsamda belirtilen işlerin malzeme ve işçilik dahil anahtar teslim yapımını, testleri, enerjilendirmeyi ve geçici kabul sürecini kapsar.</p>
<p>NES Grup olarak Muğla'da elektrik taahhüt, GES ve endüstriyel elektrik işlerinde edindiğimiz saha tecrübesini, yerel dağıtım şirketi süreçlerine hâkimiyetimizle birleştirerek projenizi planlanan sürede ve kesintisiz bir kabul süreciyle teslim etmeyi hedefliyoruz.</p>`;
  const letterPage = `<div class="page-break"></div>
<p><b>Sayın Yetkili,</b></p>
${introText}
<p>Teklifimizin uygun bulunacağını umar, her türlü sorunuz için hazır olduğumuzu belirtiriz.</p>
<p>Saygılarımızla,</p>
<p style="margin-top:10mm"><b>${esc(content.preparedByName)}</b><br>${esc(content.preparedByTitle)}<br>${esc(NES_COMPANY.phone)} | ${esc(NES_COMPANY.email)}</p>`;

  // ---- 1. Teklif özeti
  const cards = lines(content.summaryCards)
    .map(splitPair)
    .filter(([head]) => head)
    .slice(0, 3);
  cards.push(["Teklif bedeli (KDV hariç)", money(input.sale)]);
  const paymentSummary = payment.length
    ? payment
        .map(
          (step) =>
            `%${qty(step.percent)} ${step.label.toLocaleLowerCase("tr-TR")}`,
        )
        .join(", ")
    : "";
  const summary = `<div class="page-break"></div>
<h2>1. Teklif Özeti</h2>
<div class="cards" style="grid-template-columns:repeat(${cards.length},1fr)">${cards.map(([head, value]) => `<div><span>${esc(head)}</span><b>${esc(value)}</b></div>`).join("")}</div>
<ul>
<li><b>Kapsam:</b> ${esc(subtitle || project)} işlerinin malzeme ve işçilik dahil anahtar teslim yapımı.</li>
${content.duration.trim() ? `<li><b>Süre:</b> Sözleşme ve avans tarihinden itibaren ${esc(content.duration.trim())}.</li>` : ""}
<li><b>Bedel:</b> ${money(input.sale)} + KDV (%${vatPct}) = ${money(input.grandTotal)}.</li>
${paymentSummary ? `<li><b>Ödeme:</b> ${esc(paymentSummary)}.</li>` : ""}
${content.warranty.trim() ? `<li><b>Garanti:</b> ${esc(content.warranty.trim())}</li>` : ""}
</ul>
<h2>2. NES Grup Hakkında</h2>
<p>NES Grup, Menteşe/Muğla merkezli olarak enerji ve elektrik çözümleri sunan bir mühendislik ve taahhüt kuruluşudur. Projelendirmeden kuruluma, dağıtım şirketi onay ve kabul süreçlerinden işletme desteğine kadar tüm aşamaları tek elden yönetir.</p>
<table class="grid"><thead><tr><th style="width:26%">Marka</th><th>Faaliyet alanı</th></tr></thead><tbody>
${brands.map(([brand, text]) => `<tr><td><b>nes</b><b style="color:${brandColors[brand.slice(3)] ?? "#0046a4"}">${esc(brand.slice(3))}</b></td><td>${esc(text)}</td></tr>`).join("")}
</tbody></table>
<h3>Bu proje için neden NES?</h3>${bullets(whyNes)}`;

  // ---- 3. Proje tanımı
  const techRows = lines(content.technicalData).map(splitPair);
  const special = lines(content.specialNotes);
  const hasProject =
    content.projectDescription.trim() || techRows.length || special.length;
  let section = 3;
  const projectSection = hasProject
    ? `<h2>${section++}. Proje Tanımı ve Teknik Veriler</h2>
${lines(content.projectDescription)
  .map((line) => `<p>${esc(line)}</p>`)
  .join("")}
${techRows.length ? `<table class="info"><tbody>${techRows.map(([head, body]) => `<tr><td>${esc(head || "-")}</td><td>${esc(body)}</td></tr>`).join("")}</tbody></table>` : ""}
${special.length ? `<h3>Projedeki özel durumlar</h3>${bullets(special)}` : ""}`
    : "";

  // ---- İş kapsamı
  const method = lines(content.methodology);
  const scopeSection = `<h2>${section++}. İş Kapsamı</h2>
<h3>${section - 1}.1 Teklife dahil olan işler</h3>${bullets(lines(content.included))}
<h3>${section - 1}.2 Teklife dahil olmayan işler (işveren sorumluluğu)</h3>${bullets(lines(content.excluded))}
${
  method.length
    ? `<h3>${section - 1}.3 Uygulama metodolojisi</h3><ol>${method
        .map((line) => {
          const [head, body] = splitPair(line);
          return `<li>${head ? `<b>${esc(head)}.</b> ${esc(body)}` : esc(body)}</li>`;
        })
        .join("")}</ol>`
    : ""
}`;

  // ---- İş programı
  const weeks = Math.max(
    1,
    Math.min(52, Math.round(content.scheduleWeeks || 1)),
  );
  const tasks = parseSchedule(content.schedule, weeks);
  const scheduleSection = tasks.length
    ? `<div class="keep"><h2>${section++}. İş Programı</h2>
<p>Toplam süre sözleşme ve avans tarihinden itibaren ${weeks} haftadır. Malzeme tedariki ile saha işleri paralel yürütülür.</p>
<table class="gantt"><thead><tr><th style="text-align:left">Faaliyet / Hafta</th>${Array.from({ length: weeks }, (_, i) => `<th>${i + 1}</th>`).join("")}</tr></thead><tbody>
${tasks.map((task) => `<tr><td>${esc(task.task)}</td>${Array.from({ length: weeks }, (_, i) => `<td class="${i + 1 >= task.start && i + 1 <= task.end ? `on${task.material ? " m" : ""}` : ""}"></td>`).join("")}</tr>`).join("")}
</tbody></table>
<div class="legend">Mavi: saha ve süreç işleri | Turuncu: malzeme tedariki</div>
<p class="small">Enerjilendirme tarihi; dağıtım şirketinin kesinti programına ve işveren sorumluluğundaki izin süreçlerinin tamamlanmasına bağlıdır. Bu süreçlerden doğan gecikmeler süreye eklenir.</p></div>`
    : "";

  // ---- Fiyat
  const priceSection = `<h2>${section++}. Fiyat Teklifi</h2>
<table class="grid"><thead><tr><th class="c" style="width:9mm">No</th><th>İş grubu</th><th class="r">Malzeme (${curName})</th><th class="r">İşçilik (${curName})</th><th class="r">Toplam (${curName})</th></tr></thead><tbody>
${groupTotals.map((group, index) => `<tr><td class="c">${letter(index)}</td><td>${esc(group.title)}</td><td class="r">${num(group.material)}</td><td class="r">${num(group.labor)}</td><td class="r">${num(group.total)}</td></tr>`).join("")}
<tr class="total"><td></td><td colspan="3" class="r">Ara toplam (KDV hariç)</td><td class="r">${money(input.sale)}</td></tr>
<tr class="total"><td></td><td colspan="3" class="r">KDV (%${vatPct})</td><td class="r">${money(input.vat)}</td></tr>
<tr class="grand"><td></td><td colspan="3" class="r">GENEL TOPLAM (KDV dahil)</td><td class="r">${money(input.grandTotal)}</td></tr>
</tbody></table>
<p class="small"><i>Yalnız: KDV hariç ${money(input.sale)}</i></p>
<p>Kalem bazında miktar ve birim fiyatlar Ek-1'deki birim fiyat cetvelinde verilmiştir. Miktarlar proje keşfinden alınmıştır; uygulamada oluşacak miktar farkları aynı birim fiyatlarla hesaplanır.</p>
${
  payment.length
    ? `<h3>${section - 1}.1 Ödeme planı</h3>
<table class="grid"><thead><tr><th>Aşama</th><th class="c">Oran</th><th class="r">Tutar (KDV hariç)</th><th>Açıklama</th></tr></thead><tbody>
${payment.map((step) => `<tr><td>${esc(step.label)}</td><td class="c">%${qty(step.percent)}</td><td class="r">${num((input.sale * step.percent) / 100)}</td><td>${esc(step.note ?? "")}</td></tr>`).join("")}
</tbody></table>`
    : ""
}
<h3>${section - 1}.${payment.length ? 2 : 1} Ticari şartlar</h3>
${bullets([
  `Fiyatlar ${cur === "TRY" ? "Türk Lirası" : curName} olup KDV hariçtir; KDV fatura tarihindeki oranla ayrıca eklenir.`,
  `Teklif ${validDays !== null ? `${validDays} takvim günü` : "belirtilen süre"} geçerlidir.${input.rates.USD > 0 ? ` Döviz endeksli kalemlerde 1 USD = ${qty(input.rates.USD)} TL${input.rates.EUR > 0 ? `, 1 EUR = ${qty(input.rates.EUR)} TL` : ""} esas alınmıştır.` : ""}`,
  ...lines(input.terms),
  `Banka bilgisi: ${NES_COMPANY.bank} – ${NES_COMPANY.iban}.`,
])}`;

  // ---- Kalite, İSG, garanti
  const qualitySection = `<div class="keep"><h2>${section++}. Kalite, İSG ve Garanti</h2>
<table class="grid"><thead><tr><th style="width:26%">Konu</th><th>Taahhüdümüz</th></tr></thead><tbody>
${[...quality.slice(0, 3), ["Garanti", content.warranty.trim() || "Malzeme üretici garanti süreleri kadar"] as [string, string], quality[3]].map(([head, body]) => `<tr><td><b>${esc(head)}</b></td><td>${esc(body)}</td></tr>`).join("")}
</tbody></table></div>`;

  // ---- Referanslar
  const refSection = `<h2>${section++}. Referanslar ve Proje Deneyimi</h2>
<p>NES Grup'un Muğla genelinde yürüttüğü elektrik taahhüt, endüstriyel elektrik ve güneş enerjisi projelerinden örnekler aşağıdadır. Bireysel müşterilerimizin gizliliği için konut projeleri bölge bazında verilmiştir.</p>
<table class="grid"><thead><tr><th>Alan</th><th>Proje</th><th>Yer</th><th>Yıl</th><th>Kapsam</th></tr></thead><tbody>
${references.map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`).join("")}
</tbody></table>
<h3>Öne çıkan yetkinlikler</h3>${bullets(competencies)}`;

  // ---- İletişim ve onay
  const contactSection = `<h2>${section++}. İletişim ve Onay</h2>
<table class="info"><tbody>
<tr><td>Firma</td><td>${esc(NES_COMPANY.legalNameShort)}</td></tr>
<tr><td>Adres</td><td>${esc(NES_COMPANY.address)}</td></tr>
<tr><td>Yetkili</td><td>${esc(content.preparedByName)} – ${esc(content.preparedByTitle.replace(/\s*–\s*NES Grup$/, ""))}</td></tr>
<tr><td>Telefon / e-posta</td><td>${esc(NES_COMPANY.phone)} | ${esc(NES_COMPANY.email)}</td></tr>
<tr><td>Web</td><td>nesgrup.com</td></tr>
</tbody></table>
<div class="sign"><div><b>TEKLİF VEREN – NES Grup</b><p>Ad Soyad: ${esc(content.preparedByName)}</p><p>Tarih: ${dateDots(input.issueDate)}</p><p>Kaşe / İmza:</p></div>
<div><b>MÜŞTERİ ONAYI – ${esc(recipient)}</b><p>Ad Soyad:</p><p>Tarih:</p><p>Kaşe / İmza:</p></div></div>`;

  // ---- Ek-1 birim fiyat cetveli
  let rowNo = 0;
  const annex = `<div class="annex"></div><h2>Ek-1. Birim Fiyat Cetveli</h2>
<p>Birim fiyatlar ${cur === "TRY" ? "Türk Lirası" : curName} ve KDV hariçtir.</p>
<table class="grid"><thead><tr><th class="c" style="width:9mm">No</th><th>Malzemenin / işin cinsi</th><th class="c">Birim</th><th class="r">Miktar</th><th class="r">Malzeme B.F.</th><th class="r">İşçilik B.F.</th><th class="r">Tutar (${curName})</th></tr></thead><tbody>
${groupTotals
  .map(
    (group, index) =>
      `<tr class="group"><td colspan="7">${letter(index)}. ${esc(group.title)}</td></tr>` +
      group.lines
        .map((line) => {
          rowNo += 1;
          const unitPrice =
            line.quantity > 0 ? line.saleAmount / line.quantity : 0;
          const labor = line.category === "iscilik";
          return `<tr><td class="c">${rowNo}</td><td>${esc(line.description)}</td><td class="c">${esc(line.unit)}</td><td class="r">${qty(line.quantity)}</td><td class="r">${labor ? num(0) : num(unitPrice)}</td><td class="r">${labor ? num(unitPrice) : num(0)}</td><td class="r">${num(line.saleAmount)}</td></tr>`;
        })
        .join(""),
  )
  .join("")}
<tr class="total"><td></td><td colspan="5" class="r">TOPLAM (KDV hariç)</td><td class="r">${num(input.sale)}</td></tr>
</tbody></table>`;

  const body = [
    cover,
    letterPage,
    summary,
    projectSection ? `<div class="page-break"></div>${projectSection}` : "",
    `${projectSection ? "" : '<div class="page-break"></div>'}${scopeSection}`,
    scheduleSection,
    `<div class="page-break"></div>${priceSection}`,
    qualitySection,
    `<div class="page-break"></div>${refSection}`,
    contactSection,
    annex,
  ].join("\n");

  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${esc(input.offerNo)} — ${esc(project)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Carlito:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
<style>${css}</style></head><body>
<div class="run-head"><span>${esc(runTitle)}</span><img src="${esc(logo)}" alt="NES Enerji"></div>
<img class="run-mark" src="${esc(logo)}" alt="">
<div class="run-foot"><span>${esc(NES_COMPANY.address)}</span><span>${esc(NES_CONTACT_LINE)}</span></div>
<div class="sheet"><table class="wrap"><thead><tr><td></td></tr></thead><tfoot><tr><td></td></tr></tfoot><tbody><tr><td>
${body}
</td></tr></tbody></table></div>
</body></html>`;
}

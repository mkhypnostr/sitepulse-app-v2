// Keşif föyü: saha bilgisi, konum, işin tanımı, malzeme ve işçilik listesi,
// fotoğraflar. Fiyat içermez. Föy dışarı da gönderilebildiği için iç notlar
// (survey.notes) bu belgeye hiçbir zaman yazılmaz.
import {
  type CachedCatalogItem,
  type Survey,
  type SurveyItem,
} from "@/lib/site-survey";

const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const num = (v: number) =>
  new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 3 }).format(v);

export function surveySheetHtml(
  survey: Survey,
  photos: { url: string; caption: string | null }[],
  catalog: CachedCatalogItem[],
  origin: string,
) {
  const date = new Date(survey.surveyed_at).toLocaleString("tr-TR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const code = (id: string | null) =>
    id ? (catalog.find((c) => c.id === id)?.code ?? "") : "";
  const map =
    survey.latitude != null && survey.longitude != null
      ? `<a href="https://www.google.com/maps?q=${survey.latitude},${survey.longitude}">${survey.latitude}, ${survey.longitude}</a>${survey.location_accuracy_m ? ` (±${survey.location_accuracy_m} m)` : ""}`
      : "-";
  const rowsOf = (items: SurveyItem[]) =>
    items
      .map(
        (item, i) =>
          `<tr><td class="c">${i + 1}</td><td>${esc(item.description)}${item.note ? `<div class="note">${esc(item.note)}</div>` : ""}</td><td class="c mono">${esc(code(item.catalog_item_id))}</td><td class="r">${num(item.quantity)}</td><td>${esc(item.unit)}</td><td class="chk"></td></tr>`,
      )
      .join("");
  const tableOf = (items: SurveyItem[]) =>
    `<table><thead><tr><th class="c">#</th><th>Kalem</th><th class="c">Kod</th><th class="r">Miktar</th><th>Birim</th><th class="c">✓</th></tr></thead><tbody>${rowsOf(items)}</tbody></table>`;
  const materials = survey.items.filter((i) => i.kind !== "iscilik");
  const labor = survey.items.filter((i) => i.kind === "iscilik");
  const photoHtml = photos
    .map(
      (p, i) =>
        `<figure><img src="${esc(p.url)}" alt="Fotoğraf ${i + 1}"><figcaption>${i + 1}. ${esc(p.caption ?? "")}</figcaption></figure>`,
    )
    .join("");

  return `<!doctype html><html lang="tr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(survey.survey_no ?? "Keşif")} · ${esc(survey.title)}</title>
<style>
@page{size:A4;margin:12mm}
*{box-sizing:border-box}
body{margin:0;background:#e6eaeb;font-family:Arial,Helvetica,sans-serif;color:#1f2933;font-size:11px}
.page{width:794px;margin:16px auto;background:#fff;padding:32px 36px}
.head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0b5d6e;padding-bottom:10px}
.head img{height:46px}
.head h1{margin:0;font-size:20px;color:#0b5d6e;text-align:right}
.head .no{text-align:right;font-family:"Courier New",monospace;font-size:12px;margin-top:4px}
.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:6px 18px;margin-top:14px}
.grid div span{display:block;color:#6b7780;font-size:9.5px;text-transform:uppercase;letter-spacing:.04em}
.grid div b{font-size:12px}
h2{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#0b5d6e;border-bottom:1px solid #d6dde1;padding-bottom:4px;margin:20px 0 8px}
.notes{white-space:pre-wrap;line-height:1.55;font-size:11.5px}
table{width:100%;border-collapse:collapse}
th{text-align:left;font-size:9.5px;color:#4b5863;border-bottom:2px solid #0b5d6e;padding:5px 4px}
td{border-bottom:1px solid #e3e8eb;padding:6px 4px;vertical-align:top}
.c{text-align:center}.r{text-align:right}.mono{font-family:"Courier New",monospace;font-size:10px}
.note{color:#6b7780;font-size:10px;margin-top:2px}
.chk{width:22px;border:1px solid #9aa5ad}
.photos{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
figure{margin:0;break-inside:avoid}
figure img{width:100%;height:230px;object-fit:cover;border-radius:6px;border:1px solid #d6dde1}
figcaption{font-size:10px;color:#4b5863;margin-top:3px}
.sign{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:26px}
.sign div{border-top:1px solid #9aa5ad;padding-top:6px;font-size:10px;color:#4b5863}
.foot{margin-top:18px;font-size:9px;color:#8a949b;text-align:center}
@media print{body{background:#fff}.page{margin:0;width:auto;padding:0}}
</style></head><body><div class="page">
<div class="head"><img src="${esc(origin)}/nes-enerji-logo.png" alt="NES Enerji">
<div><h1>KEŞİF FÖYÜ</h1><div class="no">${esc(survey.survey_no ?? "Numara: gönderim sonrası")}</div></div></div>
<div class="grid">
<div><span>Keşif</span><b>${esc(survey.title || "-")}</b></div>
<div><span>Müşteri</span><b>${esc(survey.customer_name || "-")}</b></div>
<div><span>Yetkili kişi</span><b>${esc(survey.contact_name || "-")}</b></div>
<div><span>Telefon</span><b>${esc(survey.contact_phone || "-")}</b></div>
<div><span>Yer</span><b>${esc(survey.location_text || "-")}</b></div>
<div><span>GPS</span><b>${map}</b></div>
<div><span>Keşif tarihi</span><b>${esc(date)}</b></div>
<div><span>Fotoğraf / kalem</span><b>${photos.length} / ${survey.items.length}</b></div>
</div>
${survey.work_description?.trim() ? `<h2>İşin tanımı</h2><div class="notes">${esc(survey.work_description.trim())}</div>` : ""}
<h2>Malzeme listesi</h2>
${materials.length ? tableOf(materials) : "<p>-</p>"}
${labor.length ? `<h2>İşçilik</h2>${tableOf(labor)}` : ""}
${photos.length ? `<h2>Saha fotoğrafları</h2><div class="photos">${photoHtml}</div>` : ""}
<div class="sign"><div>Keşfi yapan</div><div>Kontrol eden</div></div>
<div class="foot">NES Enerji · keşif föyü, fiyat içermez · ${esc(new Date().toLocaleDateString("tr-TR"))}</div>
</div></body></html>`;
}

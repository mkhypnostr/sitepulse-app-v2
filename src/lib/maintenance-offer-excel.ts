// Bakım paketleri Excel çıktıları. Üç ayrı dosya üretilir; iç maliyet hiçbir
// zaman müşteri dosyasına girmez:
//  - Müşteri: "Teklif" (paket karşılaştırması + seçilen hizmetler, formüllü
//    toplam), "Ek-1 Teknik Şartname", "Ek-2 Sözleşme".
//  - İç maliyet: taşeron maliyeti, satış, brüt kâr ve marj (yalnız yönetici).
//  - Taşeron fiyat talebi: kapsam ve kWp; müşteri adı ve satış fiyatı yok.

import {
  EXTRAS,
  GES_OPTIONS,
  GES_SCOPE,
  GES_SPEC,
  GES_TIERS,
  GES_TIER_LABEL,
  KVA_BANDS,
  SITE_LABEL,
  TIERS,
  TIER_LABEL,
  TRAFO_SCOPE,
  TRAFO_TIER_NOTE,
  contractArticles,
  optionAvailable,
  optionSale,
  type GesCell,
  type MaintenanceOfferInput,
  type MaintenanceOfferResult,
  type MaintenancePrices,
} from "@/lib/maintenance-offer";
import { NES_COMPANY } from "@/lib/nes-company";

type Cell = import("exceljs").Cell;
type Row = import("exceljs").Row;
type Worksheet = import("exceljs").Worksheet;
type Workbook = import("exceljs").Workbook;

const NAVY = "FF1B3F7A";
const TIER_BG = ["FF5E7FB8", "FF2F5FA8", "FF1B3F7A"];
const SAGE_DD = "FF3E5050";
const MIST = "FFEEF4F4";
const SUN = "FFFFF4DC";
const INPUT = "FFFFF7D6";
const OK = "FF2E7D32";
const NO = "FFC62828";
const OPT = "FFB7791F";
const MUTE = "FF5D6767";
const MONEY = '#,##0.00 "₺";-#,##0.00 "₺";"—"';
const MONEY0 = '#,##0 "₺";-#,##0 "₺";"—"';
const FONT = "Arial";

const thin = { style: "thin" as const, color: { argb: "FFC9D3D3" } };
const fill = (cell: Cell, argb: string) => {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
};
const font = (
  cell: Cell,
  opts: {
    size?: number;
    bold?: boolean;
    color?: string;
    italic?: boolean;
  } = {},
) => {
  cell.font = {
    name: FONT,
    size: opts.size ?? 10,
    bold: opts.bold,
    italic: opts.italic,
    color: { argb: opts.color ?? "FF1F2324" },
  };
};
const underline = (row: Row, cols: number) => {
  for (let c = 1; c <= cols; c++) row.getCell(c).border = { bottom: thin };
};

function trDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}.${m}.${y}` : iso;
}
const fmtNum = (n: number) =>
  new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(n);

async function newWorkbook(logoUrl: string) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = NES_COMPANY.brand;
  wb.created = new Date();
  let logo: number | null = null;
  try {
    const buf = await fetch(logoUrl).then((r) => r.arrayBuffer());
    logo = wb.addImage({ buffer: buf, extension: "png" });
  } catch {
    logo = null;
  }
  return { wb, logo };
}

/** A4, sığdır, NES altbilgisi; sütunlar ve antet (logo sağda, çizgi). */
function sheet(
  wb: Workbook,
  logo: number | null,
  name: string,
  title: string,
  widths: number[],
  landscape = false,
) {
  const ws = wb.addWorksheet(name, {
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: landscape ? "landscape" : "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: {
        left: 0.5,
        right: 0.5,
        top: 0.45,
        bottom: 0.7,
        header: 0.2,
        footer: 0.25,
      },
    },
    headerFooter: {
      oddFooter: `&L&7${NES_COMPANY.web}&C&6${NES_COMPANY.address} · ${NES_COMPANY.phone} · ${NES_COMPANY.email}&R&7Sayfa &P / &N`,
    },
  });
  ws.columns = widths.map((width) => ({ width }));
  const last = String.fromCharCode(64 + widths.length);
  ws.getRow(1).height = 42;
  if (logo !== null)
    // Logo sağ üstte (≈ 132 × 40 px)
    ws.addImage(logo, {
      tl: { col: Math.max(widths.length - 1.15, 0.5), row: 0.12 },
      ext: { width: 132, height: 40 },
    });
  const t = ws.getCell("A1");
  t.value = title;
  font(t, { size: 8, color: MUTE });
  t.alignment = { vertical: "bottom" };
  for (let c = 1; c <= widths.length; c++)
    ws.getRow(1).getCell(c).border = {
      bottom: { style: "medium", color: { argb: "FF1F2324" } },
    };
  return { ws, last, cols: widths.length };
}

/** Birleştirilmiş, metne göre yüksekliği ayarlanmış paragraf satırı. */
function para(
  ws: Worksheet,
  r: number,
  last: string,
  text: string,
  totalWidth: number,
  opts: { size?: number; bold?: boolean; color?: string; indent?: number } = {},
) {
  const size = opts.size ?? 9;
  ws.mergeCells(`A${r}:${last}${r}`);
  const c = ws.getCell(`A${r}`);
  c.value = text;
  font(c, { size, bold: opts.bold, color: opts.color });
  c.alignment = { wrapText: true, vertical: "top", indent: opts.indent ?? 0 };
  const cpl = totalWidth * 1.25 * (10 / size) - (opts.indent ?? 0) * 3;
  const lines = text
    .split("\n")
    .reduce((n, p) => n + Math.max(1, Math.ceil(p.length / cpl)), 0);
  ws.getRow(r).height = lines * size * 1.35 + 4;
  return r + 1;
}

function heading(
  ws: Worksheet,
  r: number,
  last: string,
  text: string,
  size = 15,
) {
  ws.mergeCells(`A${r}:${last}${r}`);
  const c = ws.getCell(`A${r}`);
  c.value = text;
  font(c, { size, bold: true, color: NAVY });
  ws.getRow(r).height = size * 1.7;
  return r + 1;
}

function band(ws: Worksheet, r: number, last: string, text: string) {
  ws.mergeCells(`A${r}:${last}${r}`);
  const c = ws.getCell(`A${r}`);
  c.value = text;
  font(c, { size: 10, bold: true, color: "FFFFFFFF" });
  fill(c, NAVY);
  c.alignment = { vertical: "middle", indent: 1 };
  ws.getRow(r).height = 20;
  return r + 1;
}

function infoRows(
  ws: Worksheet,
  r: number,
  last: string,
  rows: [string, string][],
) {
  for (const [k, v] of rows) {
    const a = ws.getCell(`A${r}`);
    a.value = k;
    font(a, { size: 9, bold: true, color: MUTE });
    fill(a, MIST);
    ws.mergeCells(`B${r}:${last}${r}`);
    const b = ws.getCell(`B${r}`);
    b.value = v;
    font(b, { bold: true });
    fill(b, MIST);
    ws.getRow(r).height = 18;
    r += 1;
  }
  return r;
}

function scopeMark(cell: Cell, v: GesCell, selected: boolean) {
  cell.value = v === true ? "✓" : v === false ? "✗" : "○ Opsiyonel";
  font(cell, {
    size: v === "opt" ? 8 : 12,
    bold: true,
    color: v === true ? OK : v === false ? NO : OPT,
  });
  cell.alignment = { horizontal: "center", vertical: "middle" };
  if (selected) fill(cell, SUN);
}

function siteLine(form: MaintenanceOfferInput) {
  return [
    `${SITE_LABEL[form.ges.site]} tipi GES`,
    `${fmtNum(form.ges.kwp)} kWp`,
    form.ges.inverters ? `${fmtNum(form.ges.inverters)} inverter` : "",
    form.ges.panels ? `${fmtNum(form.ges.panels)} panel` : "",
  ]
    .filter(Boolean)
    .join("  ·  ");
}

async function toBlob(wb: Workbook) {
  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

// ============================================================ müşteri dosyası

export async function buildMaintenanceOfferWorkbook(input: {
  form: MaintenanceOfferInput;
  prices: MaintenancePrices;
  result: MaintenanceOfferResult;
  logoUrl: string;
}): Promise<Blob> {
  const { form, prices, result } = input;
  const { wb, logo } = await newWorkbook(input.logoUrl);
  const W = [46, 17, 17, 17];
  const TW = W.reduce((a, b) => a + b, 0);

  // ------------------------------------------------------------ Teklif
  const { ws, last } = sheet(
    wb,
    logo,
    "Teklif",
    "Bakım Paketleri Fiyat Teklifi",
    W,
  );
  let r = 3;
  r = heading(ws, r, last, "BAKIM PAKETLERİ FİYAT TEKLİFİ", 17);
  ws.mergeCells(`A${r}:${last}${r}`);
  ws.getCell(`A${r}`).value =
    `Teklif No: ${form.offerNo}   ·   Tarih: ${trDate(form.offerDate)}   ·   Geçerlilik: ${form.validityDays} gün`;
  font(ws.getCell(`A${r}`), { size: 9, color: MUTE });
  r += 2;
  r = infoRows(ws, r, last, [
    ["Sayın", form.customerName],
    [
      "Yetkili",
      [form.contactPerson, form.contactInfo].filter(Boolean).join("  ·  "),
    ],
    ["Tesis", form.address],
    ...(form.ges.enabled
      ? ([["Tesis tipi / kurulu güç", siteLine(form)]] as [string, string][])
      : []),
  ]);
  r += 1;

  if (form.ges.enabled) {
    const sel = form.ges.tier;
    const h = ws.getRow(r);
    h.getCell(1).value = "GES bakım paketleri · hizmet kapsamı";
    font(h.getCell(1), { bold: true, color: "FFFFFFFF" });
    fill(h.getCell(1), SAGE_DD);
    h.getCell(1).alignment = { vertical: "middle", indent: 1 };
    GES_TIERS.forEach((t, i) => {
      const c = h.getCell(i + 2);
      c.value = `${t === sel ? "★ " : ""}${GES_TIER_LABEL[t].toUpperCase()}`;
      font(c, { bold: true, color: "FFFFFFFF" });
      fill(c, TIER_BG[i]);
      c.alignment = {
        horizontal: "center",
        vertical: "middle",
        wrapText: true,
      };
    });
    h.height = 28;
    r += 1;
    for (const [label, cells] of GES_SCOPE) {
      const row = ws.getRow(r);
      row.getCell(1).value = label;
      font(row.getCell(1));
      row.getCell(1).alignment = { indent: 1, vertical: "middle" };
      GES_TIERS.forEach((t, i) =>
        scopeMark(row.getCell(i + 2), cells[t], t === sel),
      );
      underline(row, 4);
      row.height = 19;
      r += 1;
    }
    const tierRow = (
      label: string,
      values: (number | string)[],
      opts: { fmt?: string; bold?: boolean; bg?: string; color?: string } = {},
    ) => {
      const row = ws.getRow(r);
      row.getCell(1).value = label;
      font(row.getCell(1), { bold: opts.bold, color: opts.color });
      row.getCell(1).alignment = { indent: 1, vertical: "middle" };
      if (opts.bg) fill(row.getCell(1), opts.bg);
      values.forEach((v, i) => {
        const c = row.getCell(i + 2);
        c.value = v;
        if (opts.fmt) c.numFmt = opts.fmt;
        font(c, {
          bold: opts.bold,
          color: opts.color ?? (opts.bold ? NAVY : undefined),
        });
        c.alignment = { horizontal: "center", vertical: "middle" };
        if (opts.bg) fill(c, opts.bg);
        else if (GES_TIERS[i] === sel) fill(c, SUN);
      });
      underline(row, 4);
      row.height = 20;
      return r++;
    };
    tierRow(
      "Yıllık saha ziyareti",
      GES_TIERS.map((t) => `${prices.ges[t].visits} kez`),
      { bold: true, color: "FF1F2324" },
    );
    tierRow(
      "Birim fiyat (₺ / kWp / yıl)",
      GES_TIERS.map((t) => result.ges[t].unit),
      { fmt: MONEY },
    );
    const yr = tierRow(
      "Yıllık paket bedeli (KDV hariç)",
      GES_TIERS.map((t) => result.ges[t].yearly),
      { fmt: MONEY0, bold: true },
    );
    const vr = r;
    const vatRow = ws.getRow(vr);
    vatRow.getCell(1).value = `KDV (%${Math.round(form.vatRate * 100)})`;
    font(vatRow.getCell(1), { color: MUTE });
    vatRow.getCell(1).alignment = { indent: 1 };
    ["B", "C", "D"].forEach((col, i) => {
      const c = ws.getCell(`${col}${vr}`);
      c.value = {
        formula: `${col}${yr}*${form.vatRate}`,
        result: result.ges[GES_TIERS[i]].yearly * form.vatRate,
      };
      c.numFmt = MONEY0;
      font(c, { color: MUTE });
      c.alignment = { horizontal: "center" };
    });
    r += 1;
    const gr = ws.getRow(r);
    gr.getCell(1).value = "Yıllık toplam (KDV dahil)";
    ["B", "C", "D"].forEach((col, i) => {
      const c = ws.getCell(`${col}${r}`);
      c.value = {
        formula: `${col}${yr}+${col}${vr}`,
        result: result.ges[GES_TIERS[i]].yearly * (1 + form.vatRate),
      };
      c.numFmt = MONEY0;
      c.alignment = { horizontal: "center" };
    });
    for (let c = 1; c <= 4; c++) {
      font(gr.getCell(c), { bold: true, color: "FFFFFFFF" });
      fill(gr.getCell(c), SAGE_DD);
    }
    gr.getCell(1).alignment = { indent: 1, vertical: "middle" };
    gr.height = 21;
    r += 1;
    ws.mergeCells(`A${r}:${last}${r}`);
    ws.getCell(`A${r}`).value =
      "✓ Dahil   ✗ Dahil değil   ○ Opsiyonel (ayrıca fiyatlandırılır)   ★ Önerilen paket";
    font(ws.getCell(`A${r}`), { size: 8, italic: true, color: MUTE });
    r += 2;
  }

  // Seçilen hizmetler (formüllü)
  const hr = ws.getRow(r);
  ["Seçilen hizmetler", "Miktar", "Birim fiyat", "Yıllık tutar"].forEach(
    (t, i) => {
      const c = hr.getCell(i + 1);
      c.value = t;
      font(c, { size: 9, bold: true, color: "FFFFFFFF" });
      fill(c, SAGE_DD);
      c.alignment = {
        horizontal: i ? "center" : "left",
        vertical: "middle",
        indent: i ? 0 : 1,
      };
    },
  );
  hr.height = 20;
  r += 1;
  const first = r;
  for (const l of result.lines) {
    const row = ws.getRow(r);
    row.getCell(1).value = `${l.label}\n${l.detail}`;
    font(row.getCell(1), { size: 9 });
    row.getCell(1).alignment = { wrapText: true, vertical: "top", indent: 1 };
    row.getCell(2).value = 1;
    row.getCell(3).value = l.amount;
    row.getCell(3).numFmt = MONEY;
    row.getCell(4).value = { formula: `B${r}*C${r}`, result: l.amount };
    row.getCell(4).numFmt = MONEY;
    [2, 3, 4].forEach((c) => {
      font(row.getCell(c), { size: 9 });
      row.getCell(c).alignment = { horizontal: "center", vertical: "top" };
    });
    underline(row, 4);
    row.height = 30;
    r += 1;
  }
  const lastLine = r - 1;
  const tot = (
    label: string,
    formula: string,
    value: number,
    strong = false,
    grand = false,
  ) => {
    ws.mergeCells(`A${r}:C${r}`);
    const a = ws.getCell(`A${r}`);
    a.value = label;
    a.alignment = { horizontal: "right" };
    const d = ws.getCell(`D${r}`);
    d.value = { formula, result: value };
    d.numFmt = MONEY;
    d.alignment = { horizontal: "center" };
    font(a, {
      bold: strong || grand,
      color: grand ? "FFFFFFFF" : undefined,
      size: grand ? 11 : 10,
    });
    font(d, {
      bold: strong || grand,
      color: grand ? "FFFFFFFF" : undefined,
      size: grand ? 11 : 10,
    });
    if (grand) {
      fill(a, NAVY);
      fill(d, NAVY);
    }
    return r++;
  };
  const sumF = lastLine >= first ? `SUM(D${first}:D${lastLine})` : "0";
  const sub = tot("Ara toplam", sumF, result.subtotal);
  const disc = tot(
    `İskonto (%${Math.round(form.discount * 1000) / 10})`,
    `D${sub}*${form.discount}`,
    result.discountAmount,
  );
  const net = tot("Toplam (KDV hariç)", `D${sub}-D${disc}`, result.net, true);
  const vat = tot(
    `KDV (%${Math.round(form.vatRate * 100)})`,
    `D${net}*${form.vatRate}`,
    result.vat,
  );
  tot(
    "Genel toplam (yıllık)",
    `D${net}+D${vat}`,
    result.grandTotal,
    false,
    true,
  );
  r += 1;

  if (form.ges.enabled) {
    const oh = ws.getRow(r);
    ["Opsiyonel hizmetler", "Birim", "Birim fiyat", "Bu tesis için"].forEach(
      (t, i) => {
        const c = oh.getCell(i + 1);
        c.value = t;
        font(c, { size: 9, bold: true, color: "FFFFFFFF" });
        fill(c, SAGE_DD);
        c.alignment = { horizontal: i ? "center" : "left", indent: i ? 0 : 1 };
      },
    );
    r += 1;
    for (const o of GES_OPTIONS) {
      if (!optionAvailable(o.key, form.ges.tier)) continue;
      const unit = optionSale(prices, o.key);
      const row = ws.getRow(r);
      row.getCell(1).value = o.label;
      row.getCell(2).value = o.unit;
      row.getCell(3).value = unit;
      row.getCell(3).numFmt = MONEY;
      row.getCell(4).value = o.perKwp
        ? { formula: `C${r}*${form.ges.kwp}`, result: unit * form.ges.kwp }
        : o.key === "rapor"
          ? { formula: `C${r}*12`, result: unit * 12 }
          : "Ziyaret başına";
      if (typeof row.getCell(4).value !== "string")
        row.getCell(4).numFmt = MONEY0;
      [1, 2, 3, 4].forEach((c) => {
        font(row.getCell(c), { size: 9, color: c === 2 ? MUTE : undefined });
        row.getCell(c).alignment = {
          horizontal: c === 1 ? "left" : "center",
          indent: c === 1 ? 1 : 0,
          wrapText: true,
        };
      });
      underline(row, 4);
      row.height = 19;
      r += 1;
    }
    r += 1;
  }

  if (form.trafo.enabled) {
    r = band(ws, r, last, "Trafo merkezi bakım paketleri");
    const th = ws.getRow(r);
    th.getCell(1).value =
      `${Math.max(1, form.trafo.count)} × ${fmtNum(form.trafo.kva)} kVA · ${form.trafo.voltage} · ${form.trafo.kind}`;
    font(th.getCell(1), { size: 9, color: MUTE });
    TIERS.forEach((t, i) => {
      const c = th.getCell(i + 2);
      c.value = `${t === form.trafo.tier ? "★ " : ""}${TIER_LABEL[t]}\n${TRAFO_TIER_NOTE[t]}`;
      font(c, { size: 9, bold: true, color: "FFFFFFFF" });
      fill(c, TIER_BG[i]);
      c.alignment = {
        horizontal: "center",
        wrapText: true,
        vertical: "middle",
      };
    });
    th.height = 30;
    r += 1;
    for (const [g, rows] of TRAFO_SCOPE) {
      ws.getCell(`A${r}`).value = g;
      font(ws.getCell(`A${r}`), { size: 9, bold: true, color: NAVY });
      r += 1;
      for (const [label, ...cells] of rows) {
        const row = ws.getRow(r);
        row.getCell(1).value = label;
        font(row.getCell(1), { size: 9 });
        row.getCell(1).alignment = { indent: 1, wrapText: true };
        cells.forEach((c, i) => {
          const cell = row.getCell(i + 2);
          if (typeof c === "boolean")
            scopeMark(cell, c, TIERS[i] === form.trafo.tier);
          else {
            cell.value = c;
            font(cell, { size: 9 });
            cell.alignment = { horizontal: "center" };
            if (TIERS[i] === form.trafo.tier) fill(cell, SUN);
          }
        });
        underline(row, 4);
        r += 1;
      }
    }
    const pr = ws.getRow(r);
    pr.getCell(1).value = "Yıllık paket bedeli (KDV hariç)";
    font(pr.getCell(1), { bold: true });
    TIERS.forEach((t, i) => {
      const c = pr.getCell(i + 2);
      c.value = result.trafoTiers[t];
      c.numFmt = MONEY0;
      font(c, { bold: true, color: NAVY });
      c.alignment = { horizontal: "center" };
      fill(c, t === form.trafo.tier ? SUN : MIST);
    });
    r += 2;
  }

  if (form.isEnabled || form.trafo.enabled) {
    r = band(ws, r, last, "Ek hizmetler (talep halinde, KDV hariç)");
    for (const x of EXTRAS) {
      const row = ws.getRow(r);
      row.getCell(1).value = x.label;
      row.getCell(2).value = x.unit;
      row.getCell(3).value = prices.extras[x.key];
      row.getCell(3).numFmt = MONEY;
      [1, 2, 3].forEach((c) => {
        font(row.getCell(c), { size: 9 });
        row.getCell(c).alignment = {
          horizontal: c === 1 ? "left" : "center",
          indent: c === 1 ? 1 : 0,
        };
      });
      underline(row, 4);
      r += 1;
    }
    if (form.isEnabled) {
      r += 1;
      r = band(ws, r, last, "Elektrik işletme sorumluluğu (aylık, KDV hariç)");
      KVA_BANDS.forEach((b, i) => {
        const row = ws.getRow(r);
        row.getCell(1).value =
          `${b.label}${i === result.isBand ? "  (tesisiniz)" : ""}`;
        row.getCell(3).value = prices.isMonthly[i];
        row.getCell(3).numFmt = MONEY;
        font(row.getCell(1), { size: 9, bold: i === result.isBand });
        font(row.getCell(3), { size: 9, bold: i === result.isBand });
        row.getCell(3).alignment = { horizontal: "center" };
        if (i === result.isBand)
          [1, 2, 3, 4].forEach((c) => fill(row.getCell(c), SUN));
        underline(row, 4);
        r += 1;
      });
    }
    r += 1;
  }

  ws.getCell(`A${r}`).value = "Teklif koşulları";
  font(ws.getCell(`A${r}`), { bold: true, color: NAVY });
  r += 1;
  for (const t of [
    "Fiyatlar Türk Lirası olup KDV hariçtir; paket bedelleri 12 aylık sözleşme dönemi içindir.",
    `Ödeme: ${form.payment || "sözleşmede belirtilir"}.`,
    "Yedek parça, malzeme ve onarım işçiliği paket bedeline dahil değildir; tespit edilen arızalar onaylı ayrı teklifle giderilir.",
    "Bakım tarihleri sözleşme başında yıllık plan olarak belirlenir; enerji kesintisi gerektiren işler en az 7 gün önceden planlanır.",
    "Termal drone uçuşları, mevzuat ve tesis güvenlik kurallarına uygun izinler alınarak yapılır.",
    `Teklif ${trDate(form.offerDate)} tarihinden itibaren ${form.validityDays} gün geçerlidir.`,
  ])
    r = para(ws, r, last, `•  ${t}`, TW, { size: 9 });
  r += 1;
  r = para(
    ws,
    r,
    last,
    `Saygılarımızla,  ${NES_COMPANY.legalNameShort}  ·  ${NES_COMPANY.phone}  ·  ${NES_COMPANY.email}`,
    TW,
    { size: 8.5, bold: true, color: MUTE },
  );
  ws.pageSetup.printArea = `A1:${last}${r}`;

  // ------------------------------------------------------------ Ek-1
  if (form.ges.enabled) {
    const s = sheet(
      wb,
      logo,
      "Ek-1 Teknik Şartname",
      "Ek-1 · Teknik Şartname",
      W,
    );
    let q = 3;
    q = heading(
      s.ws,
      q,
      s.last,
      "EK-1 · GES BAKIM HİZMETLERİ TEKNİK ŞARTNAMESİ",
      14,
    );
    q += 1;
    for (const [title, paras] of GES_SPEC) {
      s.ws.getCell(`A${q}`).value = title;
      font(s.ws.getCell(`A${q}`), { bold: true, color: NAVY });
      s.ws.getRow(q).height = 17;
      q += 1;
      for (const p of paras)
        q = para(s.ws, q, s.last, p, TW, { size: 8.8, indent: 1 });
      s.ws.getRow(q).height = 4;
      q += 1;
    }
    s.ws.pageSetup.printArea = `A1:${s.last}${q}`;
  }

  // ------------------------------------------------------------ Ek-2
  const c = sheet(
    wb,
    logo,
    "Ek-2 Sözleşme",
    "Ek-2 · Bakım Hizmet Sözleşmesi",
    W,
  );
  let q = 3;
  q = heading(c.ws, q, c.last, "EK-2 · BAKIM HİZMET SÖZLEŞMESİ", 14);
  q += 1;
  for (const [title, paras] of contractArticles(form, result)) {
    c.ws.getCell(`A${q}`).value = title;
    font(c.ws.getCell(`A${q}`), { bold: true, color: NAVY });
    c.ws.getRow(q).height = 17;
    q += 1;
    for (const p of paras)
      q = para(c.ws, q, c.last, p, TW, { size: 9, indent: 1 });
  }
  q += 1;
  c.ws.getCell(`A${q}`).value = "Tarih: ……/……/20……";
  font(c.ws.getCell(`A${q}`), { size: 9.5 });
  q += 2;
  c.ws.getCell(`A${q}`).value = "HİZMET VEREN";
  c.ws.mergeCells(`C${q}:D${q}`);
  c.ws.getCell(`C${q}`).value = "HİZMET ALAN";
  font(c.ws.getCell(`A${q}`), { bold: true, color: NAVY });
  font(c.ws.getCell(`C${q}`), { bold: true, color: NAVY });
  q += 1;
  c.ws.getCell(`A${q}`).value = NES_COMPANY.legalNameShort;
  c.ws.mergeCells(`C${q}:D${q}`);
  c.ws.getCell(`C${q}`).value = form.customerName;
  font(c.ws.getCell(`A${q}`), { size: 8.5, color: MUTE });
  font(c.ws.getCell(`C${q}`), { size: 8.5, color: MUTE });
  q += 1;
  c.ws.getCell(`A${q}`).value = "Ad Soyad / Kaşe / İmza";
  c.ws.getCell(`C${q}`).value = "Ad Soyad / Kaşe / İmza";
  font(c.ws.getCell(`A${q}`), { size: 8.5, color: MUTE });
  font(c.ws.getCell(`C${q}`), { size: 8.5, color: MUTE });
  q += 1;
  c.ws.getRow(q).height = 50;
  ["A", "C", "D"].forEach(
    (col) => (c.ws.getCell(`${col}${q}`).border = { bottom: thin }),
  );
  c.ws.pageSetup.printArea = `A1:${c.last}${q}`;

  wb.views = [
    {
      activeTab: 0,
      x: 0,
      y: 0,
      width: 20000,
      height: 12000,
      firstSheet: 0,
      visibility: "visible",
    },
  ];
  return toBlob(wb);
}

// ============================================================ iç maliyet

export async function buildMaintenanceCostWorkbook(input: {
  form: MaintenanceOfferInput;
  prices: MaintenancePrices;
  result: MaintenanceOfferResult;
  logoUrl: string;
}): Promise<Blob> {
  const { form, prices, result } = input;
  const { wb, logo } = await newWorkbook(input.logoUrl);
  const W = [34, 17, 17, 18, 18, 17, 12];
  const { ws, last } = sheet(
    wb,
    logo,
    "İç Maliyet",
    "İç maliyet · müşteriye göndermeyin",
    W,
    true,
  );
  let r = 3;
  r = heading(ws, r, last, "İÇ MALİYET ANALİZİ · MÜŞTERİYE GÖNDERMEYİN", 14);
  ws.getCell(`A${r - 1}`).font = {
    name: FONT,
    size: 14,
    bold: true,
    color: { argb: NO },
  };
  r = infoRows(ws, r, last, [
    ["Teklif no / tarih", `${form.offerNo}  ·  ${trDate(form.offerDate)}`],
    ["Müşteri", form.customerName],
    [
      "Tesis",
      `${form.address}${form.ges.enabled ? `  ·  ${siteLine(form)}` : ""}`,
    ],
  ]);
  r += 1;
  const head = (labels: string[]) => {
    const row = ws.getRow(r);
    labels.forEach((t, i) => {
      const c = row.getCell(i + 1);
      c.value = t;
      font(c, { size: 9, bold: true, color: "FFFFFFFF" });
      fill(c, NAVY);
      c.alignment = {
        horizontal: i ? "center" : "left",
        wrapText: true,
        vertical: "middle",
        indent: i ? 0 : 1,
      };
    });
    row.height = 30;
    r += 1;
  };
  if (form.ges.enabled) {
    head([
      "GES paketi",
      "Taşeron ₺/kWp",
      "Müşteri ₺/kWp",
      "Yıllık taşeron maliyeti",
      "Yıllık satış (KDV hariç)",
      "Brüt kâr",
      "Marj",
    ]);
    GES_TIERS.forEach((t) => {
      const row = ws.getRow(r);
      const g = result.ges[t];
      row.getCell(1).value =
        `${t === form.ges.tier ? "★ " : ""}${GES_TIER_LABEL[t]}`;
      row.getCell(2).value = g.unitCost;
      row.getCell(3).value = g.unit;
      row.getCell(4).value = {
        formula: `B${r}*${form.ges.kwp}`,
        result: g.yearlyCost,
      };
      row.getCell(5).value = g.yearly;
      row.getCell(6).value = {
        formula: `E${r}-D${r}`,
        result: g.yearly - g.yearlyCost,
      };
      row.getCell(7).value = {
        formula: `IF(E${r}>0,F${r}/E${r},0)`,
        result: g.yearly > 0 ? (g.yearly - g.yearlyCost) / g.yearly : 0,
      };
      [2, 3].forEach((c) => (row.getCell(c).numFmt = MONEY));
      [4, 5, 6].forEach((c) => (row.getCell(c).numFmt = MONEY0));
      row.getCell(7).numFmt = "0.0%";
      for (let c = 1; c <= 7; c++) {
        font(row.getCell(c), { bold: t === form.ges.tier || c >= 6 });
        if (c > 1) row.getCell(c).alignment = { horizontal: "right" };
        if (t === form.ges.tier) fill(row.getCell(c), SUN);
      }
      underline(row, 7);
      r += 1;
    });
    r += 1;
    head([
      "Opsiyonel hizmet",
      "Birim",
      "Taşeron fiyatı",
      "Kâr oranı",
      "Müşteri fiyatı",
      "Birim kâr",
      "Marj",
    ]);
    for (const o of GES_OPTIONS) {
      const row = ws.getRow(r);
      const p = prices.gesOptions[o.key];
      const sale = optionSale(prices, o.key);
      row.values = [o.label, o.unit, p.cost, p.margin, sale];
      row.getCell(6).value = { formula: `E${r}-C${r}`, result: sale - p.cost };
      row.getCell(7).value = {
        formula: `IF(E${r}>0,F${r}/E${r},0)`,
        result: sale > 0 ? (sale - p.cost) / sale : 0,
      };
      [3, 5, 6].forEach((c) => (row.getCell(c).numFmt = MONEY));
      [4, 7].forEach((c) => (row.getCell(c).numFmt = "0.0%"));
      for (let c = 1; c <= 7; c++) {
        font(row.getCell(c), { size: 9 });
        if (c > 1) row.getCell(c).alignment = { horizontal: "right" };
      }
      row.getCell(1).alignment = { wrapText: true };
      row.height = 26;
      underline(row, 7);
      r += 1;
    }
    r += 1;
  }
  head([
    "Bu teklifin kalemleri",
    "",
    "",
    "Taşeron maliyeti",
    "Satış (KDV hariç)",
    "Brüt kâr",
    "Marj",
  ]);
  const first = r;
  for (const l of result.lines) {
    const row = ws.getRow(r);
    ws.mergeCells(`A${r}:C${r}`);
    row.getCell(1).value = `${l.label} · ${l.detail}`;
    row.getCell(4).value = l.cost ?? "Maliyet girilmedi";
    row.getCell(5).value = l.amount;
    if (l.cost !== null) {
      row.getCell(6).value = {
        formula: `E${r}-D${r}`,
        result: l.amount - l.cost,
      };
      row.getCell(7).value = {
        formula: `IF(E${r}>0,F${r}/E${r},0)`,
        result: l.amount > 0 ? (l.amount - l.cost) / l.amount : 0,
      };
    }
    [4, 5, 6].forEach((c) => (row.getCell(c).numFmt = MONEY0));
    row.getCell(7).numFmt = "0.0%";
    for (let c = 1; c <= 7; c++) {
      font(row.getCell(c), { size: 9 });
      if (c > 1) row.getCell(c).alignment = { horizontal: "right" };
    }
    row.getCell(1).alignment = { wrapText: true };
    row.height = 26;
    underline(row, 7);
    r += 1;
  }
  const lastL = r - 1;
  const tr = ws.getRow(r);
  ws.mergeCells(`A${r}:C${r}`);
  tr.getCell(1).value = "Toplam (iskonto öncesi; maliyeti bilinen kalemler)";
  tr.getCell(4).value = {
    formula: `SUM(D${first}:D${lastL})`,
    result: result.knownCost,
  };
  tr.getCell(5).value = {
    formula: `SUMIF(D${first}:D${lastL},">=0",E${first}:E${lastL})`,
    result: result.lines
      .filter((l) => l.cost !== null)
      .reduce((s, l) => s + l.amount, 0),
  };
  const knownSale = result.lines
    .filter((l) => l.cost !== null)
    .reduce((s, l) => s + l.amount, 0);
  tr.getCell(6).value = {
    formula: `E${r}-D${r}`,
    result: knownSale - result.knownCost,
  };
  tr.getCell(7).value = {
    formula: `IF(E${r}>0,F${r}/E${r},0)`,
    result: knownSale > 0 ? (knownSale - result.knownCost) / knownSale : 0,
  };
  [4, 5, 6].forEach((c) => (tr.getCell(c).numFmt = MONEY0));
  tr.getCell(7).numFmt = "0.0%";
  for (let c = 1; c <= 7; c++) {
    font(tr.getCell(c), { bold: true, color: "FFFFFFFF" });
    fill(tr.getCell(c), SAGE_DD);
    if (c > 1) tr.getCell(c).alignment = { horizontal: "right" };
  }
  r += 2;
  r = para(
    ws,
    r,
    last,
    `Teklifteki genel iskonto: %${Math.round(form.discount * 1000) / 10}. İskonto, yukarıdaki satış tutarlarından ayrıca düşülür. Marjın ulaşım, konaklama, drone ve ölçüm cihazı amortismanı gibi NES giderlerini karşıladığını kontrol edin. Trafo ve işletme sorumluluğu kalemlerinin taşeron maliyeti bu ekranda tutulmuyor.`,
    W.reduce((a, b) => a + b, 0),
    { size: 8.5, color: MUTE },
  );
  ws.pageSetup.printArea = `A1:${last}${r}`;
  return toBlob(wb);
}

// ============================================================ taşeron talebi

export async function buildSubcontractorRequestWorkbook(input: {
  form: MaintenanceOfferInput;
  prices: MaintenancePrices;
  logoUrl: string;
}): Promise<Blob> {
  const { form, prices } = input;
  const { wb, logo } = await newWorkbook(input.logoUrl);
  const W = [46, 17, 17, 17];
  const TW = W.reduce((a, b) => a + b, 0);
  const { ws, last } = sheet(
    wb,
    logo,
    "Fiyat Talebi",
    "Taşeron Fiyat Talebi",
    W,
  );
  let r = 3;
  r = heading(ws, r, last, "GES BAKIM HİZMETİ FİYAT TALEBİ", 15);
  r += 1;
  r = infoRows(ws, r, last, [
    ["Talep no / tarih", `${form.offerNo}-T  ·  ${trDate(form.offerDate)}`],
    ["Tesis konumu", form.location || "—"],
    ["Tesis tipi / kurulu güç", siteLine(form)],
    ["Sözleşme süresi", "12 ay"],
  ]);
  r += 1;
  r = para(
    ws,
    r,
    last,
    "Aşağıdaki kapsamda, Ek-1 Teknik Şartname'ye uygun bakım hizmeti için kWp başına yıllık birim fiyatınızı (KDV hariç) sarı hücrelere yazarak iletmenizi rica ederiz. Ölçüm cihazı kalibrasyon belgeleri, drone pilot / uçuş yetki belgeleri ve İSG belgeleri teklifinize eklenmelidir.",
    TW,
    { size: 9.5 },
  );
  r += 1;
  const h = ws.getRow(r);
  h.getCell(1).value = "Hizmet kapsamı";
  font(h.getCell(1), { bold: true, color: "FFFFFFFF" });
  fill(h.getCell(1), SAGE_DD);
  h.getCell(1).alignment = { indent: 1, vertical: "middle" };
  GES_TIERS.forEach((t, i) => {
    const c = h.getCell(i + 2);
    c.value = GES_TIER_LABEL[t].toUpperCase();
    font(c, { bold: true, color: "FFFFFFFF" });
    fill(c, TIER_BG[i]);
    c.alignment = { horizontal: "center", vertical: "middle" };
  });
  h.height = 22;
  r += 1;
  for (const [label, cells] of GES_SCOPE) {
    const row = ws.getRow(r);
    row.getCell(1).value = label;
    font(row.getCell(1));
    row.getCell(1).alignment = { indent: 1 };
    GES_TIERS.forEach((t, i) => scopeMark(row.getCell(i + 2), cells[t], false));
    underline(row, 4);
    row.height = 19;
    r += 1;
  }
  const vr = ws.getRow(r);
  vr.getCell(1).value = "Yıllık saha ziyareti";
  font(vr.getCell(1));
  vr.getCell(1).alignment = { indent: 1 };
  GES_TIERS.forEach((t, i) => {
    const c = vr.getCell(i + 2);
    c.value = `${prices.ges[t].visits} kez`;
    font(c, { bold: true });
    c.alignment = { horizontal: "center" };
  });
  r += 1;
  const pr = ws.getRow(r);
  pr.getCell(1).value =
    `Birim fiyatınız (₺ / kWp / yıl, KDV hariç) · ${SITE_LABEL[form.ges.site]}`;
  font(pr.getCell(1), { bold: true });
  fill(pr.getCell(1), SUN);
  pr.getCell(1).alignment = { indent: 1, vertical: "middle" };
  for (let c = 2; c <= 4; c++) {
    const cell = pr.getCell(c);
    fill(cell, INPUT);
    cell.numFmt = MONEY;
    cell.border = { top: thin, bottom: thin, left: thin, right: thin };
    font(cell, { color: "FF0000FF" });
  }
  pr.height = 24;
  r += 2;
  const oh = ws.getRow(r);
  oh.getCell(1).value = "Opsiyonel hizmetler";
  oh.getCell(2).value = "Birim";
  ws.mergeCells(`C${r}:D${r}`);
  oh.getCell(3).value = "Birim fiyatınız (KDV hariç)";
  [1, 2, 3].forEach((c) => {
    font(oh.getCell(c), { size: 9, bold: true, color: "FFFFFFFF" });
    fill(oh.getCell(c), SAGE_DD);
    oh.getCell(c).alignment = {
      horizontal: c === 1 ? "left" : "center",
      indent: c === 1 ? 1 : 0,
    };
  });
  r += 1;
  for (const o of GES_OPTIONS) {
    const row = ws.getRow(r);
    row.getCell(1).value = o.label;
    row.getCell(2).value = o.unit;
    font(row.getCell(1), { size: 9.5 });
    font(row.getCell(2), { size: 9, color: MUTE });
    row.getCell(1).alignment = { indent: 1, wrapText: true };
    row.getCell(2).alignment = { horizontal: "center" };
    ws.mergeCells(`C${r}:D${r}`);
    const cell = row.getCell(3);
    fill(cell, INPUT);
    cell.numFmt = MONEY;
    cell.border = { top: thin, bottom: thin, left: thin, right: thin };
    row.height = 19;
    r += 1;
  }
  r += 1;
  for (const label of [
    "Firma unvanı",
    "Yetkili / telefon",
    "Teklif geçerlilik süresi",
    "Tarih / kaşe / imza",
  ]) {
    ws.getCell(`A${r}`).value = label;
    font(ws.getCell(`A${r}`), { size: 9, bold: true, color: MUTE });
    ws.mergeCells(`B${r}:D${r}`);
    const cell = ws.getCell(`B${r}`);
    fill(cell, INPUT);
    cell.border = { top: thin, bottom: thin, left: thin, right: thin };
    ws.getRow(r).height = 20;
    r += 1;
  }
  r += 1;
  r = para(
    ws,
    r,
    last,
    "Gizlilik: Bu talepteki tesis bilgileri yalnızca fiyatlandırma amacıyla paylaşılmıştır; NES Enerji'nin yazılı onayı olmadan tesis sahibi veya üçüncü kişilerle doğrudan iletişime geçilmemesi rica olunur.",
    TW,
    { size: 8, color: MUTE },
  );
  ws.pageSetup.printArea = `A1:${last}${r}`;

  // Teknik şartname de taşerona gider
  const s = sheet(
    wb,
    logo,
    "Ek-1 Teknik Şartname",
    "Ek-1 · Teknik Şartname",
    W,
  );
  let q = 3;
  q = heading(
    s.ws,
    q,
    s.last,
    "EK-1 · GES BAKIM HİZMETLERİ TEKNİK ŞARTNAMESİ",
    14,
  );
  q += 1;
  for (const [title, paras] of GES_SPEC) {
    s.ws.getCell(`A${q}`).value = title;
    font(s.ws.getCell(`A${q}`), { bold: true, color: NAVY });
    q += 1;
    for (const p of paras)
      q = para(s.ws, q, s.last, p, TW, { size: 8.8, indent: 1 });
    s.ws.getRow(q).height = 4;
    q += 1;
  }
  s.ws.pageSetup.printArea = `A1:${s.last}${q}`;
  return toBlob(wb);
}

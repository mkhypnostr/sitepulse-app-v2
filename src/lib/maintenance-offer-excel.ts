// Bakım paketleri fiyat çalışması (Excel). Müşteriye / iş ortağına iletmek
// için PDF ile aynı içerik:
//  - "Fiyat Çalışması": seçilen hizmetler, miktar × birim fiyat, iskonto, KDV.
//    Formüllüdür; Excel'de miktar, fiyat, iskonto veya KDV değişirse toplamlar
//    kendiliğinden güncellenir (GES satırında asgari yıllık bedel korunur).
//  - "Paket Kapsamı": GES ve trafo paketlerinin kalem kalem karşılaştırması ve
//    bu tesise göre kademe fiyatları.
//  - "Ek Hizmetler": talep halinde birim fiyatlar.

import {
  EXTRAS,
  GES_SCOPE,
  GES_TIER_NOTE,
  KVA_BANDS,
  TIERS,
  TIER_LABEL,
  TRAFO_SCOPE,
  TRAFO_TIER_NOTE,
  type MaintenanceOfferInput,
  type MaintenanceOfferResult,
  type MaintenancePrices,
  type Tier,
} from "@/lib/maintenance-offer";
import { NES_COMPANY, NES_CONTACT_LINE } from "@/lib/nes-company";

type Cell = import("exceljs").Cell;
type Worksheet = import("exceljs").Worksheet;

const SAGE_DD = "FF3E5050";
const SAGE = "FF829797";
const MIST = "FFEEF4F4";
const SUN = "FFFFF4DC";
const MONEY = '#,##0.00 "₺"';

export async function buildMaintenanceOfferWorkbook(input: {
  form: MaintenanceOfferInput;
  prices: MaintenancePrices;
  result: MaintenanceOfferResult;
  logoUrl: string;
}): Promise<Blob> {
  const { form, prices, result } = input;
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = NES_COMPANY.brand;
  wb.created = new Date();

  const thin = { style: "thin" as const, color: { argb: "FFC9D3D3" } };
  const line = (cell: Cell) => {
    cell.border = { bottom: thin };
  };
  const fill = (cell: Cell, argb: string) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
  };
  const head = (row: import("exceljs").Row) =>
    row.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      fill(cell, SAGE_DD);
      cell.alignment = { vertical: "middle", wrapText: true };
    });

  let logo: number | null = null;
  try {
    const buf = await fetch(input.logoUrl).then((r) => r.arrayBuffer());
    logo = wb.addImage({ buffer: buf, extension: "png" });
  } catch {
    logo = null;
  }

  /** Antet: logo, başlık, firma ve müşteri bilgisi. Sonraki boş satırı döner. */
  const letterhead = (ws: Worksheet, title: string, lastCol: string) => {
    ws.getRow(1).height = 34;
    if (logo !== null)
      ws.addImage(logo, {
        tl: { col: 0, row: 0.15 },
        ext: { width: 150, height: 36 },
      });
    ws.mergeCells(`C1:${lastCol}1`);
    const t = ws.getCell("C1");
    t.value = title;
    t.font = { bold: true, size: 15 };
    t.alignment = { horizontal: "right", vertical: "middle" };
    ws.mergeCells(`A2:${lastCol}2`);
    ws.getCell("A2").value =
      `${NES_COMPANY.legalNameShort} · ${NES_CONTACT_LINE}`;
    ws.getCell("A2").font = { size: 8, color: { argb: "FF5D6767" } };
    const meta: [string, string][] = [
      ["Müşteri / Firma", form.customerName],
      ["Tesis", form.address],
      [
        "Yetkili",
        [form.contactPerson, form.contactInfo].filter(Boolean).join(" · "),
      ],
      ["Teklif no / tarih", `${form.offerNo} · ${trDate(form.offerDate)}`],
    ];
    meta.forEach(([k, v], i) => {
      const r = 4 + i;
      ws.getCell(`A${r}`).value = k;
      ws.getCell(`A${r}`).font = { color: { argb: "FF5D6767" } };
      ws.mergeCells(`B${r}:${lastCol}${r}`);
      ws.getCell(`B${r}`).value = v;
      ws.getCell(`B${r}`).font = { bold: true };
    });
    return 9;
  };

  // ------------------------------------------------------------ Fiyat Çalışması
  const ws = wb.addWorksheet("Fiyat Çalışması", {
    pageSetup: {
      paperSize: 9,
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  });
  ws.columns = [
    { width: 34 },
    { width: 40 },
    { width: 11 },
    { width: 10 },
    { width: 16 },
    { width: 16 },
    { width: 18 },
  ];
  let r = letterhead(ws, "Bakım Paketleri Fiyat Çalışması", "G");
  ws.getRow(r).values = [
    "Hizmet",
    "Açıklama",
    "Miktar",
    "Birim",
    "Birim fiyat",
    "Asgari bedel",
    "Yıllık tutar",
  ];
  head(ws.getRow(r));
  ws.getRow(r).height = 20;
  const first = r + 1;

  const addLine = (opts: {
    service: string;
    detail: string;
    qty: number;
    unit: string;
    price: number;
    min?: number;
    amount: number;
  }) => {
    r += 1;
    const row = ws.getRow(r);
    row.getCell(1).value = opts.service;
    row.getCell(2).value = opts.detail;
    row.getCell(3).value = opts.qty;
    row.getCell(4).value = opts.unit;
    row.getCell(5).value = opts.price;
    if (opts.min !== undefined) row.getCell(6).value = opts.min;
    row.getCell(7).value = {
      formula:
        opts.min !== undefined
          ? `IF(C${r}>0,MAX(C${r}*E${r},F${r}),0)`
          : `C${r}*E${r}`,
      result: opts.amount,
    };
    [5, 6, 7].forEach((c) => (row.getCell(c).numFmt = MONEY));
    row.getCell(3).numFmt = "#,##0.##";
    row.eachCell({ includeEmpty: true }, (cell) => {
      line(cell);
      cell.alignment = { vertical: "top", wrapText: true };
    });
    // Değiştirilebilir giriş hücreleri açık sarı.
    [3, 5, 6].forEach((c) => {
      if (row.getCell(c).value !== null) fill(row.getCell(c), SUN);
    });
  };

  if (form.ges.enabled) {
    const p = prices.ges[form.ges.tier];
    addLine({
      service: `GES bakım paketi · ${TIER_LABEL[form.ges.tier]}`,
      detail: `${GES_TIER_NOTE[form.ges.tier]}; 12 ay${form.ges.inverters ? ` · ${form.ges.inverters} inverter` : ""}${form.ges.siteType ? ` · ${form.ges.siteType}` : ""}`,
      qty: form.ges.kwp,
      unit: "kWp",
      price: p.perKwp,
      min: p.min,
      amount: result.gesTiers[form.ges.tier],
    });
  }
  if (form.trafo.enabled) {
    addLine({
      service: `Trafo merkezi bakım paketi · ${TIER_LABEL[form.trafo.tier]}`,
      detail: `${TRAFO_TIER_NOTE[form.trafo.tier]}; ${form.trafo.kva} kVA (${KVA_BANDS[result.trafoBand].label})${form.trafo.voltage ? ` · ${form.trafo.voltage}` : ""}${form.trafo.kind ? ` · ${form.trafo.kind}` : ""}`,
      qty: Math.max(1, form.trafo.count),
      unit: "Trafo",
      price: prices.trafo[form.trafo.tier][result.trafoBand],
      amount: result.trafoTiers[form.trafo.tier],
    });
  }
  if (form.isEnabled) {
    addLine({
      service: "Elektrik işletme sorumluluğu",
      detail: `${KVA_BANDS[result.isBand].label}${result.isDiscountApplied ? ` · paket indirimi %${pctText(result.isDiscountApplied)} uygulandı` : ""}`,
      qty: 12,
      unit: "Ay",
      price: result.isMonthly,
      amount: result.isYearly,
    });
  }
  for (const x of EXTRAS) {
    const qty = form.extras[x.key] ?? 0;
    if (qty > 0)
      addLine({
        service: x.label,
        detail: "Ek hizmet",
        qty,
        unit: x.unit,
        price: prices.extras[x.key],
        amount: qty * prices.extras[x.key],
      });
  }
  const last = r;
  const sumRange = last >= first ? `G${first}:G${last}` : null;

  const total = (
    label: string,
    formula: string,
    value: number,
    opts: { strong?: boolean; rateCell?: number; grand?: boolean } = {},
  ) => {
    r += 1;
    const row = ws.getRow(r);
    ws.mergeCells(`A${r}:E${r}`);
    row.getCell(1).value = label;
    row.getCell(1).alignment = { horizontal: "right" };
    if (opts.rateCell !== undefined) {
      row.getCell(6).value = opts.rateCell;
      row.getCell(6).numFmt = "0.0%";
      fill(row.getCell(6), SUN);
    }
    row.getCell(7).value = { formula, result: value };
    row.getCell(7).numFmt = MONEY;
    if (opts.strong || opts.grand) {
      row.getCell(1).font = { bold: true };
      row.getCell(7).font = { bold: true };
    }
    if (opts.grand) {
      [1, 7].forEach((c) => {
        fill(row.getCell(c), SAGE_DD);
        row.getCell(c).font = {
          bold: true,
          color: { argb: "FFFFFFFF" },
          size: 12,
        };
      });
      fill(row.getCell(6), SAGE_DD);
    }
    return r;
  };
  r += 1;
  const sub = total(
    "Ara toplam",
    sumRange ? `SUM(${sumRange})` : "0",
    result.subtotal,
  );
  const disc = total("İskonto", `G${sub}*F${sub + 1}`, result.discountAmount, {
    rateCell: form.discount,
  });
  const net = total("Toplam (KDV hariç)", `G${sub}-G${disc}`, result.net, {
    strong: true,
  });
  const vat = total("KDV", `G${net}*F${net + 1}`, result.vat, {
    rateCell: form.vatRate,
  });
  total("Genel toplam (yıllık)", `G${net}+G${vat}`, result.grandTotal, {
    grand: true,
  });

  r += 2;
  const notes = [
    "Paket bedelleri 12 aylık sözleşme süresi içindir. Fiyatlar KDV hariçtir.",
    `Ödeme: ${form.payment || "sözleşmede belirtilir"}. İşletme sorumluluğu aylık faturalandırılır.`,
    "Yedek parça, sarf malzemesi ve laboratuvar dışı üçüncü taraf hizmetleri pakete dahil değildir.",
    "Enerji kesintisi gerektiren işler müşteri ve dağıtım şirketiyle en az 7 gün önceden planlanır.",
    `Teklif geçerlilik süresi ${form.validityDays} gündür.`,
    "Sarı hücreler değiştirilebilir; toplamlar kendiliğinden yeniden hesaplanır.",
  ];
  notes.forEach((n) => {
    ws.mergeCells(`A${r}:G${r}`);
    ws.getCell(`A${r}`).value = `• ${n}`;
    ws.getCell(`A${r}`).font = { size: 9, color: { argb: "FF5D6767" } };
    r += 1;
  });
  ws.views = [{ state: "frozen", ySplit: 9, showGridLines: false }];

  // ------------------------------------------------------------ Paket Kapsamı
  const sc = wb.addWorksheet("Paket Kapsamı", {
    pageSetup: {
      paperSize: 9,
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  });
  sc.columns = [{ width: 62 }, { width: 18 }, { width: 18 }, { width: 18 }];
  let s = letterhead(sc, "Bakım Paketleri Kapsamı", "D");
  const scope = (
    title: string,
    groups: typeof GES_SCOPE,
    notes: Record<Tier, string>,
    amounts: Record<Tier, number>,
    selected: Tier,
    basis: string,
  ) => {
    sc.getRow(s).values = [
      title,
      ...TIERS.map(
        (t) => `${TIER_LABEL[t]}${t === selected ? " ★" : ""}\n${notes[t]}`,
      ),
    ];
    head(sc.getRow(s));
    sc.getRow(s).height = 30;
    for (let c = 2; c <= 4; c++)
      sc.getRow(s).getCell(c).alignment = {
        horizontal: "center",
        vertical: "middle",
        wrapText: true,
      };
    s += 1;
    for (const [g, rows] of groups) {
      sc.getCell(`A${s}`).value = g;
      sc.getCell(`A${s}`).font = { bold: true, color: { argb: SAGE } };
      s += 1;
      for (const [label, ...cells] of rows) {
        const row = sc.getRow(s);
        row.getCell(1).value = label;
        cells.forEach((c, i) => {
          const cell = row.getCell(i + 2);
          cell.value = c === true ? "●" : c === false ? "—" : c;
          cell.alignment = { horizontal: "center" };
          if (TIERS[i] === selected) fill(cell, SUN);
        });
        row.eachCell({ includeEmpty: true }, line);
        s += 1;
      }
    }
    const pr = sc.getRow(s);
    pr.getCell(1).value = `Yıllık paket bedeli (KDV hariç) · ${basis}`;
    pr.getCell(1).font = { bold: true };
    TIERS.forEach((t, i) => {
      const cell = pr.getCell(i + 2);
      cell.value = amounts[t];
      cell.numFmt = MONEY;
      cell.font = { bold: true };
      fill(cell, t === selected ? SUN : MIST);
    });
    s += 3;
  };
  if (form.ges.enabled)
    scope(
      "GES bakım paketleri",
      GES_SCOPE,
      GES_TIER_NOTE,
      result.gesTiers,
      form.ges.tier,
      `${form.ges.kwp} kWp`,
    );
  if (form.trafo.enabled)
    scope(
      "Trafo merkezi bakım paketleri",
      TRAFO_SCOPE,
      TRAFO_TIER_NOTE,
      result.trafoTiers,
      form.trafo.tier,
      `${Math.max(1, form.trafo.count)} × ${form.trafo.kva} kVA`,
    );
  if (!form.ges.enabled && !form.trafo.enabled) {
    sc.getCell(`A${s}`).value = "Bu teklifte bakım paketi seçilmedi.";
    s += 2;
  }
  sc.getCell(`A${s}`).value =
    "★ Önerilen paket. Sarı sütun teklifte seçilen kademedir.";
  sc.getCell(`A${s}`).font = { size: 9, color: { argb: "FF5D6767" } };
  sc.views = [{ showGridLines: false }];

  // ------------------------------------------------------------ Ek Hizmetler
  const ex = wb.addWorksheet("Ek Hizmetler");
  ex.columns = [{ width: 46 }, { width: 12 }, { width: 18 }];
  let e = letterhead(ex, "Ek Hizmetler", "C");
  ex.getRow(e).values = [
    "Ek hizmet (talep halinde)",
    "Birim",
    "Birim fiyat (KDV hariç)",
  ];
  head(ex.getRow(e));
  e += 1;
  for (const x of EXTRAS) {
    const row = ex.getRow(e);
    row.values = [x.label, x.unit, prices.extras[x.key]];
    row.getCell(3).numFmt = MONEY;
    row.eachCell({ includeEmpty: true }, line);
    e += 1;
  }
  if (form.isEnabled) {
    e += 2;
    ex.getRow(e).values = [
      "Elektrik işletme sorumluluğu",
      "Kademe",
      "Aylık bedel (KDV hariç)",
    ];
    head(ex.getRow(e));
    e += 1;
    KVA_BANDS.forEach((b, i) => {
      const row = ex.getRow(e);
      row.values = [
        i === result.isBand ? "Tesisiniz" : "",
        b.label,
        prices.isMonthly[i],
      ];
      row.getCell(3).numFmt = MONEY;
      if (i === result.isBand)
        row.eachCell({ includeEmpty: true }, (c) => fill(c, SUN));
      row.eachCell({ includeEmpty: true }, line);
      e += 1;
    });
  }
  ex.views = [{ showGridLines: false }];

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function trDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}.${m}.${y}` : iso;
}

function pctText(rate: number) {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(
    rate * 100,
  );
}

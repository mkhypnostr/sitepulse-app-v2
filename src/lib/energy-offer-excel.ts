// Teklifin iç maliyet dökümü (yalnız yönetici). NES'in kendi maliyet
// dosyalarının düzeni izlenir:
//  - "Net Maliyetler": GES maliyet tabloları (DG Otomotiv R2, B. Kolkesen,
//    Cihan İnşaat) gibi modül başına Sıra / Ürün İsmi / Ürün-Hizmet özelliği /
//    Miktar / Birim / Fiyat / Tutar, altta Tutar / KDV / Toplam ve
//    "Ürünlerin net maliyetleridir. Kurum harçları dahil değildir." notu.
//  - "Maliyet ve Satış": EV şarj maliyet çalışmaları (SEMU, Kafaca Üset) gibi
//    Metraj / Birim / Birim geliş fiyatı / Maliyet toplam / KDV / Satış fiyatı /
//    Toplam, altta toplam maliyet, toplam satış ve toplam kâr.
// Formüllüdür: kur, miktar, fiyat veya kâr oranı Excel'de değişirse toplamlar
// kendiliğinden güncellenir. Alış fiyatı 0 olan satırlar kırmızıdır.

import type {
  Currency,
  ExchangeRates,
  OfferModule,
  PricedLine,
} from "@/lib/energy-offer";

type Cell = import("exceljs").Cell;
type Worksheet = import("exceljs").Worksheet;

const moduleNames: Record<OfferModule, string> = {
  ges: "GES",
  sarj: "Şarj",
  taahhut: "Taahhüt",
  genel: "Genel",
};

const unitNames: Record<string, string> = {
  adet: "Adet",
  "ad.": "Adet",
  m: "Mt",
  set: "Set",
  paket: "Paket",
  kg: "Kg",
  boy: "Boy",
};

const RED_FILL = "FFFDE2E1";
const RED_TEXT = "FFB42318";
const HEAD_FILL = "FFDCE6F2";

/** "Ad (model)" açıklamasını NES tablolarındaki "Ürün İsmi" ve "özellik"
 * sütunlarına ayırır; marka varsa isme eklenir (ör. "Solar inverter - Deye"). */
function splitName(line: PricedLine): [string, string] {
  // Sondaki parantez grubunu (iç içe parantezler dahil) özellik olarak ayır.
  const text = line.description.trim();
  let name = text;
  let spec = "";
  if (text.endsWith(")")) {
    let depth = 0;
    for (let i = text.length - 1; i >= 0; i -= 1) {
      if (text[i] === ")") depth += 1;
      else if (text[i] === "(") depth -= 1;
      if (depth === 0) {
        name = text.slice(0, i).trim();
        spec = text.slice(i + 1, -1).trim();
        break;
      }
    }
  }
  return [line.brand ? `${name} - ${line.brand}` : name, spec];
}

export async function buildInternalCostWorkbook(input: {
  offerNo: string;
  title: string;
  recipientName: string;
  currency: Currency;
  rates: ExchangeRates;
  vatRate: number;
  lines: PricedLine[];
  catalogCodes: Map<string, string>;
  logoUrl: string;
  /** Modül başlıkları, ör. GES: "22,5 kWp DC - 20 kWe AC - 20 kWh batarya kapasiteli GES". */
  moduleTitles?: Partial<Record<OfferModule, string>>;
}): Promise<Blob> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "NES Enerji";
  wb.created = new Date();
  const vat = input.vatRate;
  const vatPct = Math.round(vat * 100);

  const thin = { style: "thin" as const, color: { argb: "FF9AA5B1" } };
  const box = (cell: Cell) => {
    cell.border = { top: thin, left: thin, bottom: thin, right: thin };
  };
  const fill = (cell: Cell, argb: string) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
  };
  const fmt = (currency: Currency) =>
    `#,##0.00 "${currency === "TRY" ? "₺" : currency === "USD" ? "$" : "€"}"`;

  // ---------------------------------------------------------------- Kurlar
  const kur = wb.addWorksheet("Kurlar");
  kur.columns = [{ width: 24 }, { width: 16 }];
  kur.addRow(["Para birimi", "1 birim = ? TL"]).eachCell((cell) => {
    cell.font = { bold: true };
    fill(cell, HEAD_FILL);
  });
  kur.addRow(["TRY", 1]);
  kur.addRow(["USD", input.rates.USD || 0]);
  kur.addRow(["EUR", input.rates.EUR || 0]);
  kur.getCell("A6").value =
    "Kurları buradan değiştirirseniz diğer sayfalar yeniden hesaplanır.";
  kur.getCell("A6").font = { italic: true, color: { argb: "FF6B7385" } };
  const rateRef: Record<Currency, string> = {
    TRY: "Kurlar!$B$2",
    USD: "Kurlar!$B$3",
    EUR: "Kurlar!$B$4",
  };
  /** Kaynak para birimindeki fiyatı hedef para birimine çeviren formül. */
  const convertFormula = (priceRef: string, from: Currency, to: Currency) =>
    from === to ? priceRef : `${priceRef}*${rateRef[from]}/${rateRef[to]}`;

  const visible = input.lines;
  const modules = (["ges", "sarj", "taahhut", "genel"] as OfferModule[]).filter(
    (module) => visible.some((line) => line.module === module),
  );

  // ---------------------------------------------------------------- Net Maliyetler
  const net = wb.addWorksheet("Net Maliyetler");
  net.columns = [
    { width: 6 },
    { width: 38 },
    { width: 44 },
    { width: 9 },
    { width: 8 },
    { width: 14 },
    { width: 15 },
    { width: 30 },
  ];
  try {
    const logo = await fetch(input.logoUrl).then((r) => r.arrayBuffer());
    const id = wb.addImage({ buffer: logo, extension: "png" });
    net.addImage(id, {
      tl: { col: 0, row: 0 },
      ext: { width: 150, height: 46 },
    });
  } catch {
    // Logo yüklenemezse dosya logosuz oluşur.
  }
  net.getCell("C1").value = `${input.offerNo} · ${input.title}`;
  net.getCell("C1").font = { bold: true, size: 12 };
  net.getCell("C2").value =
    `Teklif verilen: ${input.recipientName || "-"} · İç kullanım içindir, müşteriye gönderilmez.`;
  net.getCell("C2").font = { italic: true, color: { argb: RED_TEXT } };

  let r = 4;
  for (const module of modules) {
    const lines = visible
      .filter((line) => line.module === module)
      .sort((a, b) => b.totalCost - a.totalCost);
    const currencies = new Set(lines.map((line) => line.sourceCurrency));
    // NES tablolarında GES dolar, şarj TL tutulur: blok tek para birimindeyse
    // o para birimi, karışıksa teklif para birimi kullanılır.
    const blockCur: Currency =
      currencies.size === 1 ? [...currencies][0] : input.currency;
    const title = `${input.moduleTitles?.[module] ?? moduleNames[module]} - Net Maliyetler`;
    net.mergeCells(r, 1, r, 7);
    net.getCell(r, 1).value = title;
    net.getCell(r, 1).font = { bold: true, size: 12 };
    r += 1;
    const head = net.getRow(r);
    [
      "Sıra",
      "Ürün İsmi",
      "Ürün / Hizmet özelliği",
      "Miktar",
      "Birim",
      `Fiyat (${blockCur})`,
      `Tutar (${blockCur})`,
      "Not",
    ].forEach((text, index) => {
      const cell = head.getCell(index + 1);
      cell.value = text;
      cell.font = { bold: true };
      fill(cell, HEAD_FILL);
      box(cell);
    });
    r += 1;
    const first = r;
    lines.forEach((line, index) => {
      const [name, spec] = splitName(line);
      const row = net.getRow(r);
      row.getCell(1).value = index + 1;
      row.getCell(2).value = name;
      row.getCell(3).value = spec;
      row.getCell(4).value = line.quantity;
      row.getCell(5).value = unitNames[line.unit] ?? line.unit;
      // Fiyat hücresi kaynak fiyat × kur; kaynak fiyatı yorumda.
      row.getCell(6).value = {
        formula: convertFormula(
          String(line.sourceUnitCost),
          line.sourceCurrency,
          blockCur,
        ),
      };
      row.getCell(7).value = { formula: `D${r}*F${r}` };
      row.getCell(6).numFmt = fmt(blockCur);
      row.getCell(7).numFmt = fmt(blockCur);
      if (line.sourceCurrency !== blockCur) {
        row.getCell(8).value =
          `Alış ${line.sourceUnitCost} ${line.sourceCurrency}`;
      }
      if (!(line.sourceUnitCost > 0)) {
        for (let c = 1; c <= 8; c += 1) {
          fill(row.getCell(c), RED_FILL);
          row.getCell(c).font = { color: { argb: RED_TEXT } };
        }
        row.getCell(8).value = "Alış fiyatı 0 — neden 0? Teyit edin.";
        row.getCell(8).font = { bold: true, color: { argb: RED_TEXT } };
      }
      for (let c = 1; c <= 8; c += 1) box(row.getCell(c));
      r += 1;
    });
    const last = r - 1;
    const totals: [string, string][] = [
      ["Tutar", `SUM(G${first}:G${last})`],
      [`KDV %${vatPct}`, `G${r}*${vat}`],
      ["Toplam", `G${r}+G${r + 1}`],
    ];
    totals.forEach(([label, formula], index) => {
      const row = net.getRow(r + index);
      row.getCell(6).value = label;
      row.getCell(6).font = { bold: true };
      row.getCell(7).value = { formula };
      row.getCell(7).numFmt = fmt(blockCur);
      row.getCell(7).font = { bold: true };
    });
    net.getCell(r + 1, 2).value = "Ürünlerin net maliyetleridir.";
    net.getCell(r + 2, 2).value = "Kurum harçları dahil değildir.";
    net.getCell(r + 1, 2).font = { italic: true };
    net.getCell(r + 2, 2).font = { italic: true };
    r += 5;
  }

  // ---------------------------------------------------------------- Maliyet ve Satış
  const ms = wb.addWorksheet("Maliyet ve Satış", {
    views: [{ state: "frozen", ySplit: 3 }],
  });
  const cur = input.currency;
  ms.columns = [
    { width: 46 },
    { width: 9 },
    { width: 8 },
    { width: 16 },
    { width: 16 },
    { width: 9 },
    { width: 7 },
    { width: 16 },
    { width: 16 },
    { width: 11 },
    { width: 32 },
  ];
  ms.mergeCells(1, 1, 1, 9);
  ms.getCell(1, 1).value =
    `${(input.recipientName || input.title).toLocaleUpperCase("tr-TR")} — MALİYET ÇALIŞMASI (${cur})`;
  ms.getCell(1, 1).font = { bold: true, size: 12 };
  const msHead = ms.getRow(3);
  [
    "",
    "METRAJ",
    "BİRİM",
    "BİRİM GELİŞ FİYATI",
    "MALİYET TOPLAM",
    "KÂR %",
    "KDV",
    "SATIŞ FİYATI",
    "TOPLAM",
    "MÜŞTERİYE GÖRÜNÜR",
    "NOT",
  ].forEach((text, index) => {
    const cell = msHead.getCell(index + 1);
    cell.value = text;
    cell.font = { bold: true };
    fill(cell, HEAD_FILL);
    box(cell);
  });
  let m = 4;
  const msFirst = m;
  for (const module of modules) {
    const groupRow = ms.getRow(m);
    groupRow.getCell(1).value = moduleNames[module].toLocaleUpperCase("tr-TR");
    groupRow.getCell(1).font = { bold: true, color: { argb: "FF0046A4" } };
    m += 1;
    for (const line of visible.filter((item) => item.module === module)) {
      const row = ms.getRow(m);
      row.getCell(1).value = line.description.toLocaleUpperCase("tr-TR");
      row.getCell(2).value = line.quantity;
      row.getCell(3).value = (
        unitNames[line.unit] ?? line.unit
      ).toLocaleUpperCase("tr-TR");
      row.getCell(4).value = {
        formula: convertFormula(
          String(line.sourceUnitCost),
          line.sourceCurrency,
          cur,
        ),
      };
      row.getCell(5).value = { formula: `B${m}*D${m}` };
      row.getCell(6).value = line.markupRate;
      row.getCell(7).value = vat;
      row.getCell(8).value = { formula: `IF(J${m}="Evet",E${m}*(1+F${m}),0)` };
      row.getCell(9).value = { formula: `H${m}*(1+G${m})` };
      row.getCell(10).value = line.visibleToCustomer ? "Evet" : "Hayır";
      for (const c of [4, 5, 8, 9]) row.getCell(c).numFmt = fmt(cur);
      row.getCell(6).numFmt = "0%";
      row.getCell(7).numFmt = "0%";
      fill(row.getCell(6), "FFFFF8EB");
      const code = line.catalogItemId
        ? input.catalogCodes.get(line.catalogItemId)
        : undefined;
      const notes: string[] = [];
      if (line.sourceCurrency !== cur) {
        notes.push(`Alış ${line.sourceUnitCost} ${line.sourceCurrency}`);
      }
      if (code) notes.push(code);
      if (!(line.sourceUnitCost > 0)) {
        for (let c = 1; c <= 11; c += 1) {
          fill(row.getCell(c), RED_FILL);
          row.getCell(c).font = { color: { argb: RED_TEXT } };
        }
        notes.unshift("Alış fiyatı 0 — neden 0? Teyit edin.");
        row.getCell(11).font = { bold: true, color: { argb: RED_TEXT } };
      }
      row.getCell(11).value = notes.join(" · ");
      for (let c = 1; c <= 11; c += 1) box(row.getCell(c));
      m += 1;
    }
  }
  const msLast = m - 1;
  m += 1;
  const sumRows: [string, string, string][] = [
    ["TOPLAM MALİYET", `SUM(E${msFirst}:E${msLast})`, `E${m}*(1+${vat})`],
    [
      "TOPLAM SATIŞ",
      `SUM(H${msFirst}:H${msLast})`,
      `SUM(I${msFirst}:I${msLast})`,
    ],
    ["TOPLAM KAR", `E${m + 1}-E${m}`, `F${m + 1}-F${m}`],
  ];
  ms.getCell(m - 1, 5).value = "KDV HARİÇ";
  ms.getCell(m - 1, 6).value = "KDV DAHİL";
  ms.getCell(m - 1, 5).font = { bold: true };
  ms.getCell(m - 1, 6).font = { bold: true };
  sumRows.forEach(([label, ex, inc], index) => {
    const row = ms.getRow(m + index);
    row.getCell(4).value = label;
    row.getCell(4).font = { bold: true };
    row.getCell(5).value = { formula: ex };
    row.getCell(6).value = { formula: inc };
    row.getCell(5).numFmt = fmt(cur);
    row.getCell(6).numFmt = fmt(cur);
    row.getCell(5).font = { bold: true };
    row.getCell(6).font = { bold: true };
  });
  const marginRow = ms.getRow(m + 3);
  marginRow.getCell(4).value = "KÂR MARJI (SATIŞ ÜZERİNDEN)";
  marginRow.getCell(4).font = { bold: true };
  marginRow.getCell(5).value = {
    formula: `IF(E${m + 1}=0,0,E${m + 2}/E${m + 1})`,
  };
  marginRow.getCell(5).numFmt = "0.0%";
  ms.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: msLast, column: 11 },
  };

  addNote(ms, m + 5);
  wb.views = [
    {
      activeTab: 1,
      x: 0,
      y: 0,
      width: 20000,
      height: 12000,
      firstSheet: 0,
      visibility: "visible",
    },
  ];
  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function addNote(ws: Worksheet, row: number) {
  ws.getCell(row, 1).value =
    'Kırmızı satırlar: alış fiyatı 0 olan kalemler — gerekçesi teyit edilmeli. Kâr % sütunu değiştirilirse satış ve kâr yeniden hesaplanır. Net maliyetler modül bazında "Net Maliyetler" sayfasındadır.';
  ws.getCell(row, 1).font = { italic: true, color: { argb: "FF6B7385" } };
}

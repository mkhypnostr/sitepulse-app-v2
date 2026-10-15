// Teklifin iç maliyet dökümü (yalnız yönetici). Formüllüdür: kur, miktar veya
// kâr oranı Excel'de değiştirilirse maliyet ve satış kendiliğinden güncellenir.

import type {
  Currency,
  ExchangeRates,
  OfferModule,
  PricedLine,
} from "@/lib/energy-offer";

const moduleNames: Record<OfferModule, string> = {
  ges: "GES",
  sarj: "Şarj",
  taahhut: "Taahhüt",
  genel: "Genel",
};

const categoryNames: Record<string, string> = {
  malzeme: "Malzeme",
  iscilik: "İşçilik",
  nakliye_sarf: "Nakliye/Sarf",
  diger: "Diğer",
};

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
}): Promise<Blob> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "NES Enerji";
  wb.created = new Date();

  const navy = "FF0E1B33";
  const soft = "FFF4F7FB";
  const money = `#,##0.00 "${input.currency === "TRY" ? "₺" : input.currency}"`;
  const headerStyle = (cell: import("exceljs").Cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: navy } };
    cell.alignment = { vertical: "middle", wrapText: true };
  };

  // Kurlar: teklif para birimine çevirme katsayısı her kaynak para birimi için.
  const rates = wb.addWorksheet("Kurlar");
  rates.columns = [{ width: 26 }, { width: 16 }];
  rates.addRow(["Para birimi", "1 birim = ? TL"]).eachCell(headerStyle);
  rates.addRow(["TRY", 1]);
  rates.addRow(["USD", input.rates.USD || 0]);
  rates.addRow(["EUR", input.rates.EUR || 0]);
  rates.addRow([]);
  rates.addRow(["Teklif para birimi", input.currency]);
  rates.getCell("A8").value =
    "Kurları buradan değiştirirseniz 'İç Maliyet' sayfası yeniden hesaplanır.";
  rates.getCell("A8").font = { italic: true, color: { argb: "FF6B7385" } };
  const rateRow: Record<Currency, number> = { TRY: 2, USD: 3, EUR: 4 };
  const offerRateRef = `Kurlar!$B$${rateRow[input.currency]}`;

  const ws = wb.addWorksheet("İç Maliyet", {
    views: [{ state: "frozen", ySplit: 5 }],
  });
  try {
    const logo = await fetch(input.logoUrl).then((r) => r.arrayBuffer());
    const id = wb.addImage({ buffer: logo, extension: "png" });
    ws.addImage(id, {
      tl: { col: 0, row: 0 },
      ext: { width: 150, height: 46 },
    });
  } catch {
    // Logo yüklenemezse dosya logosuz oluşur.
  }
  ws.getCell("D1").value = `${input.offerNo} · ${input.title}`;
  ws.getCell("D1").font = { bold: true, size: 13, color: { argb: navy } };
  ws.getCell("D2").value = `Teklif verilen: ${input.recipientName || "-"}`;
  ws.getCell("D3").value =
    `İç kullanım içindir — müşteriye gönderilmez. ${new Date().toLocaleDateString("tr-TR")}`;
  ws.getCell("D3").font = { italic: true, color: { argb: "FFB42318" } };

  const headers = [
    "#",
    "Modül",
    "Kategori",
    "Katalog kodu",
    "Açıklama",
    "Marka",
    "Birim",
    "Miktar",
    "Alış (kaynak)",
    "Kaynak para",
    `Birim maliyet (${input.currency})`,
    `Toplam maliyet (${input.currency})`,
    "Kâr oranı",
    `Satış (${input.currency})`,
    "Brüt kâr",
    "Müşteriye görünür",
    "Not",
  ];
  ws.columns = [
    { width: 5 },
    { width: 9 },
    { width: 13 },
    { width: 18 },
    { width: 46 },
    { width: 14 },
    { width: 8 },
    { width: 10 },
    { width: 13 },
    { width: 9 },
    { width: 16 },
    { width: 17 },
    { width: 10 },
    { width: 17 },
    { width: 15 },
    { width: 11 },
    { width: 34 },
  ];
  const head = ws.getRow(5);
  headers.forEach((text, index) => {
    const cell = head.getCell(index + 1);
    cell.value = text;
    headerStyle(cell);
  });
  head.height = 32;

  const first = 6;
  input.lines.forEach((line, index) => {
    const r = first + index;
    const row = ws.getRow(r);
    row.values = [
      index + 1,
      moduleNames[line.module],
      categoryNames[line.category] ?? line.category,
      line.catalogItemId
        ? (input.catalogCodes.get(line.catalogItemId) ?? "")
        : "",
      line.description,
      line.brand ?? "",
      line.unit,
      line.quantity,
      line.sourceUnitCost,
      line.sourceCurrency,
    ];
    row.getCell(11).value = {
      formula: `I${r}*INDEX(Kurlar!$B$2:$B$4,MATCH(J${r},Kurlar!$A$2:$A$4,0))/${offerRateRef}`,
      result: line.unitCost,
    };
    row.getCell(12).value = { formula: `H${r}*K${r}`, result: line.totalCost };
    row.getCell(13).value = line.markupRate;
    row.getCell(14).value = {
      formula: `L${r}*(1+M${r})`,
      result: line.saleAmount,
    };
    row.getCell(15).value = {
      formula: `IF(P${r}="Evet",N${r}-L${r},-L${r})`,
      result: line.visibleToCustomer
        ? line.saleAmount - line.totalCost
        : -line.totalCost,
    };
    row.getCell(16).value = line.visibleToCustomer ? "Evet" : "Hayır";
    row.getCell(9).numFmt = "#,##0.00";
    for (const c of [11, 12, 14, 15]) row.getCell(c).numFmt = money;
    row.getCell(13).numFmt = "0.0%";
    row.getCell(13).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFFFF8EB" },
    };
    if (!(line.sourceUnitCost > 0)) {
      // Alış fiyatı 0 olan kalemler kırmızı: gerekçesi teyit edilmeli.
      for (let c = 1; c <= 17; c += 1) {
        row.getCell(c).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFFDE2E1" },
        };
        row.getCell(c).font = { color: { argb: "FFB42318" } };
      }
      row.getCell(17).value = "Alış fiyatı 0 — neden 0? Teyit edin.";
      row.getCell(17).font = { bold: true, color: { argb: "FFB42318" } };
    } else if (index % 2 === 1) {
      for (const c of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16]) {
        row.getCell(c).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: soft },
        };
      }
    }
  });
  const last = first + input.lines.length - 1;
  const totalRow = ws.getRow(last + 2);
  totalRow.getCell(5).value = "TOPLAM";
  totalRow.getCell(12).value = { formula: `SUM(L${first}:L${last})` };
  totalRow.getCell(14).value = {
    formula: `SUMIF(P${first}:P${last},"Evet",N${first}:N${last})`,
  };
  totalRow.getCell(15).value = { formula: `SUM(O${first}:O${last})` };
  totalRow.font = { bold: true };
  for (const c of [12, 14, 15]) totalRow.getCell(c).numFmt = money;
  ws.autoFilter = {
    from: { row: 5, column: 1 },
    to: { row: last, column: 17 },
  };

  // Özet
  const sum = wb.addWorksheet("Özet");
  sum.columns = [{ width: 34 }, { width: 20 }];
  sum.addRow(["Kalem", "Tutar"]).eachCell(headerStyle);
  const range = (col: string) => `'İç Maliyet'!${col}${first}:${col}${last}`;
  const summaryRows: [string, string, string][] = [
    ["Toplam maliyet", `SUM(${range("L")})`, money],
    ["Satış (KDV hariç)", `SUMIF(${range("P")},"Evet",${range("N")})`, money],
    ["Brüt kâr", "B3-B2", money],
    ["Kâr marjı (satış üzerinden)", "IF(B3=0,0,B4/B3)", "0.0%"],
    ["Ortalama kâr oranı (maliyet üzerinden)", "IF(B2=0,0,B4/B2)", "0.0%"],
    [`KDV (%${Math.round(input.vatRate * 100)})`, `B3*${input.vatRate}`, money],
    ["Genel toplam (KDV dahil)", "B3+B7", money],
  ];
  summaryRows.forEach(([label, formula, fmt]) => {
    const row = sum.addRow([label, { formula }]);
    row.getCell(2).numFmt = fmt;
  });
  sum.getRow(8).font = { bold: true };
  sum.addRow([]);
  sum.addRow(["Modül", "Satış (KDV hariç)"]).eachCell(headerStyle);
  (["ges", "sarj", "taahhut", "genel"] as OfferModule[]).forEach((module) => {
    if (!input.lines.some((line) => line.module === module)) return;
    const row = sum.addRow([
      moduleNames[module],
      {
        formula: `SUMIFS(${range("N")},${range("B")},"${moduleNames[module]}",${range("P")},"Evet")`,
      },
    ]);
    row.getCell(2).numFmt = money;
  });
  sum.addRow([]);
  sum.addRow(["Kategori", "Maliyet"]).eachCell(headerStyle);
  Object.values(categoryNames).forEach((name) => {
    const row = sum.addRow([
      name,
      { formula: `SUMIF(${range("C")},"${name}",${range("L")})` },
    ]);
    row.getCell(2).numFmt = money;
  });

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

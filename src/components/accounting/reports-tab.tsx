// Raporlar: aylık KDV tahmini, gelir-gider ve nakit; mali müşavir paketi.
import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { downloadCsv } from "@/lib/domain";
import {
  documentTypeLabels,
  expenseCategoryLabels,
  monthLabel,
  monthlySummary,
  tl,
} from "@/lib/accounting";
import type { AccountingData } from "@/lib/accounting-data";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const dateTr = (v: string | null) =>
  v ? v.slice(0, 10).split("-").reverse().join(".") : "";
const num = (v: number) => v.toFixed(2).replace(".", ",");

export function ReportsTab({ data }: { data: AccountingData }) {
  const summary = useMemo(
    () =>
      monthlySummary(
        data.invoices,
        data.bills,
        data.txns,
        data.collections,
        data.accounts,
      ),
    [data],
  );
  const [month, setMonth] = useState(summary[0]?.month ?? "");
  const supplierName = new Map(data.suppliers.map((s) => [s.id, s]));

  function exportMonth() {
    if (!month) return;
    const inv = data.invoices.filter((i) => i.issue_date.startsWith(month));
    const bills = data.bills.filter((b) => b.issue_date.startsWith(month));
    const rows: unknown[][] = [
      ["SATIŞ FATURALARI"],
      [
        "Tarih",
        "Fatura no",
        "Alıcı",
        "VKN/TCKN",
        "Para birimi",
        "Kur",
        "Matrah",
        "KDV",
        "Tevkifat",
        "Ödenecek",
      ],
      ...inv.map((i) => [
        dateTr(i.issue_date),
        i.gib_invoice_no ?? "",
        i.buyer_title,
        i.buyer_tax_no ?? "",
        i.currency,
        num(Number(i.exchange_rate)),
        num(Number(i.subtotal)),
        num(Number(i.vat_total)),
        num(Number(i.withholding_total)),
        num(Number(i.payable_total)),
      ]),
      [],
      ["ALIŞ / GİDER BELGELERİ"],
      [
        "Tarih",
        "Belge türü",
        "Belge no",
        "Tedarikçi",
        "VKN/TCKN",
        "Kategori",
        "Para birimi",
        "Kur",
        "Matrah",
        "KDV",
        "Tevkifat",
        "Toplam",
        "Açıklama",
      ],
      ...bills.map((b) => {
        const s = b.supplier_id ? supplierName.get(b.supplier_id) : undefined;
        return [
          dateTr(b.issue_date),
          documentTypeLabels[b.document_type],
          b.document_no ?? "",
          s?.name ?? "",
          s?.tax_no ?? "",
          expenseCategoryLabels[b.category],
          b.currency,
          num(Number(b.exchange_rate)),
          num(Number(b.net_amount)),
          num(Number(b.vat_amount)),
          num(Number(b.withholding_amount)),
          num(Number(b.total_amount)),
          b.description ?? "",
        ];
      }),
    ];
    const s = summary.find((x) => x.month === month);
    if (s) {
      rows.push(
        [],
        ["ÖZET (TL, tahmini)"],
        ["Hesaplanan KDV", num(s.salesVat)],
        ["İndirilecek KDV", num(s.purchaseVat)],
        ["Fark (ödenecek / devreden)", num(s.vatPayable)],
      );
    }
    downloadCsv(`mali-musavir-${month}.csv`, rows);
  }

  return (
    <div className="space-y-4">
      <div className="surface-panel flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
        <div className="flex-1">
          <div className="font-bold">Mali müşavir paketi</div>
          <p className="text-xs text-muted-foreground">
            Seçilen ayın kesilen faturaları ve gider belgeleri tek dosyada
            (Excel ile açılır). Her ayın ilk günlerinde gönderin; belge eklerini
            Giderler sekmesinden açabilirsiniz.
          </p>
        </div>
        <Select value={month} onValueChange={setMonth}>
          <SelectTrigger className="h-11 sm:w-48">
            <SelectValue placeholder="Ay seçin" />
          </SelectTrigger>
          <SelectContent>
            {summary.map((s) => (
              <SelectItem key={s.month} value={s.month}>
                {monthLabel(s.month)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          className="h-11 font-bold"
          disabled={!month}
          onClick={exportMonth}
        >
          <Download className="mr-2 h-4 w-4" /> İndir
        </Button>
      </div>

      {summary.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Rapor için kesilmiş fatura veya gider kaydı yok.
        </p>
      ) : (
        <div className="surface-panel overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="p-3">Ay</th>
                <th className="p-3 text-right">Satış (KDV hariç)</th>
                <th className="p-3 text-right">Gider (KDV hariç)</th>
                <th className="p-3 text-right">Brüt sonuç</th>
                <th className="p-3 text-right">Hesaplanan KDV</th>
                <th className="p-3 text-right">İndirilecek KDV</th>
                <th className="p-3 text-right">KDV farkı</th>
                <th className="p-3 text-right">Nakit giriş / çıkış</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((s) => (
                <tr
                  key={s.month}
                  className="border-b border-border last:border-0"
                >
                  <td className="p-3 font-semibold">{monthLabel(s.month)}</td>
                  <td className="p-3 text-right tabular-nums">
                    {tl(s.salesNet)}
                  </td>
                  <td className="p-3 text-right tabular-nums">
                    {tl(s.purchaseNet)}
                  </td>
                  <td
                    className={`p-3 text-right font-semibold tabular-nums ${s.result >= 0 ? "text-emerald-600" : "text-destructive"}`}
                  >
                    {tl(s.result)}
                  </td>
                  <td className="p-3 text-right tabular-nums">
                    {tl(s.salesVat)}
                  </td>
                  <td className="p-3 text-right tabular-nums">
                    {tl(s.purchaseVat)}
                  </td>
                  <td
                    className={`p-3 text-right font-semibold tabular-nums ${s.vatPayable > 0 ? "text-amber-600" : "text-sky-600"}`}
                  >
                    {s.vatPayable > 0
                      ? tl(s.vatPayable)
                      : `${tl(-s.vatPayable)} devreder`}
                  </td>
                  <td className="p-3 text-right text-xs tabular-nums">
                    <span className="text-emerald-600">+{tl(s.cashIn)}</span>
                    <br />
                    <span className="text-destructive">-{tl(s.cashOut)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        KDV farkı tahminidir: önceki aydan devreden KDV, sorumlu sıfatıyla beyan
        (2 no&apos;lu) ve istisnalar dahil değildir. Beyannameyi mali müşavir
        hazırlar. Satış yalnızca Faturalar&apos;da &quot;kesildi&quot; olan
        faturalardan, gider Giderler sekmesinden hesaplanır.
      </p>
    </div>
  );
}

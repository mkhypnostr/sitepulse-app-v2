import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { downloadCsv, errorMessage } from "@/lib/domain";
import { formatDate, formatTRY } from "@/lib/format";
import { AccessDenied, EmptyState, LoadingState, PageHeader } from "@/components/page-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/reports")({
  component: ReportsPage,
});

const monthOptions = [
  { value: "all", label: "Tüm Aylar" },
  { value: "01", label: "Ocak" },
  { value: "02", label: "Şubat" },
  { value: "03", label: "Mart" },
  { value: "04", label: "Nisan" },
  { value: "05", label: "Mayıs" },
  { value: "06", label: "Haziran" },
  { value: "07", label: "Temmuz" },
  { value: "08", label: "Ağustos" },
  { value: "09", label: "Eylül" },
  { value: "10", label: "Ekim" },
  { value: "11", label: "Kasım" },
  { value: "12", label: "Aralık" },
];

function periodBoundaries(year: string, month: string) {
  const yearNumber = Number(year);
  const monthNumber = month === "all" ? 0 : Number(month) - 1;
  return {
    start: new Date(Date.UTC(yearNumber, monthNumber, 1)).toISOString(),
    end:
      month === "all"
        ? new Date(Date.UTC(yearNumber + 1, 0, 1)).toISOString()
        : new Date(Date.UTC(yearNumber, monthNumber + 1, 1)).toISOString(),
  };
}

function ReportsPage() {
  const { role } = useAuth();
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1).padStart(2, "0"));
  const yearOptions = Array.from({ length: 8 }, (_, index) => now.getFullYear() + 1 - index);
  const periodLabel =
    month === "all"
      ? `${year} Yılı`
      : `${monthOptions.find((item) => item.value === month)?.label ?? month} ${year}`;
  const reportQuery = useQuery({
    queryKey: ["period-report", year, month],
    enabled: role === "admin" && Boolean(year) && Boolean(month),
    queryFn: async () => {
      const { start, end } = periodBoundaries(year, month);
      const [materialsResult, approvalsResult] = await Promise.all([
        supabase
          .from("work_order_materials")
          .select("*, stock_items(code, name), work_orders(work_order_no, title, customers(name))")
          .gte("created_at", start)
          .lt("created_at", end)
          .order("created_at"),
        supabase
          .from("progress_approvals")
          .select("*, work_orders(work_order_no, title, customers(name))")
          .gte("approved_at", start)
          .lt("approved_at", end)
          .order("approved_at"),
      ]);
      if (materialsResult.error) throw materialsResult.error;
      if (approvalsResult.error) throw approvalsResult.error;
      return { materials: materialsResult.data, approvals: approvalsResult.data };
    },
  });

  if (role !== "admin") return <AccessDenied />;
  if (reportQuery.isLoading) return <LoadingState />;
  if (reportQuery.error)
    return <p className="text-destructive">{errorMessage(reportQuery.error)}</p>;

  const materials = reportQuery.data?.materials ?? [];
  const approvals = reportQuery.data?.approvals ?? [];
  const nesUsage = materials.filter((item) => item.is_nes_stock).length;
  const contractorUsage = materials.length - nesUsage;
  const approvedTotal = approvals.reduce((sum, item) => sum + item.approved_amount, 0);

  function exportReport() {
    downloadCsv(`nes-kullanim-hakedis-raporu-${year}-${month}.csv`, [
      ["NES ENERJİ MALZEME VE HAKEDİŞ RAPORU", periodLabel],
      [],
      ["MALZEME KULLANIMLARI"],
      ["Tarih", "Görev No", "Görev", "Müşteri", "Kaynak", "Kod", "Malzeme", "Miktar", "Birim"],
      ...materials.map((item) => [
        formatDate(item.created_at),
        item.work_orders?.work_order_no,
        item.work_orders?.title,
        item.work_orders?.customers?.name,
        item.is_nes_stock ? "NES Stoğu" : "Taşeron",
        item.stock_items?.code,
        item.is_nes_stock ? item.stock_items?.name : item.custom_material_name,
        item.quantity,
        item.unit,
      ]),
      [],
      ["HAKEDİŞ ONAYLARI"],
      ["Tarih", "Görev No", "Görev", "Müşteri", "Onaylanan %", "Onaylanan Tutar"],
      ...approvals.map((item) => [
        formatDate(item.approved_at),
        item.work_orders?.work_order_no,
        item.work_orders?.title,
        item.work_orders?.customers?.name,
        item.approved_pct,
        item.approved_amount,
      ]),
    ]);
  }

  return (
    <>
      <PageHeader
        title="Kullanım ve Hakediş Raporu"
        description="NES stoğu, taşeron malzemeleri ve onaylanan hakedişler tek çıktıda."
        actions={
          <div className="flex flex-wrap gap-2">
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger className="h-12 w-28" aria-label="Rapor yılı">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger className="h-12 w-36" aria-label="Rapor ayı">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {monthOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button className="h-12" onClick={exportReport}>
              <Download className="mr-2 h-4 w-4" /> CSV / Excel Çıktısı
            </Button>
          </div>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">NES Stok Kalemi Kullanımı</p>
            <p className="text-3xl font-black">{nesUsage}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Taşeron Malzeme Kaydı</p>
            <p className="text-3xl font-black">{contractorUsage}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Onaylanan Hakediş Toplamı</p>
            <p className="text-2xl font-black text-primary">{formatTRY(approvedTotal)}</p>
          </CardContent>
        </Card>
      </div>

      <h2 className="mb-3 text-xl font-black">Malzeme Kullanımları</h2>
      {materials.length === 0 ? (
        <EmptyState title={`${periodLabel} döneminde malzeme kullanımı yok`} />
      ) : (
        <div className="surface-panel overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tarih</TableHead>
                <TableHead>Görev</TableHead>
                <TableHead>Kaynak</TableHead>
                <TableHead>Malzeme</TableHead>
                <TableHead className="text-right">Miktar</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {materials.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{formatDate(item.created_at)}</TableCell>
                  <TableCell>
                    #{item.work_orders?.work_order_no} · {item.work_orders?.title}
                  </TableCell>
                  <TableCell>
                    <Badge variant={item.is_nes_stock ? "default" : "outline"}>
                      {item.is_nes_stock ? "NES" : "Taşeron"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {item.is_nes_stock ? item.stock_items?.name : item.custom_material_name}
                  </TableCell>
                  <TableCell className="text-right font-bold">
                    {item.quantity} {item.unit}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <h2 className="mb-3 mt-7 text-xl font-black">Hakediş Onayları</h2>
      {approvals.length === 0 ? (
        <EmptyState title={`${periodLabel} döneminde hakediş onayı yok`} />
      ) : (
        <div className="surface-panel overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tarih</TableHead>
                <TableHead>Görev</TableHead>
                <TableHead>Onay</TableHead>
                <TableHead className="text-right">Tutar</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {approvals.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{formatDate(item.approved_at)}</TableCell>
                  <TableCell>
                    #{item.work_orders?.work_order_no} · {item.work_orders?.title}
                  </TableCell>
                  <TableCell>%{item.approved_pct}</TableCell>
                  <TableCell className="text-right font-black">
                    {formatTRY(item.approved_amount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}

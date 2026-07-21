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
import { Input } from "@/components/ui/input";
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

function monthBoundaries(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return {
    start: new Date(Date.UTC(year, monthNumber - 1, 1)).toISOString(),
    end: new Date(Date.UTC(year, monthNumber, 1)).toISOString(),
  };
}

function ReportsPage() {
  const { role } = useAuth();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const reportQuery = useQuery({
    queryKey: ["monthly-report", month],
    enabled: role === "admin" && Boolean(month),
    queryFn: async () => {
      const { start, end } = monthBoundaries(month);
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
    downloadCsv(`nes-aylik-rapor-${month}.csv`, [
      ["NES ENERJİ AYLIK MALZEME VE HAKEDİŞ RAPORU", month],
      [],
      ["MALZEME KULLANIMLARI"],
      ["Tarih", "İş Emri No", "İş", "Müşteri", "Kaynak", "Kod", "Malzeme", "Miktar", "Birim"],
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
      ["Tarih", "İş Emri No", "İş", "Müşteri", "Onaylanan %", "Onaylanan Tutar"],
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
        title="Aylık Kullanım ve Hakediş Raporu"
        description="NES stoğu, taşeron malzemeleri ve onaylanan hakedişler tek çıktıda."
        actions={
          <div className="flex gap-2">
            <Input
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              className="h-12 w-44"
            />
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
        <EmptyState title="Bu ay malzeme kullanımı yok" />
      ) : (
        <div className="surface-panel overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tarih</TableHead>
                <TableHead>İş Emri</TableHead>
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
        <EmptyState title="Bu ay hakediş onayı yok" />
      ) : (
        <div className="surface-panel overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tarih</TableHead>
                <TableHead>İş Emri</TableHead>
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

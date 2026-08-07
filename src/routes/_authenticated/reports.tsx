import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download, FileText } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { errorMessage } from "@/lib/domain";
import { formatDate, formatTRY } from "@/lib/format";
import { formatProjectDate, projectApprovedProgress, projectStatusLabel } from "@/lib/projects";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

const NES_LOGO_URL = "/nes-enerji-logo.png";

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
  // Yerel (TR) saatle sınırlanır; UTC kullanılsaydı ay sınırındaki son/ilk
  // birkaç saatlik kayıtlar yanlış aya sızabilirdi.
  const yearNumber = Number(year);
  const monthNumber = month === "all" ? 0 : Number(month) - 1;
  return {
    start: new Date(yearNumber, monthNumber, 1).toISOString(),
    end:
      month === "all"
        ? new Date(yearNumber + 1, 0, 1).toISOString()
        : new Date(yearNumber, monthNumber + 1, 1).toISOString(),
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
  const [exporting, setExporting] = useState(false);
  const reportQuery = useQuery({
    queryKey: ["period-report", year, month],
    enabled: role === "admin" && Boolean(year) && Boolean(month),
    queryFn: async () => {
      const { start, end } = periodBoundaries(year, month);
      const [materialsResult, completionsResult] = await Promise.all([
        supabase
          .from("work_order_materials")
          .select(
            "*, stock_items(code, name, unit_price), work_orders(work_order_no, title, customers(name))",
          )
          .gte("created_at", start)
          .lt("created_at", end)
          .order("created_at"),
        // Hakediş; iş bitirme onaylandığında (work_completion_submissions)
        // taşerona ödenecek nihai tutar work_order_financials.contractor_labor_amount
        // üzerinden okunur — progress_approvals sadece kısmi % onaylarını tutar.
        supabase
          .from("work_completion_submissions")
          .select(
            "id, submitted_by, submitted_at, reviewed_at, work_orders(work_order_no, title, customers(name), work_order_financials(contractor_labor_amount))",
          )
          .eq("status", "approved")
          .gte("reviewed_at", start)
          .lt("reviewed_at", end)
          .order("reviewed_at"),
      ]);
      if (materialsResult.error) throw materialsResult.error;
      if (completionsResult.error) throw completionsResult.error;

      const completions = completionsResult.data ?? [];
      const contractorIds = [...new Set(completions.map((item) => item.submitted_by))];
      const profilesResult = contractorIds.length
        ? await supabase.from("profiles").select("id, full_name").in("id", contractorIds)
        : { data: [], error: null };
      if (profilesResult.error) throw profilesResult.error;
      const contractorNameById = new Map(profilesResult.data.map((item) => [item.id, item.full_name]));

      return {
        materials: materialsResult.data,
        approvals: completions.map((item) => ({
          id: item.id,
          approved_at: item.reviewed_at ?? item.submitted_at,
          work_orders: item.work_orders,
          contractor_name: contractorNameById.get(item.submitted_by) || "Taşeron",
          approved_amount: item.work_orders?.work_order_financials?.contractor_labor_amount ?? 0,
        })),
      };
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
  const totalMaterialQuantity = materials.reduce((sum, item) => sum + item.quantity, 0);
  const materialUnitPrice = (item: (typeof materials)[number]) =>
    item.is_nes_stock ? (item.stock_items?.unit_price ?? 0) : 0;
  const totalMaterialAmount = materials.reduce(
    (sum, item) => sum + item.quantity * materialUnitPrice(item),
    0,
  );
  const approvedTotal = approvals.reduce((sum, item) => sum + item.approved_amount, 0);

  async function exportReport() {
    // exceljs (ve zip/stream bağımlılıkları) tarayıcı dışı kod yoluna hiç
    // girmemeli; SSR derlemesinde bu dal build-time'da elenir, sunucu
    // paketine gereksiz ~2 MB eklenmesin diye.
    if (import.meta.env.SSR) return;
    setExporting(true);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "NES Enerji";

      const logoResponse = await fetch(NES_LOGO_URL);
      const logoBuffer = await logoResponse.arrayBuffer();
      const logoImageId = workbook.addImage({ buffer: logoBuffer, extension: "png" });

      const boldFont = { bold: true };
      const titleFont = { bold: true, size: 13 };
      const headerFill = {
        type: "pattern" as const,
        pattern: "solid" as const,
        fgColor: { argb: "FF1D4ED8" },
      };
      const headerFont = { bold: true, color: { argb: "FFFFFFFF" } };
      const totalFill = {
        type: "pattern" as const,
        pattern: "solid" as const,
        fgColor: { argb: "FFEFF6FF" },
      };

      function addSheet(
        name: string,
        headers: string[],
        rows: (string | number)[][],
        totalRow: (string | number)[],
      ) {
        const sheet = workbook.addWorksheet(name);
        sheet.addImage(logoImageId, { tl: { col: 0, row: 0 }, ext: { width: 160, height: 49 } });
        sheet.getRow(1).height = 26;
        sheet.getRow(2).height = 26;
        sheet.mergeCells(1, headers.length + 1, 2, headers.length + 3);
        sheet.getCell(1, headers.length + 1).value = "NES Enerji";
        sheet.getCell(1, headers.length + 1).font = titleFont;
        sheet.getCell(3, 1).value = `${name} · ${periodLabel}`;
        sheet.getCell(3, 1).font = boldFont;
        const headerRow = sheet.getRow(4);
        headers.forEach((header, index) => {
          const cell = headerRow.getCell(index + 1);
          cell.value = header;
          cell.font = headerFont;
          cell.fill = headerFill;
        });
        rows.forEach((row) => sheet.addRow(row));
        const totalExcelRow = sheet.addRow(totalRow);
        totalExcelRow.eachCell((cell) => {
          cell.font = boldFont;
          cell.fill = totalFill;
        });
        sheet.columns.forEach((column) => {
          column.width = 22;
        });
      }

      addSheet(
        "Malzeme Kullanımları",
        [
          "Tarih",
          "Görev No",
          "Görev",
          "Müşteri",
          "Kaynak",
          "Kod",
          "Malzeme",
          "Miktar",
          "Birim",
          "Birim Fiyat",
          "Toplam",
        ],
        materials.map((item) => [
          formatDate(item.created_at),
          item.work_orders?.work_order_no ?? "",
          item.work_orders?.title ?? "",
          item.work_orders?.customers?.name ?? "",
          item.is_nes_stock ? "NES Stoğu" : "Taşeron",
          item.stock_items?.code ?? "",
          (item.is_nes_stock ? item.stock_items?.name : item.custom_material_name) ?? "",
          item.quantity,
          item.unit,
          materialUnitPrice(item),
          item.quantity * materialUnitPrice(item),
        ]),
        ["", "", "", "", "", "", "TOPLAM", totalMaterialQuantity, "", "", totalMaterialAmount],
      );

      addSheet(
        "Hakediş Onayları",
        ["Tarih", "Görev No", "Görev", "Müşteri", "Taşeron", "Onaylanan Tutar"],
        approvals.map((item) => [
          formatDate(item.approved_at),
          item.work_orders?.work_order_no ?? "",
          item.work_orders?.title ?? "",
          item.work_orders?.customers?.name ?? "",
          item.contractor_name,
          item.approved_amount,
        ]),
        ["", "", "", "", "TOPLAM", approvedTotal],
      );

      const buffer = await workbook.xlsx.writeBuffer();
      const url = URL.createObjectURL(
        new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `nes-kullanim-hakedis-raporu-${year}-${month}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Raporlar"
        description="İş emri bazlı dönemsel rapor ve proje bazlı rapor tek ekranda."
      />

      <Tabs defaultValue="work-orders" className="mt-2">
        <TabsList>
          <TabsTrigger value="work-orders">İş Emri Raporu</TabsTrigger>
          <TabsTrigger value="project">Proje Raporu</TabsTrigger>
        </TabsList>

        <TabsContent value="work-orders" className="mt-6">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-black">Kullanım ve Hakediş Raporu</h2>
              <p className="text-sm text-muted-foreground">
                NES stoğu, taşeron malzemeleri ve onaylanan hakedişler tek çıktıda.
              </p>
            </div>
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
              <Button className="h-12" onClick={exportReport} disabled={exporting}>
                <Download className="mr-2 h-4 w-4" /> {exporting ? "Hazırlanıyor..." : "Excel Çıktısı"}
              </Button>
            </div>
          </div>

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
            <p className="text-2xl font-black text-highlight">{formatTRY(approvedTotal)}</p>
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
                <TableHead>Müşteri</TableHead>
                <TableHead>Taşeron</TableHead>
                <TableHead className="text-right">Onaylanan Tutar</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {approvals.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{formatDate(item.approved_at)}</TableCell>
                  <TableCell>
                    #{item.work_orders?.work_order_no} · {item.work_orders?.title}
                  </TableCell>
                  <TableCell>{item.work_orders?.customers?.name || "—"}</TableCell>
                  <TableCell>{item.contractor_name}</TableCell>
                  <TableCell className="text-right font-black">
                    {formatTRY(item.approved_amount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
        </TabsContent>

        <TabsContent value="project" className="mt-6">
          <ProjectReportTab />
        </TabsContent>
      </Tabs>
    </>
  );
}

type ReportProjectSummary = {
  workOrderCount: number;
  completedWorkOrderCount: number;
  taskCount: number;
  completedTaskCount: number;
  taskProgressPct: number;
};

function ProjectReportTab() {
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");

  const projectsQuery = useQuery({
    queryKey: ["report-projects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, project_no, name, status, start_date, target_end_date, customers(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const summaryQuery = useQuery({
    queryKey: ["report-project-summary", selectedProjectId],
    enabled: Boolean(selectedProjectId),
    queryFn: async (): Promise<ReportProjectSummary> => {
      const [workOrdersResult, tasksResult] = await Promise.all([
        supabase
          .from("work_orders")
          .select("status", { count: "exact" })
          .eq("project_id", selectedProjectId),
        supabase
          .from("project_tasks")
          .select("status, responsible_id, approved_progress_pct")
          .eq("project_id", selectedProjectId),
      ]);
      if (workOrdersResult.error) throw workOrdersResult.error;
      if (tasksResult.error) throw tasksResult.error;
      const workOrders = workOrdersResult.data ?? [];
      const tasks = tasksResult.data ?? [];
      const progress = projectApprovedProgress(
        tasks.map((task) => ({
          approved_progress_pct: task.approved_progress_pct,
          status: task.status,
        })),
      );
      return {
        workOrderCount: workOrders.length,
        completedWorkOrderCount: workOrders.filter((order) => order.status === "completed").length,
        taskCount: progress.total,
        completedTaskCount: progress.completed,
        taskProgressPct: progress.percentage,
      };
    },
  });

  if (projectsQuery.isLoading) return <LoadingState />;
  const projects = projectsQuery.data ?? [];
  const selectedProject = projects.find((project) => project.id === selectedProjectId);

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-black">Proje Bazlı Rapor</h2>
        <p className="text-sm text-muted-foreground">
          Bir proje seçin; proje bilgileri, bağlı iş emirleri, görev ilerlemesi, malzeme ve mali
          özet içeren tam rapor PDF veya Word olarak indirilebilir.
        </p>
      </div>

      {projects.length === 0 ? (
        <EmptyState title="Henüz proje yok" description="Rapor için önce bir proje oluşturun." />
      ) : (
        <>
          <label className="grid max-w-md gap-1 text-sm">
            Proje
            <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
              <SelectTrigger className="h-11">
                <SelectValue placeholder="Proje seçin" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.project_no} · {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          {selectedProject ? (
            <Card className="mt-5">
              <CardContent className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      {selectedProject.project_no}
                    </p>
                    <h3 className="text-xl font-black">{selectedProject.name}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {selectedProject.customers?.name || "Müşteri yok"} ·{" "}
                      {projectStatusLabel[selectedProject.status]} ·{" "}
                      {formatProjectDate(selectedProject.start_date)} →{" "}
                      {formatProjectDate(selectedProject.target_end_date)}
                    </p>
                  </div>
                  <Button asChild className="h-12">
                    <Link to="/project-report/$projectId" params={{ projectId: selectedProject.id }}>
                      <FileText className="mr-2 h-4 w-4" /> Tam Raporu Aç (PDF / Word)
                    </Link>
                  </Button>
                </div>

                {summaryQuery.data ? (
                  <div className="mt-5 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-[14px] border border-border/60 bg-background/30 p-3">
                      <p className="text-xs text-muted-foreground">Bağlı İş Emri</p>
                      <p className="mt-1 text-2xl font-black">
                        {summaryQuery.data.completedWorkOrderCount}/{summaryQuery.data.workOrderCount}
                      </p>
                      <p className="text-xs text-muted-foreground">tamamlandı</p>
                    </div>
                    <div className="rounded-[14px] border border-border/60 bg-background/30 p-3">
                      <p className="text-xs text-muted-foreground">Proje Görevi</p>
                      <p className="mt-1 text-2xl font-black">
                        {summaryQuery.data.completedTaskCount}/{summaryQuery.data.taskCount}
                      </p>
                      <p className="text-xs text-muted-foreground">tamamlandı</p>
                    </div>
                    <div className="rounded-[14px] border border-border/60 bg-background/30 p-3">
                      <p className="text-xs text-muted-foreground">Onaylı İlerleme</p>
                      <p className="mt-1 text-2xl font-black text-highlight">
                        %{summaryQuery.data.taskProgressPct}
                      </p>
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}

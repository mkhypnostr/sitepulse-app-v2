import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { downloadCsv, errorMessage } from "@/lib/domain";
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
              <Button className="h-12" onClick={exportReport}>
                <Download className="mr-2 h-4 w-4" /> CSV / Excel Çıktısı
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

import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, FileDown, FileText, Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { downloadWordDocument, errorMessage } from "@/lib/domain";
import { formatTRY } from "@/lib/format";
import {
  formatProjectDate,
  projectApprovedProgress,
  projectStatusLabel,
  projectTaskStatusLabel,
  projectTypeLabel,
  taskStatusClass,
  type ProjectTaskStatus,
} from "@/lib/projects";
import { AccessDenied, EmptyState, LoadingState } from "@/components/page-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/project-report/$projectId")({
  component: ProjectReportPage,
});

// NES_ANTENT.docx şirket antet şablonundan alınmıştır (logo + iletişim).
const NES_LOGO_URL = "/nes-enerji-logo.png";
const NES_CONTACT_ADDRESS =
  "Orhaniye Mahallesi 12 Nolu Sokak Nur Apartmanı No:6/C Menteşe / Muğla";
const NES_CONTACT_PHONE = "+90 554 610 24 16";
const NES_CONTACT_EMAIL = "info@nesgrup.com";

const workOrderStatusLabel: Record<string, string> = {
  planned: "Planlandı",
  in_progress: "Devam Ediyor",
  review_pending: "Yönetici Kontrolünde",
  completed: "Tamamlandı",
  cancelled: "İptal",
};

type ReportTask = {
  id: string;
  phase_name: string;
  phase_order: number;
  task_name: string;
  task_order: number;
  status: ProjectTaskStatus;
  responsible_id: string | null;
  planned_date: string | null;
  actual_date: string | null;
  note: string | null;
  approved_progress_pct: number;
};

function groupByPhase(tasks: ReportTask[]) {
  const phases = new Map<number, { name: string; order: number; tasks: ReportTask[] }>();
  tasks.forEach((task) => {
    const phase = phases.get(task.phase_order) ?? {
      name: task.phase_name,
      order: task.phase_order,
      tasks: [],
    };
    phase.tasks.push(task);
    phases.set(task.phase_order, phase);
  });
  return [...phases.values()]
    .sort((a, b) => a.order - b.order)
    .map((phase) => ({ ...phase, tasks: phase.tasks.sort((a, b) => a.task_order - b.task_order) }));
}

function ProjectReportPage() {
  const { role } = useAuth();
  const { projectId } = Route.useParams();
  const canView = role === "admin" || role === "technical_office";

  const reportQuery = useQuery({
    queryKey: ["project-report", projectId],
    enabled: canView,
    queryFn: async () => {
      const projectResult = await supabase
        .from("projects")
        .select("*, customers(name, contact)")
        .eq("id", projectId)
        .maybeSingle();
      if (projectResult.error) throw projectResult.error;
      if (!projectResult.data) throw new Error("Proje bulunamadı");

      const [processesResult, tasksResult, workOrdersResult, assigneesResult] = await Promise.all([
        supabase.from("project_processes").select("*").eq("project_id", projectId).order("position"),
        supabase
          .from("project_tasks")
          .select(
            "id, phase_name, phase_order, task_name, task_order, status, responsible_id, planned_date, actual_date, note, approved_progress_pct",
          )
          .eq("project_id", projectId)
          .order("phase_order")
          .order("task_order"),
        supabase
          .from("work_orders")
          .select("id, work_order_no, title, status, progress_pct")
          .eq("project_id", projectId)
          .order("scheduled_at", { ascending: false }),
        supabase.rpc("list_task_assignees"),
      ]);
      if (processesResult.error) throw processesResult.error;
      if (tasksResult.error) throw tasksResult.error;
      if (workOrdersResult.error) throw workOrdersResult.error;
      if (assigneesResult.error) throw assigneesResult.error;

      const taskIds = tasksResult.data.map((task) => task.id);
      const evidenceResult = taskIds.length
        ? await supabase
            .from("project_task_evidence")
            .select("id, project_task_id, storage_path, file_name, evidence_type, description")
            .in("project_task_id", taskIds)
            .order("created_at")
        : { data: [], error: null };
      if (evidenceResult.error) throw evidenceResult.error;

      const workOrderIds = workOrdersResult.data.map((order) => order.id);
      const materialsResult = workOrderIds.length
        ? await supabase
            .from("work_order_materials")
            .select(
              "id, work_order_id, custom_material_name, quantity, unit, is_nes_stock, material_source, stock_items(name, code)",
            )
            .in("work_order_id", workOrderIds)
            .order("created_at")
        : { data: [], error: null };
      if (materialsResult.error) throw materialsResult.error;

      // Hakediş/mali özet yalnızca yöneticiye açık; work_order_financials RLS
      // teknik ofis ve diğer roller için satır döndürmez.
      const financialsResult =
        role === "admin" && workOrderIds.length
          ? await supabase
              .from("work_order_financials")
              .select(
                "work_order_id, customer_labor_amount, customer_material_amount, contractor_labor_amount, estimated_material_cost",
              )
              .in("work_order_id", workOrderIds)
          : { data: [], error: null };
      if (financialsResult.error) throw financialsResult.error;

      const evidenceWithUrls = await Promise.all(
        (evidenceResult.data ?? []).map(async (item) => {
          if (item.evidence_type !== "photo") return { ...item, signedUrl: null };
          const signed = await supabase.storage
            .from("project-evidence")
            .createSignedUrl(item.storage_path, 3600);
          return { ...item, signedUrl: signed.error ? null : signed.data.signedUrl };
        }),
      );

      return {
        project: projectResult.data,
        processes: processesResult.data,
        tasks: tasksResult.data as ReportTask[],
        workOrders: workOrdersResult.data,
        assignees: assigneesResult.data ?? [],
        materials: materialsResult.data ?? [],
        financials: financialsResult.data ?? [],
        evidenceByTaskId: evidenceWithUrls.reduce((map, item) => {
          const list = map.get(item.project_task_id) ?? [];
          list.push(item);
          map.set(item.project_task_id, list);
          return map;
        }, new Map<string, typeof evidenceWithUrls>()),
      };
    },
  });

  if (!canView) return <AccessDenied />;
  if (reportQuery.isLoading) return <LoadingState />;
  if (reportQuery.error || !reportQuery.data) {
    return (
      <EmptyState
        title="Rapor açılamadı"
        description={reportQuery.error ? errorMessage(reportQuery.error) : "Proje bulunamadı."}
      />
    );
  }

  const { project, processes, tasks, workOrders, assignees, materials, financials, evidenceByTaskId } =
    reportQuery.data;
  const assigneeById = new Map(assignees.map((assignee) => [assignee.id, assignee.full_name]));
  const location = [project.province, project.district, project.neighborhood]
    .filter(Boolean)
    .join(" / ");
  const phases = groupByPhase(tasks);
  const overallProgress = projectApprovedProgress(tasks);
  const totalSales = financials.reduce(
    (sum, item) => sum + item.customer_labor_amount + item.customer_material_amount,
    0,
  );
  const totalCost = financials.reduce(
    (sum, item) => sum + item.contractor_labor_amount + item.estimated_material_cost,
    0,
  );
  const totalMargin = totalSales - totalCost;
  const materialLabel = (item: (typeof materials)[number]) =>
    item.is_nes_stock ? item.stock_items?.name || "NES stok malzemesi" : item.custom_material_name || "Malzeme";
  const materialSourceLabel: Record<string, string> = {
    nes_stock: "NES deposu",
    contractor: "Taşeron malzemesi",
    customer_site: "Müşteri / şantiye malzemesi",
  };

  function exportWord() {
    const rows = (label: string, value: string) =>
      `<tr><td style="padding:4px 10px;border:1px solid #cbd5e1;font-weight:bold;background:#eff6ff;">${label}</td><td style="padding:4px 10px;border:1px solid #cbd5e1;">${value}</td></tr>`;
    const taskRows = phases
      .flatMap((phase) =>
        phase.tasks.map(
          (task) =>
            `<tr><td style="padding:4px 10px;border:1px solid #cbd5e1;">${phase.name}</td><td style="padding:4px 10px;border:1px solid #cbd5e1;">${task.task_name}</td><td style="padding:4px 10px;border:1px solid #cbd5e1;">${projectTaskStatusLabel[task.status]}</td><td style="padding:4px 10px;border:1px solid #cbd5e1;">%${task.approved_progress_pct}</td></tr>`,
        ),
      )
      .join("");
    const workOrderRows = workOrders
      .map(
        (order) =>
          `<tr><td style="padding:4px 10px;border:1px solid #cbd5e1;">#${order.work_order_no}</td><td style="padding:4px 10px;border:1px solid #cbd5e1;">${order.title}</td><td style="padding:4px 10px;border:1px solid #cbd5e1;">${workOrderStatusLabel[order.status] || order.status}</td><td style="padding:4px 10px;border:1px solid #cbd5e1;">%${order.progress_pct}</td></tr>`,
      )
      .join("");
    const materialRows = materials
      .map(
        (item) =>
          `<tr><td style="padding:4px 10px;border:1px solid #cbd5e1;">${materialLabel(item)}</td><td style="padding:4px 10px;border:1px solid #cbd5e1;">${materialSourceLabel[item.material_source] || item.material_source}</td><td style="padding:4px 10px;border:1px solid #cbd5e1;">${item.quantity} ${item.unit}</td></tr>`,
      )
      .join("");
    const financeSection =
      role === "admin"
        ? `<h2 style="font-size:16pt;font-weight:bold;margin-top:24px;">Mali Özet</h2>
           <table style="border-collapse:collapse;width:100%;margin-top:8px;">${rows("Toplam Satış", formatTRY(totalSales))}${rows("Toplam Maliyet", formatTRY(totalCost))}${rows("Kâr", formatTRY(totalMargin))}</table>`
        : "";
    const body = `
      <div style="font-family:Calibri,Arial,sans-serif;color:#0f172a;">
        <div style="border-bottom:4px solid #1d4ed8;padding-bottom:12px;">
          <h1 style="font-size:22pt;font-weight:bold;margin:0;">Proje Raporu</h1>
          <p style="color:#64748b;margin:4px 0 0;">${project.project_no} · ${project.name}</p>
        </div>
        <table style="border-collapse:collapse;width:100%;margin-top:16px;">
          ${rows("Müşteri", project.customers?.name || "—")}
          ${rows("Durum", projectStatusLabel[project.status])}
          ${rows("Konum", location || "Konum girilmedi")}
          ${rows("Tarih", `${formatProjectDate(project.start_date)} → ${formatProjectDate(project.target_end_date)}`)}
          ${rows("Proje Türü", processes.map((process) => projectTypeLabel[process.process_type]).join(", ") || "—")}
          ${rows("Genel İlerleme", `${overallProgress.completed}/${overallProgress.total} görev tamamlandı · %${overallProgress.percentage} onaylı ilerleme`)}
        </table>
        <h2 style="font-size:16pt;font-weight:bold;margin-top:24px;">Görev Takibi</h2>
        <table style="border-collapse:collapse;width:100%;margin-top:8px;">
          <tr><td style="padding:4px 10px;border:1px solid #cbd5e1;font-weight:bold;background:#eff6ff;">Faz</td><td style="padding:4px 10px;border:1px solid #cbd5e1;font-weight:bold;background:#eff6ff;">Görev</td><td style="padding:4px 10px;border:1px solid #cbd5e1;font-weight:bold;background:#eff6ff;">Durum</td><td style="padding:4px 10px;border:1px solid #cbd5e1;font-weight:bold;background:#eff6ff;">Onaylı İlerleme</td></tr>
          ${taskRows || `<tr><td style="padding:4px 10px;border:1px solid #cbd5e1;" colspan="4">Henüz proje görevi tanımlanmadı.</td></tr>`}
        </table>
        <h2 style="font-size:16pt;font-weight:bold;margin-top:24px;">Bağlı Saha Görevleri</h2>
        <table style="border-collapse:collapse;width:100%;margin-top:8px;">
          <tr><td style="padding:4px 10px;border:1px solid #cbd5e1;font-weight:bold;background:#eff6ff;">No</td><td style="padding:4px 10px;border:1px solid #cbd5e1;font-weight:bold;background:#eff6ff;">Başlık</td><td style="padding:4px 10px;border:1px solid #cbd5e1;font-weight:bold;background:#eff6ff;">Durum</td><td style="padding:4px 10px;border:1px solid #cbd5e1;font-weight:bold;background:#eff6ff;">İlerleme</td></tr>
          ${workOrderRows || `<tr><td style="padding:4px 10px;border:1px solid #cbd5e1;" colspan="4">Bu projeye bağlı saha görevi yok.</td></tr>`}
        </table>
        <h2 style="font-size:16pt;font-weight:bold;margin-top:24px;">Kullanılan Malzemeler</h2>
        <table style="border-collapse:collapse;width:100%;margin-top:8px;">
          <tr><td style="padding:4px 10px;border:1px solid #cbd5e1;font-weight:bold;background:#eff6ff;">Malzeme</td><td style="padding:4px 10px;border:1px solid #cbd5e1;font-weight:bold;background:#eff6ff;">Kaynak</td><td style="padding:4px 10px;border:1px solid #cbd5e1;font-weight:bold;background:#eff6ff;">Miktar</td></tr>
          ${materialRows || `<tr><td style="padding:4px 10px;border:1px solid #cbd5e1;" colspan="3">Henüz malzeme kaydı yok.</td></tr>`}
        </table>
        ${financeSection}
        <p style="margin-top:32px;color:#64748b;font-size:9pt;text-align:center;">${NES_CONTACT_ADDRESS}<br/>Telefon: ${NES_CONTACT_PHONE} · Mail: ${NES_CONTACT_EMAIL}</p>
      </div>`;
    downloadWordDocument(`proje-raporu-${project.project_no}.doc`, "Proje Raporu", body);
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="print:hidden mb-5 flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost">
          <Link to="/projects/$projectId" params={{ projectId }}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Projeye dön
          </Link>
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportWord}>
            <FileDown className="mr-2 h-4 w-4" /> Word Olarak İndir
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" /> PDF / Yazdır
          </Button>
        </div>
      </div>

      <article className="rounded-xl bg-white p-6 pb-20 text-slate-950 shadow-sm print:rounded-none print:p-0 print:pb-24 print:pt-24 print:shadow-none">
        <header className="flex items-start justify-between gap-6 border-b-4 border-blue-700 pb-5 print:hidden">
          <div>
            <h1 className="text-3xl font-black">Proje Raporu</h1>
            <p className="mt-1 text-slate-500">
              {project.project_no} · {project.name}
            </p>
          </div>
          <img
            src={NES_LOGO_URL}
            alt="NES Enerji"
            className="h-10 w-auto shrink-0 object-contain print:h-12"
          />
        </header>
        {/* Yazdırmada her sayfanın başında tekrar eden sabit antet (footer'la aynı teknik). */}
        <header className="fixed inset-x-0 top-0 hidden items-center justify-between gap-4 border-b-4 border-blue-700 bg-white px-6 py-3 print:flex">
          <div>
            <h1 className="text-lg font-black">Proje Raporu</h1>
            <p className="text-xs text-slate-500">
              {project.project_no} · {project.name}
            </p>
          </div>
          <img
            src={NES_LOGO_URL}
            alt="NES Enerji"
            className="h-8 w-auto shrink-0 object-contain"
          />
        </header>

        <section className="mt-6 grid gap-3 rounded-xl bg-blue-50 p-5 sm:grid-cols-2">
          <p>
            <strong>Müşteri:</strong> {project.customers?.name || "—"}
          </p>
          <p>
            <strong>Durum:</strong> {projectStatusLabel[project.status]}
          </p>
          <p>
            <strong>Konum:</strong> {location || "Konum girilmedi"}
          </p>
          <p>
            <strong>Tarih:</strong> {formatProjectDate(project.start_date)} →{" "}
            {formatProjectDate(project.target_end_date)}
          </p>
          <p className="sm:col-span-2">
            <strong>Proje Türü:</strong>{" "}
            {processes.map((process) => projectTypeLabel[process.process_type]).join(", ") || "—"}
          </p>
        </section>

        {project.description ? (
          <section className="mt-7">
            <h2 className="text-xl font-black">Proje Açıklaması</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{project.description}</p>
          </section>
        ) : null}

        <section className="mt-7">
          <h2 className="text-xl font-black">Genel İlerleme</h2>
          <p className="mt-2 text-sm text-slate-700">
            {overallProgress.completed}/{overallProgress.total} görev tamamlandı ·{" "}
            <strong>%{overallProgress.percentage}</strong> onaylı ilerleme
          </p>
        </section>

        <section className="mt-7">
          <h2 className="text-xl font-black">Görev Takibi ve Kanıtlar</h2>
          <div className="mt-3 space-y-6">
            {phases.map((phase) => (
              <div key={phase.order}>
                <h3 className="text-sm font-black uppercase tracking-wide text-blue-700">
                  {phase.name}
                </h3>
                <div className="mt-2 space-y-3">
                  {phase.tasks.map((task) => {
                    const evidence = evidenceByTaskId.get(task.id) ?? [];
                    return (
                      <div
                        key={task.id}
                        className="break-inside-avoid rounded-lg border border-slate-200 p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-bold">{task.task_name}</p>
                          <Badge variant="outline" className={taskStatusClass[task.status]}>
                            {projectTaskStatusLabel[task.status]}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          Sorumlu: {assigneeById.get(task.responsible_id ?? "") || "Atanmadı"} · Plan:{" "}
                          {formatProjectDate(task.planned_date)} · Onaylı ilerleme: %
                          {task.approved_progress_pct}
                        </p>
                        {task.note ? (
                          <p className="mt-2 whitespace-pre-wrap text-xs text-slate-600">{task.note}</p>
                        ) : null}
                        {evidence.length ? (
                          <div className="mt-3 grid gap-2 sm:grid-cols-3">
                            {evidence.map((item) =>
                              item.evidence_type === "photo" && item.signedUrl ? (
                                <img
                                  key={item.id}
                                  src={item.signedUrl}
                                  alt={item.description || item.file_name}
                                  className="aspect-video w-full rounded-md border border-slate-200 object-cover"
                                />
                              ) : (
                                <div
                                  key={item.id}
                                  className="flex aspect-video w-full flex-col items-center justify-center gap-1 rounded-md border border-slate-200 bg-slate-50 text-blue-700"
                                >
                                  <FileText className="h-6 w-6" />
                                  <span className="px-2 text-center text-[10px] font-semibold">
                                    {item.file_name}
                                  </span>
                                </div>
                              ),
                            )}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {phases.length === 0 ? (
              <p className="text-sm text-slate-500">Henüz proje görevi tanımlanmadı.</p>
            ) : null}
          </div>
        </section>

        <section className="mt-7">
          <h2 className="text-xl font-black">Bağlı Saha Görevleri</h2>
          <div className="mt-3 grid gap-2">
            {workOrders.map((order) => (
              <div
                key={order.id}
                className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 p-3"
              >
                <div>
                  <p className="font-bold">
                    #{order.work_order_no} · {order.title}
                  </p>
                  <p className="text-xs text-slate-500">
                    {workOrderStatusLabel[order.status] || order.status} · İlerleme %{order.progress_pct}
                  </p>
                </div>
              </div>
            ))}
            {workOrders.length === 0 ? (
              <p className="text-sm text-slate-500">Bu projeye bağlı saha görevi yok.</p>
            ) : null}
          </div>
        </section>

        <section className="mt-7">
          <h2 className="text-xl font-black">Kullanılan Malzemeler</h2>
          <div className="mt-3 grid gap-2">
            {materials.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 p-3"
              >
                <div>
                  <p className="font-bold">{materialLabel(item)}</p>
                  <p className="text-xs text-slate-500">
                    {materialSourceLabel[item.material_source] || item.material_source}
                  </p>
                </div>
                <strong>
                  {item.quantity} {item.unit}
                </strong>
              </div>
            ))}
            {materials.length === 0 ? (
              <p className="text-sm text-slate-500">Henüz malzeme kaydı yok.</p>
            ) : null}
          </div>
        </section>

        {role === "admin" ? (
          <section className="mt-7 break-inside-avoid">
            <h2 className="text-xl font-black">Mali Özet</h2>
            <div className="mt-3 grid gap-3 rounded-xl bg-blue-50 p-5 sm:grid-cols-3">
              <p>
                <strong className="block text-xs uppercase tracking-wide text-slate-500">
                  Toplam Satış
                </strong>
                <span className="text-lg font-black">{formatTRY(totalSales)}</span>
              </p>
              <p>
                <strong className="block text-xs uppercase tracking-wide text-slate-500">
                  Toplam Maliyet
                </strong>
                <span className="text-lg font-black">{formatTRY(totalCost)}</span>
              </p>
              <p>
                <strong className="block text-xs uppercase tracking-wide text-slate-500">Kâr</strong>
                <span className={`text-lg font-black ${totalMargin < 0 ? "text-red-600" : "text-blue-700"}`}>
                  {formatTRY(totalMargin)}
                </span>
              </p>
            </div>
          </section>
        ) : null}

        <footer className="fixed inset-x-0 bottom-0 hidden border-t border-slate-200 bg-white px-6 py-2 text-center text-[10px] leading-4 text-slate-500 print:block">
          <p>{NES_CONTACT_ADDRESS}</p>
          <p>
            Telefon: {NES_CONTACT_PHONE} · Mail: {NES_CONTACT_EMAIL}
          </p>
        </footer>
        <footer className="mt-10 border-t border-slate-200 pt-3 text-center text-xs leading-5 text-slate-500 print:hidden">
          <p>{NES_CONTACT_ADDRESS}</p>
          <p>
            Telefon: {NES_CONTACT_PHONE} · Mail: {NES_CONTACT_EMAIL}
          </p>
        </footer>
      </article>
    </div>
  );
}

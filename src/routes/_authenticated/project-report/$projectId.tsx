import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, FileText, Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { errorMessage } from "@/lib/domain";
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

  const { project, processes, tasks, workOrders, assignees, evidenceByTaskId } = reportQuery.data;
  const assigneeById = new Map(assignees.map((assignee) => [assignee.id, assignee.full_name]));
  const location = [project.province, project.district, project.neighborhood]
    .filter(Boolean)
    .join(" / ");
  const phases = groupByPhase(tasks);
  const overallProgress = projectApprovedProgress(tasks);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="print:hidden mb-5 flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost">
          <Link to="/projects/$projectId" params={{ projectId }}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Projeye dön
          </Link>
        </Button>
        <Button variant="outline" onClick={() => window.print()}>
          <Printer className="mr-2 h-4 w-4" /> PDF / Yazdır
        </Button>
      </div>

      <article className="rounded-xl bg-white p-6 pb-20 text-slate-950 shadow-sm print:rounded-none print:p-0 print:pb-24 print:shadow-none">
        <header className="flex items-start justify-between gap-6 border-b-4 border-blue-700 pb-5">
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

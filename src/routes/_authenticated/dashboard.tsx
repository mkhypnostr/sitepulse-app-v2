import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  Boxes,
  BriefcaseBusiness,
  CheckCircle2,
  Clock3,
  FolderKanban,
  Package,
  PlusCircle,
  UserCog,
  UsersRound,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/lib/auth-context";
import { isOperationalManager } from "@/lib/permissions";
import { errorMessage, statusLabels } from "@/lib/domain";
import { formatDate, formatTRY } from "@/lib/format";
import { PageHeader, LoadingState } from "@/components/page-states";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { formatProjectDateTime } from "@/lib/projects";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

type ProjectSubmission = Database["public"]["Tables"]["project_task_progress_submissions"]["Row"];
type WorkSubmission = Database["public"]["Tables"]["progress_updates"]["Row"];
type ProjectTaskSummary = Pick<
  Database["public"]["Tables"]["project_tasks"]["Row"],
  "id" | "project_id" | "task_name" | "phase_name"
>;
type ProjectSummary = Pick<
  Database["public"]["Tables"]["projects"]["Row"],
  "id" | "name" | "project_no"
>;
type ProjectDashboardSummary = Pick<
  Database["public"]["Tables"]["projects"]["Row"],
  "id" | "status"
>;
type VisibleProjectTask = Pick<
  Database["public"]["Tables"]["project_tasks"]["Row"],
  | "id"
  | "project_id"
  | "task_name"
  | "phase_name"
  | "status"
  | "approved_progress_pct"
  | "planned_date"
  | "responsible_id"
>;
type OperationalTaskSummary = Pick<
  Database["public"]["Tables"]["operational_tasks"]["Row"],
  "id" | "title" | "project_id" | "planned_date" | "status" | "assigned_to"
>;

function DashboardPage() {
  const { role } = useAuth();
  const operationalManager = isOperationalManager(role);
  const query = useQuery({
    queryKey: ["dashboard", role],
    enabled: Boolean(role),
    queryFn: async () => {
      // Technical office sees all assigned saha görevleri, but never receives
      // financial joins or financial-table data.
      const orders =
        role === "technical_office"
          ? await (async () => {
              const { data, error } = await supabase
                .from("work_orders")
                .select("id, customer_id, title, description, location, scheduled_at, progress_pct, status, created_by, created_at, updated_at, work_order_no, location_url, completion_note, completion_submitted_at, completion_submitted_by, review_note, reviewed_at, reviewed_by, work_scope_type, default_material_source, project_id, show_to_customer")
                .order("scheduled_at", { ascending: false });
              if (error) throw error;
              return (data ?? []) as unknown as Database["public"]["Tables"]["work_orders"]["Row"][];
            })()
          : await (async () => {
              const { data, error } = await supabase
                .from("work_orders")
                .select(
                  "*, customers(name), projects(name, project_no), work_order_financials(customer_amount, contractor_labor_amount, estimated_material_cost, approved_progress_pct)",
                )
                .order("scheduled_at", { ascending: false });
              if (error) throw error;
              return data ?? [];
            })();

      let stock: { quantity: number; min_quantity: number }[] = [];
      let projectSubmissions: ProjectSubmission[] = [];
      let workSubmissions: WorkSubmission[] = [];
      let projectTasks: ProjectTaskSummary[] = [];
      let projects: ProjectSummary[] = [];
      let allProjects: ProjectDashboardSummary[] = [];
      let assignments: Array<{ work_order_id: string }> = [];
      let profileNames: Array<{ id: string; full_name: string }> = [];
      let visibleProjectTasks: VisibleProjectTask[] = [];
      let independentTasks: OperationalTaskSummary[] = [];
      if (operationalManager || role === "contractor") {
        const { data, error } = await supabase.from("stock_items").select("quantity, min_quantity");
        if (error) throw error;
        stock = data;
      }
      if (operationalManager) {
        const [allProjectsResult, visibleTasksResult, assignmentsResult, independentTasksResult] = await Promise.all([
          supabase.from("projects").select("id, status"),
          supabase
            .from("project_tasks")
            .select("id, project_id, task_name, phase_name, status, approved_progress_pct, planned_date, responsible_id")
            .order("planned_date", { ascending: true, nullsFirst: false }),
          supabase.from("work_order_assignments").select("work_order_id"),
          supabase
            .from("operational_tasks")
            .select("id, title, project_id, planned_date, status, assigned_to")
            .order("planned_date", { ascending: true, nullsFirst: false }),
        ]);
        if (allProjectsResult.error) throw allProjectsResult.error;
        if (visibleTasksResult.error) throw visibleTasksResult.error;
        if (assignmentsResult.error) throw assignmentsResult.error;
        if (independentTasksResult.error) throw independentTasksResult.error;
        allProjects = allProjectsResult.data ?? [];
        visibleProjectTasks = visibleTasksResult.data ?? [];
        assignments = assignmentsResult.data ?? [];
        independentTasks = independentTasksResult.data ?? [];
      }
      if (role === "admin") {
        const [
          pendingResult,
          approvedResult,
          workPendingResult,
          workApprovedResult,
        ] = await Promise.all([
          supabase
            .from("project_task_progress_submissions")
            .select("*")
            .eq("status", "pending")
            .order("submitted_at", { ascending: false }),
          supabase
            .from("project_task_progress_submissions")
            .select("*")
            .eq("status", "approved")
            .order("reviewed_at", { ascending: false })
            .limit(8),
          supabase
            .from("progress_updates")
            .select("*")
            .eq("status", "pending")
            .order("created_at", { ascending: false }),
          supabase
            .from("progress_updates")
            .select("*")
            .eq("status", "approved")
            .not("reviewed_at", "is", null)
            .order("reviewed_at", { ascending: false })
            .limit(8),
        ]);
        if (pendingResult.error) throw pendingResult.error;
        if (approvedResult.error) throw approvedResult.error;
        if (workPendingResult.error) throw workPendingResult.error;
        if (workApprovedResult.error) throw workApprovedResult.error;
        projectSubmissions = [...pendingResult.data, ...approvedResult.data];
        workSubmissions = [...workPendingResult.data, ...workApprovedResult.data];

        const taskIds = [...new Set(projectSubmissions.map((item) => item.project_task_id))];
        if (taskIds.length) {
          const taskResult = await supabase
            .from("project_tasks")
            .select("id, project_id, task_name, phase_name")
            .in("id", taskIds);
          if (taskResult.error) throw taskResult.error;
          projectTasks = taskResult.data;

          const projectIds = [...new Set(projectTasks.map((item) => item.project_id))];
          const projectsResult = await (projectIds.length
            ? supabase.from("projects").select("id, name, project_no").in("id", projectIds)
            : Promise.resolve({ data: [], error: null }));
          if (projectsResult.error) throw projectsResult.error;
          projects = projectsResult.data ?? [];
        }

        const userIds = [
          ...new Set(
            [
              ...projectSubmissions.flatMap((item) => [item.submitted_by, item.reviewed_by]),
              ...workSubmissions.flatMap((item) => [item.contractor_id, item.reviewed_by]),
              ...orders.flatMap((item) => [item.completion_submitted_by, item.reviewed_by]),
            ].filter(Boolean) as string[],
          ),
        ];
        if (userIds.length) {
          const profilesResult = await supabase
            .from("profiles")
            .select("id, full_name")
            .in("id", userIds);
          if (profilesResult.error) throw profilesResult.error;
          profileNames = profilesResult.data ?? [];
        }
      }
      return {
        orders,
        stock,
        projectSubmissions,
        workSubmissions,
        projectTasks,
        projects,
        allProjects,
        assignments,
        profileNames,
        visibleProjectTasks,
        independentTasks,
      };
    },
  });

  if (query.isLoading) return <LoadingState />;
  if (query.error) {
    return <p className="surface-panel p-5 text-destructive">{errorMessage(query.error)}</p>;
  }

  const orders = query.data?.orders ?? [];
  const active = orders.filter((order) => order.status === "in_progress").length;
  const completed = orders.filter((order) => order.status === "completed").length;
  const allProjects = query.data?.allProjects ?? [];
  const visibleProjectTasks = query.data?.visibleProjectTasks ?? [];
  const independentTasks = query.data?.independentTasks ?? [];
  const activeProjects = allProjects.filter((project) => project.status === "active").length;
  // Proje oluşturulurken gelen şablon satırları, bir sorumlusu veya gerçek bir
  // saha hareketi yoksa operasyon görevi olarak sayılmaz.
  const trackedProjectTasks = visibleProjectTasks.filter(
    (task) =>
      Boolean(task.responsible_id) ||
      task.approved_progress_pct > 0 ||
      ["in_progress", "external_approval", "blocked", "completed"].includes(task.status),
  );
  const technicalOpenTasks = trackedProjectTasks.filter((task) =>
    ["in_progress", "external_approval", "blocked"].includes(task.status),
  ).length;
  const technicalCompletedTasks = trackedProjectTasks.filter((task) => task.status === "completed").length;
  const independentOpenTasks = independentTasks.filter((task) =>
    ["in_progress", "external_approval", "blocked"].includes(task.status),
  ).length;
  const independentCompletedTasks = independentTasks.filter((task) => task.status === "completed").length;
  const assignedOrderIds = new Set(
    (query.data?.assignments ?? []).map((item) => item.work_order_id),
  );
  const unassignedTasks = orders.filter((order) => !assignedOrderIds.has(order.id)).length;
  const unassignedProjectTasks = trackedProjectTasks.filter((task) => !task.responsible_id).length;
  const unassignedIndependentTasks = independentTasks.filter((task) => !task.assigned_to).length;
  const projectSubmissions = query.data?.projectSubmissions ?? [];
  const workSubmissions = query.data?.workSubmissions ?? [];
  const pendingWorkSubmissions = workSubmissions.filter((item) => item.status === "pending");
  const approvedWorkSubmissions = workSubmissions.filter((item) => item.status === "approved");
  const pendingProjectSubmissions = projectSubmissions.filter((item) => item.status === "pending");
  const approvedProjectSubmissions = projectSubmissions.filter(
    (item) => item.status === "approved",
  );
  const pendingCompletionOrders = orders.filter((order) => order.status === "review_pending");
  const overdueOrders = orders.filter(
    (order) =>
      new Date(order.scheduled_at).getTime() < Date.now() &&
      !["completed", "cancelled"].includes(order.status),
  );
  const overdueProjectTasks = trackedProjectTasks.filter(
    (task) =>
      Boolean(task.planned_date) &&
      new Date(`${task.planned_date}T23:59:59`).getTime() < Date.now() &&
      !["completed", "not_applicable"].includes(task.status),
  );
  const overdueIndependentTasks = independentTasks.filter(
    (task) =>
      Boolean(task.planned_date) &&
      new Date(`${task.planned_date}T23:59:59`).getTime() < Date.now() &&
      !["completed", "cancelled", "not_applicable"].includes(task.status),
  );
  const projectTaskById = new Map((query.data?.projectTasks ?? []).map((item) => [item.id, item]));
  const projectById = new Map((query.data?.projects ?? []).map((item) => [item.id, item]));
  const profileNameById = new Map(
    (query.data?.profileNames ?? []).map((item) => [item.id, item.full_name]),
  );
  const lowStock = (query.data?.stock ?? []).filter(
    (item) => item.quantity <= item.min_quantity,
  ).length;
  const firstPendingWork = pendingWorkSubmissions[0];
  const firstPendingProject = pendingProjectSubmissions[0];
  const firstPendingProjectTask = firstPendingProject
    ? projectTaskById.get(firstPendingProject.project_task_id)
    : undefined;
  const pendingApprovalCount =
    pendingCompletionOrders.length + pendingWorkSubmissions.length + pendingProjectSubmissions.length;
  const pendingTarget = pendingCompletionOrders[0]
    ? `/jobs/${pendingCompletionOrders[0].id}#completion-approval`
    : firstPendingWork
      ? `/jobs/${firstPendingWork.work_order_id}#progress-approval`
      : firstPendingProjectTask
        ? `/projects/${firstPendingProjectTask.project_id}#task-${firstPendingProjectTask.id}`
        : firstPendingProject
          ? "#project-approvals"
          : undefined;
  const overdueTaskCount = overdueOrders.length + overdueProjectTasks.length + overdueIndependentTasks.length;

  const projectMetrics =
    role === "admin"
      ? [
          {
            label: "Toplam Proje / Şantiye",
            value: allProjects.length,
            icon: FolderKanban,
            href: "/projects",
          },
          {
            label: "Aktif Proje / Şantiye",
            value: activeProjects,
            icon: Clock3,
            href: "/projects",
          },
          {
            label: "Onay Bekleyen",
            value: pendingApprovalCount,
            icon: AlertTriangle,
            href: pendingTarget,
            attention: "danger",
            emptyMessage: "Onay bekleyen kayıt yok.",
          },
          {
            label: "Geciken Görevler",
            value: overdueTaskCount,
            icon: AlertTriangle,
            href: overdueTaskCount > 0 ? "#overdue-tasks" : undefined,
            attention: "warning",
            emptyMessage: "Geciken görev yok.",
          },
          { label: "Kritik Stok", value: lowStock, icon: Package, href: "/stock" },
        ]
      : role === "technical_office"
        ? [
            {
              label: "Toplam Proje",
              value: allProjects.length,
              icon: FolderKanban,
              href: "/projects",
            },
            {
              label: "Aktif Proje",
              value: activeProjects,
              icon: Clock3,
              href: "/projects",
            },
            {
              label: "Açık Görev",
              value: technicalOpenTasks + active,
              icon: BriefcaseBusiness,
              href: "/tasks",
            },
            {
              label: "Tamamlanan Görev",
              value: technicalCompletedTasks + completed,
              icon: CheckCircle2,
              href: "/tasks",
            },
            { label: "Kritik Stok", value: lowStock, icon: Package, href: "/stock" },
          ]
        : [
          {
            label: "Aktif İş",
            value: active,
            icon: BriefcaseBusiness,
            href: role === "customer" ? "/my-projects" : "/my-jobs",
          },
          {
            label: "Tamamlanan",
            value: completed,
            icon: CheckCircle2,
            href: role === "customer" ? "/my-projects" : "/my-jobs",
          },
          {
            label: "Toplam İş",
            value: orders.length,
            icon: Clock3,
            href: role === "customer" ? "/my-projects" : "/my-jobs",
          },
        ];

  const taskRoute = role === "admin" ? "/work-orders" : "/tasks";
  const taskMetrics = [
    { label: "Takip Edilen Görev", value: orders.length + trackedProjectTasks.length + independentTasks.length, icon: BriefcaseBusiness, href: taskRoute },
    { label: "Devam Eden", value: active + technicalOpenTasks + independentOpenTasks, icon: Clock3, href: taskRoute },
    { label: "Atama Bekleyen", value: unassignedTasks + unassignedProjectTasks + unassignedIndependentTasks, icon: UserCog, href: taskRoute },
    { label: "Tamamlanan", value: completed + technicalCompletedTasks + independentCompletedTasks, icon: CheckCircle2, href: taskRoute },
  ];

  const quickActions = [
    {
      label: "Yeni Görev",
      description: "Projeye bağla veya bağımsız ata",
      to: "/work-orders" as const,
      search: { create: true },
      icon: PlusCircle,
    },
    {
      label: "Müşteri Ekle",
      description: "Firma ve portal bağlantısı",
      to: "/customers" as const,
      icon: UsersRound,
    },
    {
      label: "Stok Yönetimi",
      description: "Malzeme ve kritik stok",
      to: "/stock" as const,
      icon: Boxes,
    },
    {
      label: "Ekip ve Yetkiler",
      description: "Yönetici, taşeron, müşteri",
      to: "/team" as const,
      icon: UserCog,
    },
  ];

  return (
    <>
      <PageHeader
        title="Operasyon Paneli"
        description={
          operationalManager
            ? "Saha, taşeron, ilerleme ve stok durumunun güncel özeti."
            : "Size açık işlerin ve projelerin güncel özeti."
        }
      />

      {operationalManager ? (
        <section>
          <div className="mb-3">
            <h2 className="text-lg font-bold">Proje ve Şantiye Özeti</h2>
            <p className="text-sm text-muted-foreground">
              Portföy, onay, gecikme ve stok durumunu tek bakışta görün.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {projectMetrics.map((metric) => {
              const card = (
                <Card
                  className={
                    metric.attention === "danger" && metric.value > 0
                      ? "border-red-500/40 bg-red-500/5"
                      : metric.attention === "warning" && metric.value > 0
                        ? "border-amber-500/40 bg-amber-500/5"
                        : "border-border bg-card"
                  }
                >
                  <CardContent className="flex items-center gap-3 p-4 sm:gap-4 sm:p-5">
                    <div
                      className={
                        metric.attention === "danger" && metric.value > 0
                          ? "rounded-lg bg-red-500/15 p-3 text-red-300 animate-pulse"
                          : metric.attention === "warning" && metric.value > 0
                            ? "rounded-lg bg-amber-500/15 p-3 text-amber-300"
                            : "rounded-lg bg-primary/15 p-3 text-primary"
                      }
                    >
                      <metric.icon className="h-5 w-5 sm:h-6 sm:w-6" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground sm:text-sm">{metric.label}</p>
                      <p className="text-2xl font-black sm:text-3xl">{metric.value}</p>
                    </div>
                  </CardContent>
                </Card>
              );
              return metric.href ? (
                <a
                  key={metric.label}
                  href={metric.href}
                  aria-label={`${metric.label}: ${metric.value}`}
                  className="block cursor-pointer transition-transform hover:-translate-y-0.5"
                >
                  {card}
                </a>
              ) : metric.emptyMessage ? (
                <button
                  key={metric.label}
                  type="button"
                  onClick={() => toast.info(metric.emptyMessage)}
                  className="block w-full cursor-pointer text-left transition-transform hover:-translate-y-0.5"
                >
                  {card}
                </button>
              ) : (
                <div key={metric.label}>
                  {card}
                </div>
              );
            })}
          </div>
        </section>
      ) : (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {projectMetrics.map((metric) => {
            const card = (
              <Card className="border-border bg-card">
                <CardContent className="flex items-center gap-3 p-4 sm:gap-4 sm:p-5">
                  <div className="rounded-lg bg-primary/15 p-3 text-primary">
                    <metric.icon className="h-5 w-5 sm:h-6 sm:w-6" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground sm:text-sm">{metric.label}</p>
                    <p className="text-2xl font-black sm:text-3xl">{metric.value}</p>
                  </div>
                </CardContent>
              </Card>
            );
            return metric.href ? (
              <a key={metric.label} href={metric.href} className="block">
                {card}
              </a>
            ) : (
              <div key={metric.label}>{card}</div>
            );
          })}
        </div>
      )}

      {operationalManager ? (
        <section className="mt-7">
          <div className="mb-3">
            <h2 className="text-lg font-bold">Görev Özeti</h2>
            <p className="text-sm text-muted-foreground">
              Projelere bağlı ve bağımsız operasyon görevlerinin durumu.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {taskMetrics.map((metric) => (
              <a key={metric.label} href={metric.href} className="block">
                <Card className="border-border bg-card">
                  <CardContent className="flex items-center gap-3 p-4 sm:gap-4 sm:p-5">
                    <div className="rounded-lg bg-primary/15 p-3 text-primary">
                      <metric.icon className="h-5 w-5 sm:h-6 sm:w-6" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground sm:text-sm">{metric.label}</p>
                      <p className="text-2xl font-black sm:text-3xl">{metric.value}</p>
                    </div>
                  </CardContent>
                </Card>
              </a>
            ))}
          </div>
        </section>
      ) : null}

      {role === "admin" && overdueTaskCount ? (
        <section id="overdue-tasks" className="mt-7 scroll-mt-6">
          <div className="mb-3">
            <h2 className="text-lg font-bold">Geciken Görevler</h2>
            <p className="text-sm text-muted-foreground">Planlanan tarihi geçmiş, henüz kapanmamış kayıtlar.</p>
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            {overdueOrders.map((order) => (
              <a key={order.id} href={`/jobs/${order.id}`} className="surface-panel block border-amber-500/40 bg-amber-500/5 p-4 transition-colors hover:bg-amber-500/10">
                <p className="text-xs font-black text-amber-300">SAHA GÖREVİ GECİKTİ</p>
                <p className="mt-1 font-black">#{order.work_order_no} · {order.title}</p>
                <p className="mt-2 text-xs text-muted-foreground">Planlanan tarih: {formatDate(order.scheduled_at)}</p>
              </a>
            ))}
            {overdueProjectTasks.map((task) => (
              <a key={task.id} href={`/projects/${task.project_id}#task-${task.id}`} className="surface-panel block border-amber-500/40 bg-amber-500/5 p-4 transition-colors hover:bg-amber-500/10">
                <p className="text-xs font-black text-amber-300">PROJE GÖREVİ GECİKTİ</p>
                <p className="mt-1 font-black">{task.task_name}</p>
                <p className="mt-2 text-xs text-muted-foreground">{task.phase_name} · Planlanan tarih: {task.planned_date ? formatDate(task.planned_date) : "—"}</p>
              </a>
            ))}
            {overdueIndependentTasks.map((task) => (
              <a key={task.id} href="/tasks" className="surface-panel block border-amber-500/40 bg-amber-500/5 p-4 transition-colors hover:bg-amber-500/10">
                <p className="text-xs font-black text-amber-300">BAĞIMSIZ GÖREV GECİKTİ</p>
                <p className="mt-1 font-black">{task.title}</p>
                <p className="mt-2 text-xs text-muted-foreground">Planlanan tarih: {task.planned_date ? formatDate(task.planned_date) : "—"}</p>
              </a>
            ))}
          </div>
        </section>
      ) : null}

      {role === "admin" ? (
        <section className="mt-7">
          <div className="mb-3">
            <h2 className="text-lg font-bold">İş Bitirme Onayları</h2>
            <p className="text-sm text-muted-foreground">
              Kayda dokunduğunuzda yeşil onay ve kırmızı revizyon düğmeleri ekranın başında açılır.
            </p>
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            {pendingCompletionOrders.map((order) => (
              <a
                key={order.id}
                href={`/jobs/${order.id}#completion-approval`}
                className="surface-panel block border-red-500/40 bg-red-500/5 p-4 transition-colors hover:bg-red-500/10"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="animate-pulse text-xs font-black text-red-300">
                      İŞ BİTİRME ONAYI BEKLİYOR
                    </p>
                    <p className="mt-1 font-black">
                      #{order.work_order_no} · {order.title}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {order.completion_note || "İş bitirme açıklaması"}
                    </p>
                  </div>
                  <AlertTriangle className="h-5 w-5 shrink-0 text-red-300" />
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  {profileNameById.get(order.completion_submitted_by ?? "") || "Taşeron"}
                  {order.completion_submitted_at
                    ? ` · ${formatProjectDateTime(order.completion_submitted_at)}`
                    : ""}
                </p>
              </a>
            ))}
            {pendingCompletionOrders.length === 0 ? (
              <div className="surface-panel p-5 text-sm text-muted-foreground xl:col-span-2">
                İş bitirme onayı bekleyen kayıt yok.
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {role === "admin" ? (
        <section id="work-order-approvals" className="mt-7 scroll-mt-6">
          <div className="mb-3">
            <h2 className="text-lg font-bold">Görev İlerleme Bildirimleri</h2>
            <p className="text-sm text-muted-foreground">
              Bekleyen ve son onaylanan ilerlemeler. Kayda dokunduğunuzda doğrudan onay alanı
              açılır.
            </p>
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            {pendingWorkSubmissions.map((submission) => {
              const order = orders.find((item) => item.id === submission.work_order_id);
              if (!order) return null;
              return (
                <a
                  key={submission.id}
                  href={`/jobs/${order.id}#progress-approval`}
                  className="surface-panel block border-red-500/40 bg-red-500/5 p-4 transition-colors hover:bg-red-500/10"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-black text-red-300 animate-pulse">ONAY BEKLİYOR</p>
                      <p className="mt-1 font-black">
                        %{submission.pct} · #{order.work_order_no} · {order.title}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">{submission.note}</p>
                    </div>
                    <AlertTriangle className="h-5 w-5 shrink-0 text-red-300" />
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    {profileNameById.get(submission.contractor_id) || "Taşeron"} ·{" "}
                    {formatProjectDateTime(submission.created_at)}
                  </p>
                </a>
              );
            })}

            {approvedWorkSubmissions.map((submission) => {
              const order = orders.find((item) => item.id === submission.work_order_id);
              if (!order) return null;
              return (
                <a
                  key={submission.id}
                  href={`/jobs/${order.id}`}
                  className="surface-panel block border-emerald-500/30 bg-emerald-500/5 p-4 transition-colors hover:bg-emerald-500/10"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-black text-emerald-300">ONAYLANDI</p>
                      <p className="mt-1 font-black">
                        %{submission.pct} · #{order.work_order_no} · {order.title}
                      </p>
                    </div>
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-300" />
                  </div>
                  <p className="mt-3 text-xs text-emerald-200/80">
                    {profileNameById.get(submission.reviewed_by ?? "") || "Yönetici"} tarafından{" "}
                    {formatProjectDateTime(submission.reviewed_at)} tarihinde onaylandı
                  </p>
                </a>
              );
            })}

            {pendingWorkSubmissions.length === 0 && approvedWorkSubmissions.length === 0 ? (
              <div className="surface-panel p-5 text-sm text-muted-foreground xl:col-span-2">
                Henüz görev ilerleme bildirimi yok.
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {role === "admin" ? (
        <section id="project-approvals" className="mt-7 scroll-mt-6">
          <div className="mb-3">
            <h2 className="text-lg font-bold">Proje Görev Bildirimleri</h2>
            <p className="text-sm text-muted-foreground">
              Bekleyen ve son onaylanan ilerlemeler. Bir kayda dokunduğunuzda ilgili görev açılır.
            </p>
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            {pendingProjectSubmissions.map((submission) => {
              const task = projectTaskById.get(submission.project_task_id);
              const project = task ? projectById.get(task.project_id) : undefined;
              if (!task || !project) return null;
              return (
                <a
                  key={submission.id}
                  href={`/projects/${project.id}#task-${task.id}`}
                  className="surface-panel block border-red-500/40 bg-red-500/5 p-4 transition-colors hover:bg-red-500/10"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-black text-red-300 animate-pulse">ONAY BEKLİYOR</p>
                      <p className="mt-1 font-black">
                        %{submission.proposed_pct} · {task.task_name}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {project.project_no} · {project.name} · {task.phase_name}
                      </p>
                    </div>
                    <AlertTriangle className="h-5 w-5 shrink-0 text-red-300" />
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    {profileNameById.get(submission.submitted_by) || "Kullanıcı"} ·{" "}
                    {formatProjectDateTime(submission.submitted_at)}
                  </p>
                </a>
              );
            })}

            {approvedProjectSubmissions.map((submission) => {
              const task = projectTaskById.get(submission.project_task_id);
              const project = task ? projectById.get(task.project_id) : undefined;
              if (!task || !project) return null;
              return (
                <a
                  key={submission.id}
                  href={`/projects/${project.id}#task-${task.id}`}
                  className="surface-panel block border-emerald-500/30 bg-emerald-500/5 p-4 transition-colors hover:bg-emerald-500/10"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-black text-emerald-300">ONAYLANDI</p>
                      <p className="mt-1 font-black">
                        %{submission.proposed_pct} · {task.task_name}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {project.project_no} · {project.name} · {task.phase_name}
                      </p>
                    </div>
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-300" />
                  </div>
                  <p className="mt-3 text-xs text-emerald-200/80">
                    {profileNameById.get(submission.reviewed_by ?? "") || "Yönetici"} tarafından{" "}
                    {formatProjectDateTime(submission.reviewed_at)} tarihinde onaylandı
                  </p>
                </a>
              );
            })}

            {pendingProjectSubmissions.length === 0 && approvedProjectSubmissions.length === 0 ? (
              <div className="surface-panel p-5 text-sm text-muted-foreground xl:col-span-2">
                Henüz proje görevi onay bildirimi yok.
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {role === "admin" ? (
        <section className="mt-7">
          <div className="mb-3">
            <h2 className="text-lg font-bold">Hızlı İşlemler</h2>
            <p className="text-sm text-muted-foreground">
              Sık kullandığınız alanlara tek dokunuşla gidin.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {quickActions.map((action) => (
              <Link
                key={action.label}
                to={action.to}
                search={"search" in action ? action.search : undefined}
                className="group surface-panel flex items-center gap-4 p-4 transition-all hover:-translate-y-0.5 hover:border-primary/70 hover:bg-accent/40"
              >
                <span className="rounded-xl bg-primary/15 p-3 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  <action.icon className="h-6 w-6" />
                </span>
                <span>
                  <span className="block font-bold">{action.label}</span>
                  <span className="block text-xs text-muted-foreground">{action.description}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {role === "technical_office" ? (
        <section className="mt-7">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold">Proje Görevleri</h2>
              <p className="text-sm text-muted-foreground">
                Sorumlu ataması, plan tarihi ve ilerleme için projeyi açın.
              </p>
            </div>
            <Link to="/projects" className="text-sm font-semibold text-primary">
              Tüm projeler
            </Link>
          </div>
          <div className="grid gap-3">
            {visibleProjectTasks.slice(0, 6).map((task) => (
              <Link
                key={task.id}
                to="/projects/$projectId"
                params={{ projectId: task.project_id }}
                hash={`task-${task.id}`}
                className="surface-panel block p-4 transition-colors hover:border-primary/60"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-bold">{task.task_name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{task.phase_name}</p>
                  </div>
                  <div className="text-left sm:text-right">
                    <p className="text-sm font-black text-primary">%{task.approved_progress_pct}</p>
                    <p className="text-xs text-muted-foreground">
                      {task.planned_date ? formatDate(task.planned_date) : "Plan tarihi girilmedi"}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
            {visibleProjectTasks.length === 0 ? (
              <div className="surface-panel p-8 text-center text-sm text-muted-foreground">
                Henüz görüntülenecek proje görevi yok.
              </div>
            ) : null}
          </div>
        </section>
      ) : (
      <section className="mt-7">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">Son Görevler</h2>
          <Link
            to={
              role === "customer"
                ? "/my-projects"
                : role === "contractor"
                  ? "/my-jobs"
                  : "/work-orders"
            }
            className="text-sm font-semibold text-primary"
          >
            Tümünü gör
          </Link>
        </div>
        <div className="grid gap-3">
          {orders.slice(0, 6).map((order) => (
            <Link
              key={order.id}
              to="/jobs/$jobId"
              params={{ jobId: order.id }}
              className="surface-panel block p-4 transition-colors hover:border-primary/60"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">
                      #{order.work_order_no}
                    </span>
                    <Badge variant="outline">{statusLabels[order.status]}</Badge>
                  </div>
                  <h3 className="mt-2 truncate font-bold">{order.title}</h3>
                  {order.projects ? (
                    <p className="text-xs font-semibold text-primary">
                      {order.projects.project_no} · {order.projects.name}
                    </p>
                  ) : null}
                  <p className="text-sm text-muted-foreground">
                    {order.customers?.name} · {formatDate(order.scheduled_at)}
                  </p>
                </div>
                <div className="w-full shrink-0 sm:w-56">
                  <div className="mb-1 flex justify-between text-xs">
                    <span>İlerleme</span>
                    <span className="font-bold">%{order.progress_pct}</span>
                  </div>
                  <Progress value={order.progress_pct} />
                  {role === "admin" ? (
                    <p className="mt-2 text-right text-xs text-muted-foreground">
                      Müşteri: {formatTRY(order.work_order_financials?.customer_amount)}
                    </p>
                  ) : null}
                </div>
              </div>
            </Link>
          ))}
          {orders.length === 0 ? (
            <div className="surface-panel p-8 text-center text-sm text-muted-foreground">
              Henüz görüntülenecek görev yok.
            </div>
          ) : null}
        </div>
      </section>
      )}
    </>
  );
}

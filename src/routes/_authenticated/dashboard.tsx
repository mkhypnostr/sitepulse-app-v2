import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Boxes,
  BriefcaseBusiness,
  CheckCircle2,
  Clock3,
  FileDown,
  FolderKanban,
  ListChecks,
  Package,
  Plus,
  ShieldAlert,
  Wallet,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/lib/auth-context";
import { isOperationalManager, canSeeFinancials } from "@/lib/permissions";
import { errorMessage, statusLabels } from "@/lib/domain";
import { formatDate, formatTRY } from "@/lib/format";
import {
  formatProjectDateTime,
  projectApprovedProgress,
  projectStatusLabel,
  projectTaskStatusLabel,
  type ProjectStatus,
  type ProjectTaskStatus,
} from "@/lib/projects";
import { PageHeader, LoadingState } from "@/components/page-states";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

// work_status enum'unda "not_applicable" ve "external_approval" yok
// (bunlar project_task_status'a ait); yalnızca geçerli değerler tutulur.
// "draft" da hariç tutulur — taslak bir iş emri henüz gerçek/aktif iş değildir.
const TERMINAL_ORDER_STATUSES = [
  "draft",
  "completed",
  "cancelled",
  "review_pending",
];

type ProjectSubmission =
  Database["public"]["Tables"]["project_task_progress_submissions"]["Row"];
type WorkSubmission = Database["public"]["Tables"]["progress_updates"]["Row"];
type CompletionSubmission =
  Database["public"]["Tables"]["work_completion_submissions"]["Row"];
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
  "id" | "name" | "project_no" | "status" | "quoted_amount" | "contract_amount"
> & { customers: { name: string } | null };
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
type ContractorTask = OperationalTaskSummary & {
  projects: { name: string; project_no: string } | null;
};

const TERMINAL_TASK_STATUSES = ["completed", "cancelled", "not_applicable"];

type TaskDueBucket = "overdue" | "today" | "tomorrow" | "future" | "none";

function taskDueBucket(
  plannedDate: string | null,
  referenceNow: Date,
): TaskDueBucket {
  if (!plannedDate) return "none";
  const date = new Date(`${plannedDate.slice(0, 10)}T00:00:00`);
  const startOfToday = new Date(
    referenceNow.getFullYear(),
    referenceNow.getMonth(),
    referenceNow.getDate(),
  );
  const startOfTomorrow = new Date(startOfToday.getTime() + 86_400_000);
  const startOfDayAfter = new Date(startOfToday.getTime() + 2 * 86_400_000);
  if (date < startOfToday) return "overdue";
  if (date < startOfTomorrow) return "today";
  if (date < startOfDayAfter) return "tomorrow";
  return "future";
}

type StockItemSummary = Pick<
  Database["public"]["Tables"]["stock_items"]["Row"],
  "id" | "name" | "quantity" | "min_quantity" | "unit"
>;
type DashboardWorkOrder = Database["public"]["Tables"]["work_orders"]["Row"] & {
  customers: { name: string } | null;
  projects: { name: string; project_no: string } | null;
  work_order_financials: {
    customer_amount: number | null;
    customer_labor_amount: number | null;
    customer_material_amount: number | null;
    contractor_labor_amount: number | null;
    estimated_material_cost: number | null;
    approved_progress_pct: number | null;
  } | null;
};

const EYEBROW =
  "text-[8.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground";

const projectStatusVariant: Record<
  ProjectStatus,
  NonNullable<BadgeProps["variant"]>
> = {
  draft: "outline",
  active: "default",
  on_hold: "warning",
  completed: "success",
  cancelled: "destructive",
};

function DashboardPage() {
  const { role, user } = useAuth();
  const operationalManager = isOperationalManager(role);
  const canFinance = canSeeFinancials(role);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const query = useQuery({
    queryKey: ["dashboard", role, user?.id],
    enabled: Boolean(role),
    queryFn: async () => {
      // Technical office sees project/customer names for its assigned saha
      // görevleri, but the query never touches work_order_financials.
      const orders =
        role === "technical_office"
          ? await (async () => {
              const { data, error } = await supabase
                .from("work_orders")
                .select(
                  "id, customer_id, title, description, location, scheduled_at, progress_pct, status, created_by, created_at, updated_at, work_order_no, location_url, completion_note, completion_submitted_at, completion_submitted_by, review_note, reviewed_at, reviewed_by, work_scope_type, default_material_source, project_id, show_to_customer, customers(name), projects(name, project_no)",
                )
                .order("scheduled_at", { ascending: false });
              if (error) throw error;
              return (data ?? []).map((row) => ({
                ...row,
                work_order_financials: null,
              })) as unknown as DashboardWorkOrder[];
            })()
          : await (async () => {
              const { data, error } = await supabase
                .from("work_orders")
                .select(
                  "*, customers(name), projects(name, project_no), work_order_financials(customer_amount, customer_labor_amount, customer_material_amount, contractor_labor_amount, estimated_material_cost, approved_progress_pct)",
                )
                .order("scheduled_at", { ascending: false });
              if (error) throw error;
              return (data ?? []) as unknown as DashboardWorkOrder[];
            })();

      let stock: StockItemSummary[] = [];
      let projectSubmissions: ProjectSubmission[] = [];
      let workSubmissions: WorkSubmission[] = [];
      let pendingCompletionSubmissions: CompletionSubmission[] = [];
      let projectTasks: ProjectTaskSummary[] = [];
      let projects: ProjectSummary[] = [];
      let allProjects: ProjectDashboardSummary[] = [];
      let visibleProjectTasks: VisibleProjectTask[] = [];
      let independentTasks: OperationalTaskSummary[] = [];
      let myOperationalTasks: ContractorTask[] = [];

      if (operationalManager || role === "contractor") {
        const { data, error } = await supabase
          .from("stock_items")
          .select("id, name, quantity, min_quantity, unit");
        if (error) throw error;
        stock = data;
      }

      if (role === "contractor" && user) {
        const { data, error } = await supabase
          .from("operational_tasks")
          .select(
            "id, title, project_id, planned_date, status, assigned_to, projects(name, project_no)",
          )
          .eq("assigned_to", user.id)
          .order("planned_date", { ascending: true, nullsFirst: false });
        if (error) throw error;
        myOperationalTasks = (data ?? []) as unknown as ContractorTask[];
      }

      if (operationalManager) {
        const [allProjectsResult, visibleTasksResult, independentTasksResult] =
          await Promise.all([
            supabase
              .from("projects")
              .select(
                "id, name, project_no, status, quoted_amount, contract_amount, customers(name)",
              )
              .order("created_at", { ascending: false }),
            supabase
              .from("project_tasks")
              .select(
                "id, project_id, task_name, phase_name, status, approved_progress_pct, planned_date, responsible_id",
              )
              .order("planned_date", { ascending: true, nullsFirst: false }),
            supabase
              .from("operational_tasks")
              .select(
                "id, title, project_id, planned_date, status, assigned_to",
              )
              .order("planned_date", { ascending: true, nullsFirst: false }),
          ]);
        if (allProjectsResult.error) throw allProjectsResult.error;
        if (visibleTasksResult.error) throw visibleTasksResult.error;
        if (independentTasksResult.error) throw independentTasksResult.error;
        allProjects = (allProjectsResult.data ??
          []) as unknown as ProjectDashboardSummary[];
        visibleProjectTasks = visibleTasksResult.data ?? [];
        independentTasks = independentTasksResult.data ?? [];

        // Yalnızca yönetici kararı bekleyen (pending) kayıtlar getirilir; onay
        // geçmişi bu panelde artık gösterilmiyor (bkz. Raporlar).
        const [pendingResult, workPendingResult, completionResult] =
          await Promise.all([
            supabase
              .from("project_task_progress_submissions")
              .select("*")
              .eq("status", "pending")
              .order("submitted_at", { ascending: false }),
            supabase
              .from("progress_updates")
              .select("*")
              .eq("status", "pending")
              .order("created_at", { ascending: false }),
            supabase
              .from("work_completion_submissions")
              .select("*")
              .eq("status", "pending")
              .order("submitted_at", { ascending: false }),
          ]);
        if (pendingResult.error) throw pendingResult.error;
        if (workPendingResult.error) throw workPendingResult.error;
        if (completionResult.error) throw completionResult.error;
        projectSubmissions = pendingResult.data;
        workSubmissions = workPendingResult.data;
        pendingCompletionSubmissions = completionResult.data ?? [];

        const taskIds = [
          ...new Set(projectSubmissions.map((item) => item.project_task_id)),
        ];
        if (taskIds.length) {
          const taskResult = await supabase
            .from("project_tasks")
            .select("id, project_id, task_name, phase_name")
            .in("id", taskIds);
          if (taskResult.error) throw taskResult.error;
          projectTasks = taskResult.data;

          const projectIds = [
            ...new Set(projectTasks.map((item) => item.project_id)),
          ];
          const projectsResult = await (projectIds.length
            ? supabase
                .from("projects")
                .select("id, name, project_no")
                .in("id", projectIds)
            : Promise.resolve({ data: [], error: null }));
          if (projectsResult.error) throw projectsResult.error;
          projects = projectsResult.data ?? [];
        }
      }

      return {
        orders,
        stock,
        projectSubmissions,
        workSubmissions,
        pendingCompletionSubmissions,
        projectTasks,
        projects,
        allProjects,
        visibleProjectTasks,
        independentTasks,
        myOperationalTasks,
      };
    },
  });

  // Dashboard verisi asenkron yüklendiği için tarayıcının ilk hash kaydırması
  // bazen hedef bölüm ekrana gelmeden çalışıyordu. Veri geldikten sonra hedefe
  // tekrar kaydırarak kartların her cihazda aynı davranmasını sağlıyoruz.
  useEffect(() => {
    if (!query.data || typeof window === "undefined") return;

    const targetId = window.location.hash.replace("#", "");
    if (!["approval-center", "finance", "project-status"].includes(targetId))
      return;

    const timer = window.setTimeout(() => {
      document
        .getElementById(targetId)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);

    return () => window.clearTimeout(timer);
  }, [query.data]);

  if (query.isLoading) return <LoadingState />;
  if (query.error) {
    return (
      <p className="surface-panel p-5 text-destructive">
        {errorMessage(query.error)}
      </p>
    );
  }

  const orders = query.data?.orders ?? [];
  const active = orders.filter(
    (order) => !TERMINAL_ORDER_STATUSES.includes(order.status),
  ).length;
  const completed = orders.filter(
    (order) => order.status === "completed",
  ).length;

  // ── Kişisel panel: taşeron / müşteri ──────────────────────────────────
  if (!operationalManager) {
    const myOperationalTasks = query.data?.myOperationalTasks ?? [];
    const activeMyOperationalTasks = myOperationalTasks.filter(
      (task) => !TERMINAL_TASK_STATUSES.includes(task.status),
    );
    const recentItems: Array<
      | { kind: "order"; date: string | null; order: DashboardWorkOrder }
      | { kind: "task"; date: string | null; task: ContractorTask }
    > = [
      ...orders.map((order) => ({
        kind: "order" as const,
        date: order.scheduled_at,
        order,
      })),
      ...myOperationalTasks.map((task) => ({
        kind: "task" as const,
        date: task.planned_date,
        task,
      })),
    ].sort(
      (a, b) =>
        new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime(),
    );

    const personalMetrics = [
      {
        label: "Aktif İş",
        value: active + activeMyOperationalTasks.length,
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

    return (
      <>
        <PageHeader
          title="Panel"
          description="Size açık işlerin ve projelerin güncel özeti."
        />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {personalMetrics.map((metric) => (
            <a key={metric.label} href={metric.href} className="block h-full">
              <Card className="h-full border-border bg-card">
                <CardContent className="flex h-full flex-col justify-between gap-3 p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-2">
                    <p className={EYEBROW}>{metric.label}</p>
                    <div className="shrink-0 rounded-lg bg-primary/15 p-2 text-highlight">
                      <metric.icon className="h-4 w-4 sm:h-5 sm:w-5" />
                    </div>
                  </div>
                  <p className="text-3xl font-black leading-none sm:text-4xl">
                    {metric.value}
                  </p>
                </CardContent>
              </Card>
            </a>
          ))}
        </div>

        <section className="surface-panel mt-7 p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-bold">Son Görevler</h2>
            <Link
              to={role === "customer" ? "/my-projects" : "/my-jobs"}
              className="text-sm font-semibold text-highlight"
            >
              Tümünü gör
            </Link>
          </div>
          <div className="grid gap-3">
            {recentItems.slice(0, 6).map((item) =>
              item.kind === "order" ? (
                <Link
                  key={`order-${item.order.id}`}
                  to="/jobs/$jobId"
                  params={{ jobId: item.order.id }}
                  className="block rounded-[14px] border border-border bg-card/60 p-4 transition-colors hover:border-primary/60"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">
                          #{item.order.work_order_no}
                        </span>
                        <Badge variant="outline">
                          {statusLabels[item.order.status]}
                        </Badge>
                      </div>
                      <h3 className="mt-2 truncate font-bold">
                        {item.order.title}
                      </h3>
                      {item.order.projects ? (
                        <p className="text-xs font-semibold text-highlight">
                          {item.order.projects.project_no} ·{" "}
                          {item.order.projects.name}
                        </p>
                      ) : null}
                      <p className="text-sm text-muted-foreground">
                        {item.order.customers?.name} ·{" "}
                        {formatDate(item.order.scheduled_at)}
                      </p>
                    </div>
                    <div className="w-full shrink-0 sm:w-56">
                      <div className="mb-1 flex justify-between text-xs">
                        <span>İlerleme</span>
                        <span className="font-bold">
                          %{item.order.progress_pct}
                        </span>
                      </div>
                      <Progress value={item.order.progress_pct} />
                    </div>
                  </div>
                </Link>
              ) : (
                <a
                  key={`task-${item.task.id}`}
                  href={`/my-jobs#operational-${item.task.id}`}
                  className="block rounded-[14px] border border-border bg-card/60 p-4 transition-colors hover:border-primary/60"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">
                          {projectTaskStatusLabel[item.task.status]}
                        </Badge>
                        <Badge variant="secondary">Bağımsız Görev</Badge>
                      </div>
                      <h3 className="mt-2 truncate font-bold">
                        {item.task.title}
                      </h3>
                      {item.task.projects ? (
                        <p className="text-xs font-semibold text-highlight">
                          {item.task.projects.project_no} ·{" "}
                          {item.task.projects.name}
                        </p>
                      ) : null}
                      <p className="text-sm text-muted-foreground">
                        {item.task.planned_date
                          ? formatDate(item.task.planned_date)
                          : "Tarih belirlenmedi"}
                      </p>
                    </div>
                  </div>
                </a>
              ),
            )}
            {recentItems.length === 0 ? (
              <div className="rounded-[14px] border border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
                Henüz görüntülenecek görev yok.
              </div>
            ) : null}
          </div>
        </section>
      </>
    );
  }

  // ── Operasyon paneli: yönetici / teknik ofis ──────────────────────────
  const allProjects = query.data?.allProjects ?? [];
  const visibleProjectTasks = query.data?.visibleProjectTasks ?? [];
  const independentTasks = query.data?.independentTasks ?? [];
  const stock = query.data?.stock ?? [];
  const lowStock = stock.filter((item) => item.quantity <= item.min_quantity);

  const projectNameById = new Map(
    allProjects.map((project) => [
      project.id,
      `${project.project_no} · ${project.name}`,
    ]),
  );
  type ActiveTaskItem = {
    id: string;
    kind: "work_order" | "project" | "independent";
    title: string;
    status: ProjectTaskStatus;
    plannedDate: string | null;
    relation: string;
    href: string;
  };
  const activeTaskItems: ActiveTaskItem[] = [
    ...orders
      .filter((order) => !TERMINAL_ORDER_STATUSES.includes(order.status))
      .map((order) => ({
        id: `work-order-${order.id}`,
        kind: "work_order" as const,
        title: `#${order.work_order_no} · ${order.title}`,
        status: order.status as ProjectTaskStatus,
        plannedDate: order.scheduled_at,
        relation: order.projects
          ? `${order.projects.project_no} · ${order.projects.name}`
          : (order.customers?.name ?? "Bağımsız saha iş emri"),
        href: `/jobs/${order.id}`,
      })),
    ...visibleProjectTasks
      .filter((task) => !TERMINAL_TASK_STATUSES.includes(task.status))
      .map((task) => ({
        id: `project-${task.id}`,
        kind: "project" as const,
        title: task.task_name,
        status: task.status,
        plannedDate: task.planned_date,
        relation: projectNameById.get(task.project_id) ?? "Proje",
        href: `/projects/${task.project_id}#task-${task.id}`,
      })),
    ...independentTasks
      .filter((task) => !TERMINAL_TASK_STATUSES.includes(task.status))
      .map((task) => ({
        id: `independent-${task.id}`,
        kind: "independent" as const,
        title: task.title,
        status: task.status,
        plannedDate: task.planned_date,
        relation: task.project_id
          ? (projectNameById.get(task.project_id) ?? "Proje")
          : "Bağımsız görev",
        href: task.project_id
          ? `/projects/${task.project_id}`
          : `/tasks#operational-${task.id}`,
      })),
  ].sort((a, b) => {
    if (!a.plannedDate && !b.plannedDate) return 0;
    if (!a.plannedDate) return 1;
    if (!b.plannedDate) return -1;
    return a.plannedDate.localeCompare(b.plannedDate);
  });
  const overdueTaskCount = activeTaskItems.filter(
    (item) => taskDueBucket(item.plannedDate, now) === "overdue",
  ).length;

  const pendingProjectSubmissions = query.data?.projectSubmissions ?? [];
  const pendingWorkSubmissions = query.data?.workSubmissions ?? [];
  const pendingCompletionSubmissions =
    query.data?.pendingCompletionSubmissions ?? [];
  const projectTaskById = new Map(
    (query.data?.projectTasks ?? []).map((item) => [item.id, item]),
  );
  const projectById = new Map(
    (query.data?.projects ?? []).map((item) => [item.id, item]),
  );
  const pendingCompletionByWorkOrder = new Map(
    pendingCompletionSubmissions.map((item) => [item.work_order_id, item]),
  );
  const pendingCompletionOrders = orders.filter(
    (order) =>
      order.status === "review_pending" ||
      pendingCompletionByWorkOrder.has(order.id),
  );
  const pendingApprovalCount =
    pendingCompletionOrders.length +
    pendingWorkSubmissions.length +
    pendingProjectSubmissions.length;

  const pendingApprovalItems = [
    ...pendingCompletionOrders.map((order) => {
      const submission = pendingCompletionByWorkOrder.get(order.id);
      return {
        id: `completion-${submission?.id ?? order.id}`,
        href: `/jobs/${order.id}#completion-approval`,
        icon: CheckCircle2,
        label: "İş Bitirme Onayı",
        title: `#${order.work_order_no} · ${order.title}`,
        time: submission?.submitted_at ?? order.completion_submitted_at,
      };
    }),
    ...pendingWorkSubmissions.flatMap((submission) => {
      const order = orders.find((item) => item.id === submission.work_order_id);
      if (!order) return [];
      return [
        {
          id: `progress-${submission.id}`,
          href: `/jobs/${order.id}#progress-approval`,
          icon: Clock3,
          label: `Görev İlerlemesi · %${submission.pct}`,
          title: `#${order.work_order_no} · ${order.title}`,
          time: submission.created_at,
        },
      ];
    }),
    ...pendingProjectSubmissions.flatMap((submission) => {
      const task = projectTaskById.get(submission.project_task_id);
      const project = task ? projectById.get(task.project_id) : undefined;
      if (!task || !project) return [];
      return [
        {
          id: `project-${submission.id}`,
          href: `/projects/${project.id}#task-${task.id}`,
          icon: FolderKanban,
          label: `Proje Görevi · %${submission.proposed_pct}`,
          title: `${project.project_no} · ${task.task_name}`,
          time: submission.submitted_at,
        },
      ];
    }),
  ].sort(
    (a, b) => new Date(b.time ?? 0).getTime() - new Date(a.time ?? 0).getTime(),
  );

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const monthOrders = orders.filter((order) => {
    if (!order.scheduled_at) return false;
    const d = new Date(order.scheduled_at);
    return d >= monthStart && d < monthEnd;
  });
  const completedThisMonth = orders.filter((order) => {
    if (order.status !== "completed") return false;
    const d = new Date(order.completion_submitted_at ?? order.updated_at);
    return d >= monthStart && d < monthEnd;
  }).length;
  const financeTotals = monthOrders.reduce(
    (acc, order) => {
      const f = order.work_order_financials;
      if (f) {
        acc.laborSales += f.customer_labor_amount ?? 0;
        acc.materialSales += f.customer_material_amount ?? 0;
        acc.contractorCost += f.contractor_labor_amount ?? 0;
        acc.materialCost += f.estimated_material_cost ?? 0;
      }
      return acc;
    },
    { laborSales: 0, materialSales: 0, contractorCost: 0, materialCost: 0 },
  );
  const netProfit =
    financeTotals.laborSales +
    financeTotals.materialSales -
    financeTotals.contractorCost -
    financeTotals.materialCost;
  const monthLabel = new Intl.DateTimeFormat("tr-TR", {
    month: "long",
    year: "numeric",
  }).format(now);

  const tasksByProject = new Map<string, VisibleProjectTask[]>();
  for (const task of visibleProjectTasks) {
    const list = tasksByProject.get(task.project_id) ?? [];
    list.push(task);
    tasksByProject.set(task.project_id, list);
  }
  const projectRows = allProjects
    .filter((project) => project.status !== "cancelled")
    .slice(0, 6)
    .map((project) => {
      const tasks = (tasksByProject.get(project.id) ?? []) as Array<{
        approved_progress_pct: number;
        status: ProjectTaskStatus;
      }>;
      return {
        ...project,
        percentage: projectApprovedProgress(tasks).percentage,
      };
    });

  const statCards = [
    {
      label: "Aktif İş Emirleri",
      value: active,
      detail: `${orders.length} toplam iş emri`,
      icon: ListChecks,
      href: "/tasks?source=work_order&filter=open",
    },
    {
      label: "Bekleyen Onaylar",
      value: pendingApprovalCount,
      detail: pendingApprovalCount
        ? "Karar bekleyen kayıt var"
        : "Bekleyen kayıt yok",
      icon: ShieldAlert,
      href: "/approvals",
      attention: pendingApprovalCount > 0 ? ("danger" as const) : undefined,
    },
    {
      label: "Geciken Görevler",
      value: overdueTaskCount,
      detail: overdueTaskCount
        ? "Planlanan tarihi geçen görev var"
        : "Geciken görev yok",
      icon: AlertTriangle,
      href: "/tasks?filter=overdue",
      attention: overdueTaskCount > 0 ? ("danger" as const) : undefined,
    },
    {
      label: "Tamamlanan (Ay)",
      value: completedThisMonth,
      detail: monthLabel,
      icon: CheckCircle2,
      href: "/tasks?source=work_order&filter=completed",
    },
    {
      label: "Kritik Stok",
      value: lowStock.length,
      detail: lowStock.length ? "Minimum seviyenin altında" : "Kritik stok yok",
      icon: Package,
      href: "/stock",
      attention: lowStock.length > 0 ? ("warning" as const) : undefined,
    },
  ];

  const dateLabel = new Intl.DateTimeFormat("tr-TR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);
  const timeLabel = new Intl.DateTimeFormat("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);

  return (
    <>
      <PageHeader
        title="Genel Bakış"
        description={`${dateLabel} · ${timeLabel}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" asChild>
              <Link to="/reports">
                <FileDown className="h-4 w-4" /> Rapor Al
              </Link>
            </Button>
            <Button asChild>
              <Link
                to="/work-orders"
                search={{ create: true, projectId: undefined }}
              >
                <Plus className="h-4 w-4" /> Yeni İş Emri
              </Link>
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {statCards.map((metric) => (
          <a
            key={metric.label}
            href={metric.href}
            className="block h-full transition-transform hover:-translate-y-0.5"
          >
            <Card
              className={`h-full min-h-[132px] ${
                metric.attention === "danger"
                  ? "border-destructive/40 bg-destructive/5"
                  : metric.attention === "warning"
                    ? "border-warning/40 bg-warning/5"
                    : "border-border bg-card"
              }`}
            >
              <CardContent className="flex h-full flex-col justify-between gap-3 p-4 sm:p-5">
                <div className="flex items-start justify-between gap-2">
                  <p className={EYEBROW}>{metric.label}</p>
                  <div
                    className={`shrink-0 rounded-lg p-2 ${
                      metric.attention === "danger"
                        ? "bg-destructive/15 text-destructive"
                        : metric.attention === "warning"
                          ? "bg-warning/15 text-warning"
                          : "bg-primary/15 text-highlight"
                    }`}
                  >
                    <metric.icon className="h-4 w-4 sm:h-5 sm:w-5" />
                  </div>
                </div>
                <div>
                  <p className="text-3xl font-black leading-none sm:text-4xl">
                    {metric.value}
                  </p>
                  <p className="mt-2 line-clamp-2 text-xs leading-snug text-muted-foreground">
                    {metric.detail}
                  </p>
                </div>
              </CardContent>
            </Card>
          </a>
        ))}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <section
          id="project-status"
          className="surface-panel scroll-mt-6 p-4 sm:p-5"
        >
          <div className="mb-4 flex items-center justify-between">
            <p className={EYEBROW}>Proje Durumu</p>
            <Link
              to="/projects"
              className="text-xs font-semibold text-highlight"
            >
              Tümünü gör
            </Link>
          </div>
          <div className="space-y-3">
            {projectRows.map((project) => (
              <Link
                key={project.id}
                to="/projects/$projectId"
                params={{ projectId: project.id }}
                className="block rounded-lg border border-border/60 bg-background/30 p-3 transition-colors hover:border-primary/50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-highlight">
                      <FolderKanban className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-foreground">
                        {project.name}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {project.customers?.name ?? "Müşteri atanmadı"}
                      </p>
                    </div>
                  </div>
                  <Badge
                    variant={projectStatusVariant[project.status]}
                    className="shrink-0"
                  >
                    {projectStatusLabel[project.status]}
                  </Badge>
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <Progress value={project.percentage} className="h-2 flex-1" />
                  <span className="w-10 shrink-0 text-right text-xs font-bold text-foreground">
                    %{project.percentage}
                  </span>
                </div>
              </Link>
            ))}
            {projectRows.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Henüz proje yok.
              </p>
            ) : null}
          </div>
        </section>

        <section id="finance" className="surface-panel scroll-mt-6 p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between">
            <p className={EYEBROW}>Aylık Finans</p>
            <span className="text-xs text-muted-foreground">{monthLabel}</span>
          </div>
          {canFinance ? (
            <div className="space-y-2.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Satış İşçilik</span>
                <span className="font-bold text-foreground">
                  {formatTRY(financeTotals.laborSales)}
                </span>
              </div>
              <div className="my-3 border-t border-border" />
              <p className={EYEBROW}>Proje Bedelleri</p>
              {allProjects
                .filter(
                  (project) =>
                    project.quoted_amount != null ||
                    project.contract_amount != null,
                )
                .slice(0, 5)
                .map((project) => (
                  <Link
                    key={project.id}
                    to="/projects/$projectId"
                    params={{ projectId: project.id }}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/30 p-2 hover:border-primary/50"
                  >
                    <span className="min-w-0 truncate text-xs font-semibold">
                      {project.project_no} · {project.name}
                    </span>
                    <span className="shrink-0 text-xs font-bold">
                      {formatTRY(
                        project.contract_amount ?? project.quoted_amount ?? 0,
                      )}
                    </span>
                  </Link>
                ))}
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Satış Malzeme</span>
                <span className="font-bold text-foreground">
                  {formatTRY(financeTotals.materialSales)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Taşeron Maliyeti</span>
                <span className="font-bold text-destructive">
                  -{formatTRY(financeTotals.contractorCost)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Malzeme Maliyeti</span>
                <span className="font-bold text-destructive">
                  -{formatTRY(financeTotals.materialCost)}
                </span>
              </div>
              <div className="my-1 border-t border-border" />
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-foreground">
                  Net Kar
                </span>
                <span
                  className={`text-lg font-black ${netProfit >= 0 ? "text-success" : "text-destructive"}`}
                >
                  {formatTRY(netProfit)}
                </span>
              </div>
            </div>
          ) : (
            <div className="flex min-h-40 flex-col items-center justify-center gap-2 text-center">
              <Wallet className="h-8 w-8 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                Finansal veriler yalnızca yöneticiye görünür.
              </p>
            </div>
          )}
        </section>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <section
          id="approval-center"
          className="surface-panel scroll-mt-6 p-4 sm:p-5"
        >
          <div className="mb-4 flex items-center justify-between">
            <p className={EYEBROW}>Onay Merkezi</p>
            <Link
              to="/approvals"
              className="text-xs font-semibold text-highlight"
            >
              Tümünü gör
            </Link>
          </div>
          <div className="space-y-2">
            {pendingApprovalItems.slice(0, 3).map((item) => (
              <a
                key={item.id}
                href={item.href}
                className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/30 p-3 transition-colors hover:border-destructive/50"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-destructive/15 text-destructive">
                  <item.icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-foreground">
                    {item.title}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.label}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {item.time ? formatProjectDateTime(item.time) : "—"}
                </span>
              </a>
            ))}
            {pendingApprovalItems.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Onay bekleyen kayıt yok.
              </p>
            ) : null}
          </div>
        </section>

        <section className="surface-panel p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between">
            <p className={EYEBROW}>Kritik Stok</p>
            <Link to="/stock" className="text-xs font-semibold text-highlight">
              Tümünü gör
            </Link>
          </div>
          <div className="space-y-2">
            {lowStock.slice(0, 5).map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/30 p-3"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-warning">
                  <Boxes className="h-4 w-4" />
                </span>
                <p className="min-w-0 flex-1 truncate text-sm font-bold text-foreground">
                  {item.name}
                </p>
                <span className="shrink-0 text-xs font-bold text-warning">
                  {item.quantity} {item.unit}
                </span>
              </div>
            ))}
            {lowStock.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Kritik stok yok.
              </p>
            ) : null}
          </div>
        </section>
      </div>

      <section className="surface-panel mt-4 p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between">
          <p className={EYEBROW}>Aktif Görevler</p>
          <a href="/tasks" className="text-xs font-semibold text-highlight">
            Tümünü gör
          </a>
        </div>
        <div className="space-y-2">
          {activeTaskItems.slice(0, 8).map((item) => {
            const bucket = taskDueBucket(item.plannedDate, now);
            const Icon = item.kind === "project" ? FolderKanban : ListChecks;
            return (
              <a
                key={item.id}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg border border-l-4 border-border/60 bg-background/30 p-3 transition-colors hover:border-primary/50 ${
                  bucket === "overdue"
                    ? "border-l-destructive"
                    : bucket === "today" || bucket === "tomorrow"
                      ? "border-l-warning"
                      : "border-l-transparent"
                }`}
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                    bucket === "overdue"
                      ? "bg-destructive/15 text-destructive"
                      : bucket === "today" || bucket === "tomorrow"
                        ? "bg-warning/15 text-warning"
                        : "bg-primary/15 text-highlight"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-foreground">
                    {item.title}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.relation}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p
                    className={`text-xs font-bold ${
                      bucket === "overdue"
                        ? "text-destructive"
                        : bucket === "today" || bucket === "tomorrow"
                          ? "text-warning"
                          : "text-muted-foreground"
                    }`}
                  >
                    {bucket === "overdue"
                      ? "Gecikti"
                      : bucket === "today"
                        ? "Bugün"
                        : bucket === "tomorrow"
                          ? "Yarın"
                          : item.plannedDate
                            ? formatDate(item.plannedDate)
                            : "Tarih yok"}
                  </p>
                  {(bucket === "overdue" ||
                    bucket === "today" ||
                    bucket === "tomorrow") &&
                  item.plannedDate ? (
                    <p className="text-[10px] text-muted-foreground">
                      {formatDate(item.plannedDate)}
                    </p>
                  ) : null}
                </div>
              </a>
            );
          })}
          {activeTaskItems.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Aktif görev yok.
            </p>
          ) : null}
        </div>
      </section>
    </>
  );
}

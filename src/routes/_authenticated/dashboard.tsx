import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Boxes,
  BriefcaseBusiness,
  CheckCircle2,
  Clock3,
  Package,
  PlusCircle,
  UserCog,
  UsersRound,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/lib/auth-context";
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

function DashboardPage() {
  const { role } = useAuth();
  const query = useQuery({
    queryKey: ["dashboard", role],
    enabled: Boolean(role),
    queryFn: async () => {
      const { data: orders, error: orderError } = await supabase
        .from("work_orders")
        .select(
          "*, customers(name), work_order_financials(customer_amount, contractor_labor_amount, estimated_material_cost, approved_progress_pct)",
        )
        .order("scheduled_at", { ascending: false });
      if (orderError) throw orderError;

      let stock: { quantity: number; min_quantity: number }[] = [];
      let projectSubmissions: ProjectSubmission[] = [];
      let workSubmissions: WorkSubmission[] = [];
      let projectTasks: ProjectTaskSummary[] = [];
      let projects: ProjectSummary[] = [];
      let profileNames: Array<{ id: string; full_name: string }> = [];
      if (role === "admin" || role === "contractor") {
        const { data, error } = await supabase.from("stock_items").select("quantity, min_quantity");
        if (error) throw error;
        stock = data;
      }
      if (role === "admin") {
        const [pendingResult, approvedResult, workPendingResult, workApprovedResult] =
          await Promise.all([
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
        profileNames,
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
  const projectSubmissions = query.data?.projectSubmissions ?? [];
  const workSubmissions = query.data?.workSubmissions ?? [];
  const pendingWorkSubmissions = workSubmissions.filter((item) => item.status === "pending");
  const approvedWorkSubmissions = workSubmissions.filter((item) => item.status === "approved");
  const pendingProjectSubmissions = projectSubmissions.filter((item) => item.status === "pending");
  const approvedProjectSubmissions = projectSubmissions.filter(
    (item) => item.status === "approved",
  );
  const pendingCompletionOrders = orders.filter((order) => order.status === "review_pending");
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
  const pendingTarget = pendingCompletionOrders[0]
    ? `/jobs/${pendingCompletionOrders[0].id}#completion-approval`
    : firstPendingWork
      ? `/jobs/${firstPendingWork.work_order_id}#progress-approval`
      : firstPendingProjectTask
        ? `/projects/${firstPendingProjectTask.project_id}#task-${firstPendingProjectTask.id}`
        : "/work-orders";

  const metrics =
    role === "admin"
      ? [
          {
            label: "Toplam İş Emri",
            value: orders.length,
            icon: BriefcaseBusiness,
            href: "/work-orders",
          },
          { label: "Devam Eden", value: active, icon: Clock3, href: "/work-orders" },
          {
            label: "Onay Bekleyen",
            value:
              pendingCompletionOrders.length +
              pendingWorkSubmissions.length +
              pendingProjectSubmissions.length,
            icon: AlertTriangle,
            href: pendingTarget,
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

  const quickActions = [
    {
      label: "Yeni İş Emri",
      description: "Planla ve taşerona ata",
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
          role === "admin"
            ? "Saha, taşeron, ilerleme ve stok durumunun güncel özeti."
            : "Size açık işlerin ve projelerin güncel özeti."
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => {
          const card = (
            <Card
              className={
                metric.label === "Onay Bekleyen" && metric.value > 0
                  ? "border-red-500/40 bg-red-500/5"
                  : "border-border bg-card"
              }
            >
              <CardContent className="flex items-center gap-4 p-5">
                <div
                  className={
                    metric.label === "Onay Bekleyen" && metric.value > 0
                      ? "rounded-lg bg-red-500/15 p-3 text-red-300 animate-pulse"
                      : "rounded-lg bg-primary/15 p-3 text-primary"
                  }
                >
                  <metric.icon className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{metric.label}</p>
                  <p className="text-3xl font-black">{metric.value}</p>
                </div>
              </CardContent>
            </Card>
          );
          return (
            <a key={metric.label} href={metric.href} className="block">
              {card}
            </a>
          );
        })}
      </div>

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
            <h2 className="text-lg font-bold">İş Emri İlerleme Bildirimleri</h2>
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
                Henüz iş emri ilerleme bildirimi yok.
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

      <section className="mt-7">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">Son İş Emirleri</h2>
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
              Henüz görüntülenecek iş emri yok.
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}

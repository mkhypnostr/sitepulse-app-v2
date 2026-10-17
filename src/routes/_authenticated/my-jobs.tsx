import { useEffect, useState } from "react";
import { createFileRoute, useLocation } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { errorMessage } from "@/lib/domain";
import { formatDate } from "@/lib/format";
import { projectTaskStatusLabel } from "@/lib/projects";
import {
  AccessDenied,
  EmptyState,
  LoadingState,
  PageHeader,
} from "@/components/page-states";
import { Badge } from "@/components/ui/badge";
import { JobList } from "@/components/job-list";
import { MyProjectTaskList } from "@/components/my-project-task-list";
import { useMyProjectTasks } from "@/lib/my-project-tasks";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/my-jobs")({
  component: MyJobsPage,
});

type IndependentTask = {
  id: string;
  title: string;
  status:
    | "not_started"
    | "in_progress"
    | "external_approval"
    | "revision_required"
    | "blocked"
    | "completed"
    | "not_applicable";
  planned_date: string | null;
  projects: { name: string; project_no: string } | null;
};

const OPEN_STATUSES = new Set([
  "not_started",
  "in_progress",
  "external_approval",
  "revision_required",
  "blocked",
]);

// Taşeron: saha görevleri (iş emirleri + bağımsız görevler) ve proje
// görevleri tek ekranda, iki sekme. Müşteri: kendisine açık işlerin listesi.
function MyJobsPage() {
  const { role, user } = useAuth();
  const location = useLocation();
  const isContractor = role === "contractor";
  const isCustomer = role === "customer";

  const query = useQuery({
    queryKey: ["my-jobs"],
    enabled: isContractor || isCustomer,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_orders")
        .select("*, customers(name), projects(name, project_no)")
        .order("scheduled_at");
      if (error) throw error;
      return data;
    },
  });

  const independentTasksQuery = useQuery({
    queryKey: ["my-independent-tasks", user?.id],
    enabled: isContractor && Boolean(user?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("operational_tasks")
        .select("id, title, status, planned_date, projects(name, project_no)")
        .eq("assigned_to", user!.id)
        .order("planned_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as unknown as IndependentTask[];
    },
  });

  const projectTasksQuery = useMyProjectTasks(user?.id, isContractor);

  const [tab, setTab] = useState<"saha" | "proje">("saha");
  // Eski "Proje Görevlerim" adresinden (#proje) gelinirse proje sekmesi açılır.
  useEffect(() => {
    if (location.hash === "proje") setTab("proje");
  }, [location.hash]);

  if (!isContractor && !isCustomer) return <AccessDenied />;
  if (query.isLoading || (isContractor && independentTasksQuery.isLoading))
    return <LoadingState />;
  if (query.error)
    return <p className="text-destructive">{errorMessage(query.error)}</p>;

  if (isCustomer) {
    return (
      <>
        <PageHeader
          title="İşlerim"
          description="Size açık iş emirleri ve durumları."
        />
        <JobList orders={query.data ?? []} emptyLabel="Görünür iş yok" />
      </>
    );
  }

  const orders = query.data ?? [];
  const independentTasks = independentTasksQuery.data ?? [];
  const projectTasks = projectTasksQuery.data ?? [];
  const openField =
    orders.filter((order) => order.status !== "completed").length +
    independentTasks.filter((task) => OPEN_STATUSES.has(task.status)).length;
  const openProject = projectTasks.filter((task) =>
    OPEN_STATUSES.has(task.status),
  ).length;

  return (
    <>
      <PageHeader
        title="Görevlerim"
        description="Size atanan saha ve proje görevleri. İlerleme, fotoğraf ve malzeme girişlerini görev üzerinden yapın; onay yönetici tarafından verilir."
      />
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as "saha" | "proje")}
      >
        <TabsList className="mb-4 w-full sm:w-auto">
          <TabsTrigger value="saha" className="flex-1 sm:flex-none">
            Saha görevleri
            <CountPill count={openField} />
          </TabsTrigger>
          <TabsTrigger value="proje" className="flex-1 sm:flex-none">
            Proje görevleri
            <CountPill count={openProject} />
          </TabsTrigger>
        </TabsList>

        <TabsContent value="saha">
          <JobList orders={orders} emptyLabel="Size atanmış saha görevi yok" />

          {independentTasks.length > 0 ? (
            <section className="surface-panel mt-6 p-4 sm:p-5">
              <div className="mb-3">
                <h2 className="text-lg font-bold">Bağımsız görevler</h2>
                <p className="text-sm text-muted-foreground">
                  İş emri olmadan doğrudan size atanmış operasyon görevleri.
                </p>
              </div>
              <div className="grid gap-3">
                {independentTasks.map((task) => (
                  <div
                    key={task.id}
                    id={`operational-${task.id}`}
                    className="scroll-mt-6 rounded-[14px] border border-border bg-card/60 p-4"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <Badge variant="outline">
                          {projectTaskStatusLabel[task.status]}
                        </Badge>
                        <h3 className="mt-2 truncate font-bold">
                          {task.title}
                        </h3>
                        <p className="text-xs font-semibold text-highlight">
                          {task.projects
                            ? `${task.projects.project_no} · ${task.projects.name}`
                            : "Bağımsız görev"}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm text-muted-foreground">
                        {task.planned_date
                          ? formatDate(task.planned_date)
                          : "Tarih belirlenmedi"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </TabsContent>

        <TabsContent value="proje">
          {projectTasks.length === 0 && !projectTasksQuery.isLoading ? (
            <EmptyState
              title="Atanmış proje görevi yok"
              description="Yönetici bir proje görevi size atadığında burada görünecek."
            />
          ) : (
            <MyProjectTaskList query={projectTasksQuery} />
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}

function CountPill({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground tabular-nums">
      {count}
    </span>
  );
}

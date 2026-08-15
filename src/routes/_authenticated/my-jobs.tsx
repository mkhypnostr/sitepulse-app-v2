import { createFileRoute } from "@tanstack/react-router";
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

function MyJobsPage() {
  const { role, user } = useAuth();
  const query = useQuery({
    queryKey: ["my-jobs"],
    enabled: role === "contractor",
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
    enabled: role === "contractor" && Boolean(user?.id),
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

  if (role !== "contractor") return <AccessDenied />;
  if (query.isLoading || independentTasksQuery.isLoading)
    return <LoadingState />;
  if (query.error)
    return <p className="text-destructive">{errorMessage(query.error)}</p>;
  if (independentTasksQuery.error) {
    return (
      <p className="text-destructive">
        {errorMessage(independentTasksQuery.error)}
      </p>
    );
  }

  const independentTasks = independentTasksQuery.data ?? [];

  return (
    <>
      <PageHeader
        title="Bana Atanan Görevler"
        description="İlerleme, fotoğraf ve kullanılan malzeme girişlerini görev detayı üzerinden yapın."
      />
      <JobList
        orders={query.data ?? []}
        emptyLabel="Size atanmış görev bulunmuyor"
      />

      <section className="surface-panel mt-6 p-4 sm:p-5">
        <div className="mb-3">
          <h2 className="text-lg font-bold">Bağımsız Görevler</h2>
          <p className="text-sm text-muted-foreground">
            Saha görevi olmayan, doğrudan size atanmış operasyon görevleri.
          </p>
        </div>
        {independentTasks.length === 0 ? (
          <EmptyState
            title="Bağımsız görev yok"
            description="Size atanmış bağımsız operasyon görevi bulunmuyor."
          />
        ) : (
          <div className="grid gap-3">
            {independentTasks.map((task) => (
              <div
                key={task.id}
                id={`operational-${task.id}`}
                className="scroll-mt-6 rounded-[14px] border border-border bg-card/60 p-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">
                        {projectTaskStatusLabel[task.status]}
                      </Badge>
                    </div>
                    <h3 className="mt-2 truncate font-bold">{task.title}</h3>
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
        )}
      </section>
    </>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ClipboardCheck, FileText, ImagePlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { errorMessage } from "@/lib/domain";
import { ProjectTaskEvidence } from "@/components/project-task-evidence";
import { ProjectTaskProgress } from "@/components/project-task-progress";
import { AccessDenied, EmptyState, LoadingState, PageHeader } from "@/components/page-states";
import { Badge } from "@/components/ui/badge";
import { projectTaskStatusLabel, taskStatusClass } from "@/lib/projects";

export const Route = createFileRoute("/_authenticated/my-project-tasks")({
  component: MyProjectTasksPage,
});

function MyProjectTasksPage() {
  const { role, user } = useAuth();
  const tasksQuery = useQuery({
    queryKey: ["my-project-tasks", user?.id],
    enabled: role === "contractor" && Boolean(user?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_tasks")
        .select("*")
        .eq("responsible_id", user!.id)
        .order("planned_date", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  if (role !== "contractor") return <AccessDenied />;
  if (tasksQuery.isLoading) return <LoadingState label="Proje görevleriniz yükleniyor..." />;
  if (tasksQuery.error) return <p className="text-destructive">{errorMessage(tasksQuery.error)}</p>;

  const tasks = tasksQuery.data ?? [];
  return (
    <>
      <PageHeader
        title="Proje Görevlerim"
        description="Size atanan proje görevleri ve bu görevlerin kanıt dosyaları. İlerleme onayı teknik ofis tarafından yapılır."
      />
      {tasks.length === 0 ? (
        <EmptyState
          title="Atanmış proje görevi yok"
          description="Yönetici bir proje görevi size atadığında burada görünecek."
        />
      ) : (
        <div className="space-y-4">
          {tasks.map((task) => (
            <article key={task.id} className="surface-panel p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={taskStatusClass[task.status]}>
                      {projectTaskStatusLabel[task.status]}
                    </Badge>
                    <span className="text-xs font-bold text-primary">{task.phase_name}</span>
                  </div>
                  <h2 className="mt-2 text-lg font-black">{task.task_name}</h2>
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  {task.planned_date ? <Badge variant="outline"><CalendarDays className="mr-1 h-3.5 w-3.5" /> Plan: {task.planned_date}</Badge> : null}
                  {task.requires_photo ? <Badge variant="outline"><ImagePlus className="mr-1 h-3.5 w-3.5" /> Fotoğraf gerekli</Badge> : null}
                  {task.requires_document ? <Badge variant="outline"><FileText className="mr-1 h-3.5 w-3.5" /> Belge gerekli</Badge> : null}
                </div>
              </div>
              {task.note ? <p className="mt-3 rounded-lg bg-muted/30 p-3 text-sm text-muted-foreground">{task.note}</p> : null}
              <ProjectTaskEvidence
                taskId={task.id}
                projectId={task.project_id}
                requiresPhoto={task.requires_photo}
                requiresDocument={task.requires_document}
                canUpload
              />
              <ProjectTaskProgress task={task} canSubmit canReview={false} />
              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <ClipboardCheck className="h-4 w-4 text-primary" /> Kanıtı ve açıklamayı gönderin; ilerleme yalnızca yönetici onayından sonra projeye yansır.
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

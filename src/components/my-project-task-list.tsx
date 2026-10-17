import {
  CalendarDays,
  ClipboardCheck,
  FileText,
  ImagePlus,
} from "lucide-react";
import type { useMyProjectTasks } from "@/lib/my-project-tasks";
import { errorMessage } from "@/lib/domain";
import { ProjectTaskEvidence } from "@/components/project-task-evidence";
import { ProjectTaskProgress } from "@/components/project-task-progress";
import { EmptyState, LoadingState } from "@/components/page-states";
import { Badge } from "@/components/ui/badge";
import { projectTaskStatusLabel, taskStatusClass } from "@/lib/projects";

/** Taşeronun proje görevleri: kanıt yükleme ve ilerleme bildirimi. */
export function MyProjectTaskList({
  query,
}: {
  query: ReturnType<typeof useMyProjectTasks>;
}) {
  if (query.isLoading)
    return <LoadingState label="Proje görevleriniz yükleniyor..." />;
  if (query.error)
    return <p className="text-destructive">{errorMessage(query.error)}</p>;
  const tasks = query.data ?? [];
  return (
    <>
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
                    <Badge
                      variant="outline"
                      className={taskStatusClass[task.status]}
                    >
                      {projectTaskStatusLabel[task.status]}
                    </Badge>
                    <span className="text-xs font-bold text-highlight">
                      {task.phase_name}
                    </span>
                  </div>
                  <h2 className="mt-2 text-lg font-black">{task.task_name}</h2>
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  {task.planned_date ? (
                    <Badge variant="outline">
                      <CalendarDays className="mr-1 h-3.5 w-3.5" /> Plan:{" "}
                      {task.planned_date}
                    </Badge>
                  ) : null}
                  {task.requires_photo ? (
                    <Badge variant="outline">
                      <ImagePlus className="mr-1 h-3.5 w-3.5" /> Fotoğraf
                      gerekli
                    </Badge>
                  ) : null}
                  {task.requires_document ? (
                    <Badge variant="outline">
                      <FileText className="mr-1 h-3.5 w-3.5" /> Belge gerekli
                    </Badge>
                  ) : null}
                </div>
              </div>
              {task.note ? (
                <p className="mt-3 rounded-lg bg-muted/30 p-3 text-sm text-muted-foreground">
                  {task.note}
                </p>
              ) : null}
              <ProjectTaskEvidence
                taskId={task.id}
                projectId={task.project_id}
                requiresPhoto={task.requires_photo}
                requiresDocument={task.requires_document}
                canUpload
              />
              <ProjectTaskProgress task={task} canSubmit canReview={false} />
              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <ClipboardCheck className="h-4 w-4 text-highlight" /> Kanıtı ve
                açıklamayı gönderin; ilerleme yalnızca yönetici onayından sonra
                projeye yansır.
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

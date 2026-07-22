import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  Camera,
  FileText,
  MapPin,
  Save,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { errorMessage } from "@/lib/domain";
import {
  formatProjectDate,
  projectProgress,
  projectStatusLabel,
  projectTaskStatusLabel,
  projectTaskStatusOptions,
  projectTypeLabel,
  taskStatusClass,
  type ProjectTaskStatus,
} from "@/lib/projects";
import { AccessDenied, LoadingState, PageHeader } from "@/components/page-states";
import { MapPreview } from "@/components/map-preview";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/projects/$projectId")({
  component: ProjectDetailPage,
});

type ProjectTask = Database["public"]["Tables"]["project_tasks"]["Row"];
type Manager = Pick<Database["public"]["Tables"]["profiles"]["Row"], "id" | "full_name">;

function ProjectDetailPage() {
  const { role } = useAuth();
  const { projectId } = Route.useParams();

  const projectQuery = useQuery({
    queryKey: ["project-detail", projectId],
    enabled: role === "admin",
    queryFn: async () => {
      const projectResult = await supabase
        .from("projects")
        .select("*")
        .eq("id", projectId)
        .maybeSingle();
      if (projectResult.error) throw projectResult.error;
      if (!projectResult.data) throw new Error("Proje bulunamadı");

      const project = projectResult.data;
      const [customerResult, processesResult, tasksResult, rolesResult] = await Promise.all([
        supabase.from("customers").select("id, name").eq("id", project.customer_id).maybeSingle(),
        supabase
          .from("project_processes")
          .select("*")
          .eq("project_id", projectId)
          .order("position"),
        supabase
          .from("project_tasks")
          .select("*")
          .eq("project_id", projectId)
          .order("phase_order")
          .order("task_order"),
        supabase.from("user_roles").select("user_id").eq("role", "admin"),
      ]);
      if (customerResult.error) throw customerResult.error;
      if (processesResult.error) throw processesResult.error;
      if (tasksResult.error) throw tasksResult.error;
      if (rolesResult.error) throw rolesResult.error;

      const managerIds = rolesResult.data.map((item) => item.user_id);
      const managersResult = managerIds.length
        ? await supabase
            .from("profiles")
            .select("id, full_name")
            .in("id", managerIds)
            .order("full_name")
        : { data: [], error: null };
      if (managersResult.error) throw managersResult.error;

      return {
        project,
        customer: customerResult.data,
        processes: processesResult.data,
        tasks: tasksResult.data,
        managers: managersResult.data ?? [],
      };
    },
  });

  if (role !== "admin") return <AccessDenied />;
  if (projectQuery.isLoading) return <LoadingState label="Proje ayrıntıları yükleniyor..." />;
  if (projectQuery.error || !projectQuery.data) {
    return (
      <div className="surface-panel p-8 text-center">
        <p className="font-bold text-destructive">{errorMessage(projectQuery.error)}</p>
        <Button asChild variant="outline" className="mt-5">
          <Link to="/projects">Projelere Dön</Link>
        </Button>
      </div>
    );
  }

  const { project, customer, processes, tasks, managers } = projectQuery.data;
  const processProgresses = processes.map((process) => ({
    ...process,
    progress: projectProgress(
      tasks.filter((task) => task.process_id === process.id).map((task) => task.status),
    ),
  }));
  const managerById = new Map(managers.map((manager) => [manager.id, manager.full_name]));
  const location = [project.province, project.district, project.neighborhood]
    .filter(Boolean)
    .join(" / ");

  return (
    <>
      <div className="mb-4">
        <Button asChild variant="ghost" className="-ml-3 text-muted-foreground">
          <Link to="/projects">
            <ArrowLeft className="mr-2 h-4 w-4" /> Projelere Dön
          </Link>
        </Button>
      </div>

      <PageHeader
        title={project.name}
        description={`${project.project_no} · ${customer?.name || "Müşteri"}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="px-3 py-1.5">
              {projectStatusLabel[project.status]}
            </Badge>
            {project.show_to_customer ? (
              <Badge className="px-3 py-1.5">Müşteriye Açık</Badge>
            ) : (
              <Badge variant="secondary" className="px-3 py-1.5">
                Yalnızca Yönetici
              </Badge>
            )}
          </div>
        }
      />

      <section className="mb-6 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="surface-panel p-5">
          <h2 className="mb-4 font-black">Proje Kartı</h2>
          <div className="grid gap-4 text-sm sm:grid-cols-2">
            <InfoItem icon={Building2} label="Müşteri" value={customer?.name || "—"} />
            <InfoItem
              icon={UserRound}
              label="NES Sorumlusu"
              value={managerById.get(project.manager_id ?? "") || "Atanmadı"}
            />
            <InfoItem icon={MapPin} label="Konum" value={location || "Konum girilmedi"} />
            <InfoItem
              icon={CalendarDays}
              label="Tarih"
              value={`${formatProjectDate(project.start_date)} → ${formatProjectDate(project.target_end_date)}`}
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {processes.map((process) => (
              <Badge key={process.id} variant="secondary">
                {projectTypeLabel[process.process_type]}
              </Badge>
            ))}
          </div>

          {project.description ? (
            <div className="mt-5 rounded-xl border border-border bg-muted/20 p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Proje Açıklaması
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm">{project.description}</p>
            </div>
          ) : null}

          {project.location_url ? (
            <MapPreview
              mapUrl={project.location_url}
              fallbackQuery={[project.neighborhood, project.district, project.province]
                .filter(Boolean)
                .join(", ")}
              className="mt-5"
            />
          ) : null}

          <div className="mt-5 flex flex-wrap gap-3">
            {project.external_reference_no ? (
              <Badge variant="outline" className="px-3 py-2">
                Dış Referans: {project.external_reference_no}
              </Badge>
            ) : null}
            {project.block_no || project.parcel_no ? (
              <Badge variant="outline" className="px-3 py-2">
                Ada {project.block_no || "—"} · Parsel {project.parcel_no || "—"}
              </Badge>
            ) : null}
            {project.area ? (
              <Badge variant="outline" className="px-3 py-2">
                {project.area.toLocaleString("tr-TR")} m²
              </Badge>
            ) : null}
          </div>
        </div>

        <div className="surface-panel p-5">
          <h2 className="font-black">Süreç İlerlemesi</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Her proje türü kendi görevleri üzerinden ayrı hesaplanır.
          </p>
          <div className="mt-5 space-y-4">
            {processProgresses.map((process) => (
              <div key={process.id} className="rounded-xl border border-border bg-muted/20 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-black">{projectTypeLabel[process.process_type]}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {process.progress.completed}/{process.progress.total} görev tamamlandı
                    </p>
                  </div>
                  <span className="text-xl font-black text-primary">
                    %{process.progress.percentage}
                  </span>
                </div>
                <Progress value={process.progress.percentage} className="mt-3 h-2.5" />
              </div>
            ))}
          </div>
          {project.admin_notes ? (
            <div className="mt-5 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4">
              <p className="text-xs font-black uppercase tracking-wider text-amber-300">
                Yönetici Notu
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm text-amber-100/90">
                {project.admin_notes}
              </p>
            </div>
          ) : null}
        </div>
      </section>

      <section>
        <div className="mb-4">
          <h2 className="text-xl font-black">Süreç ve Görev Takibi</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Her görevin durumunu, sorumlusunu, plan tarihini ve notunu ayrı ayrı kaydedin.
          </p>
        </div>

        <Accordion
          type="multiple"
          defaultValue={processes.map((process) => process.id)}
          className="space-y-4"
        >
          {processes.map((process) => {
            const processTasks = tasks.filter((task) => task.process_id === process.id);
            const processProgress = projectProgress(processTasks.map((task) => task.status));
            const phases = groupTasksByPhase(processTasks);
            return (
              <AccordionItem
                key={process.id}
                value={process.id}
                className="surface-panel border px-5"
              >
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex flex-1 flex-col gap-2 pr-4 text-left sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-base font-black">
                        {projectTypeLabel[process.process_type]}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {processProgress.completed}/{processProgress.total} görev tamamlandı
                      </p>
                    </div>
                    <div className="flex items-center gap-3 sm:w-52">
                      <Progress value={processProgress.percentage} className="h-2 flex-1" />
                      <span className="w-10 text-right text-xs font-bold">
                        %{processProgress.percentage}
                      </span>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="space-y-6">
                  {phases.map((phase) => (
                    <div key={`${process.id}-${phase.order}`}>
                      <div className="mb-3 flex items-center gap-3">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-black text-primary-foreground">
                          {phase.order}
                        </span>
                        <h3 className="font-black">{phase.name}</h3>
                      </div>
                      <div className="space-y-3">
                        {phase.tasks.map((task) => (
                          <TaskEditor key={task.id} task={task} managers={managers} />
                        ))}
                      </div>
                    </div>
                  ))}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </section>
    </>
  );
}

function InfoItem({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Building2;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-0.5 break-words font-bold">{value}</p>
      </div>
    </div>
  );
}

function groupTasksByPhase(tasks: ProjectTask[]) {
  const phases = new Map<number, { name: string; order: number; tasks: ProjectTask[] }>();
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
    .map((phase) => ({
      ...phase,
      tasks: phase.tasks.sort((a, b) => a.task_order - b.task_order),
    }));
}

function TaskEditor({ task, managers }: { task: ProjectTask; managers: Manager[] }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ProjectTaskStatus>(task.status);
  const [responsibleId, setResponsibleId] = useState(task.responsible_id ?? "none");
  const [plannedDate, setPlannedDate] = useState(task.planned_date ?? "");
  const [externalSystem, setExternalSystem] = useState(task.external_system ?? "");
  const [note, setNote] = useState(task.note ?? "");

  useEffect(() => {
    setStatus(task.status);
    setResponsibleId(task.responsible_id ?? "none");
    setPlannedDate(task.planned_date ?? "");
    setExternalSystem(task.external_system ?? "");
    setNote(task.note ?? "");
  }, [task]);

  const changed = useMemo(
    () =>
      status !== task.status ||
      responsibleId !== (task.responsible_id ?? "none") ||
      plannedDate !== (task.planned_date ?? "") ||
      externalSystem !== (task.external_system ?? "") ||
      note !== (task.note ?? ""),
    [status, responsibleId, plannedDate, externalSystem, note, task],
  );

  const updateTask = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("update_project_task", {
        target_task_id: task.id,
        new_status: status,
        assigned_user_id: responsibleId === "none" ? undefined : responsibleId,
        planned_on: plannedDate || undefined,
        task_system: externalSystem.trim() || undefined,
        task_note: note.trim() || undefined,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["project-detail", task.project_id] });
      await queryClient.invalidateQueries({ queryKey: ["projects-page"] });
      toast.success("Görev güncellendi");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div className="rounded-xl border border-border bg-background/35 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-black text-primary">{task.task_order}</span>
            <h4 className="font-bold">{task.task_name}</h4>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge variant="outline" className={taskStatusClass[task.status]}>
              {projectTaskStatusLabel[task.status]}
            </Badge>
            {task.requires_photo ? (
              <Badge variant="outline" className="gap-1">
                <Camera className="h-3 w-3" /> Fotoğraf
              </Badge>
            ) : null}
            {task.requires_document ? (
              <Badge variant="outline" className="gap-1">
                <FileText className="h-3 w-3" /> Belge
              </Badge>
            ) : null}
            {task.completed_at ? (
              <Badge variant="outline">{formatProjectDate(task.completed_at)} tamamlandı</Badge>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="grid gap-1 text-xs font-bold">
          Durum
          <Select value={status} onValueChange={(value: ProjectTaskStatus) => setStatus(value)}>
            <SelectTrigger className="h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {projectTaskStatusOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="grid gap-1 text-xs font-bold">
          Sorumlu
          <Select value={responsibleId} onValueChange={setResponsibleId}>
            <SelectTrigger className="h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Atanmadı</SelectItem>
              {managers.map((manager) => (
                <SelectItem key={manager.id} value={manager.id}>
                  {manager.full_name || "İsimsiz yönetici"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="grid gap-1 text-xs font-bold">
          Planlanan Tarih
          <Input
            type="date"
            value={plannedDate}
            onChange={(event) => setPlannedDate(event.target.value)}
            className="h-10"
          />
        </label>
        <label className="grid gap-1 text-xs font-bold">
          Dış Sistem / Kurum
          <Input
            value={externalSystem}
            onChange={(event) => setExternalSystem(event.target.value)}
            placeholder="YBS, EMO, Belediye..."
            className="h-10"
          />
        </label>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="grid gap-1 text-xs font-bold">
          Görev Notu
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Son durum, beklenen belge veya açıklama"
            className="min-h-20"
          />
        </label>
        <Button
          onClick={() => updateTask.mutate()}
          disabled={!changed || updateTask.isPending}
          className="h-11 sm:min-w-32"
        >
          <Save className="mr-2 h-4 w-4" />
          {updateTask.isPending ? "Kaydediliyor" : "Kaydet"}
        </Button>
      </div>
    </div>
  );
}

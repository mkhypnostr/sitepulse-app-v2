import { useEffect, useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, FolderKanban, Pencil, Plus, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { errorMessage, roleLabels } from "@/lib/domain";
import { formatDate } from "@/lib/format";
import { isOperationalManager } from "@/lib/permissions";
import { AccessDenied, EmptyState, LoadingState, PageHeader } from "@/components/page-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

export const Route = createFileRoute("/_authenticated/tasks")({
  validateSearch: (search: Record<string, unknown>) => ({
    filter: search.filter === "open" ? "open" : undefined,
  }),
  component: TasksPage,
});

type Assignee = { id: string; full_name: string | null; role: "admin" | "technical_office" | "contractor" | "customer" };
type IndependentTask = {
  id: string;
  title: string;
  description: string | null;
  project_id: string | null;
  customer_id: string | null;
  assigned_to: string | null;
  status: string;
  planned_date: string | null;
};
type ProjectTask = {
  id: string;
  project_id: string;
  task_name: string;
  phase_name: string;
  responsible_id: string | null;
  status: string;
  planned_date: string | null;
  approved_progress_pct: number;
};
type AssignedWorkOrder = {
  id: string;
  work_order_no: number | null;
  title: string;
  project_id: string | null;
  customer_id: string | null;
  status: string;
  scheduled_at: string | null;
  progress_pct: number;
};
type WorkOrderAssignment = { work_order_id: string; contractor_id: string };

const statusLabel: Record<string, string> = {
  not_started: "Planlandı",
  in_progress: "Devam ediyor",
  completed: "Tamamlandı",
  not_applicable: "Uygulanmaz",
};

function TasksPage() {
  const { role } = useAuth();
  const { filter } = Route.useSearch();
  const canViewTasks = isOperationalManager(role);
  const canCreateTasks = isOperationalManager(role);
  const canAssignTasks = role === "admin";
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", projectId: "none", customerId: "none", assigneeId: "none", plannedDate: "" });
  const [editingTask, setEditingTask] = useState<IndependentTask | null>(null);

  const tasksQuery = useQuery({
    queryKey: ["unified-tasks"],
    enabled: canViewTasks,
    queryFn: async () => {
      const [independentResult, projectTasksResult, workOrdersResult, assignmentsResult, projectsResult, customersResult, assigneesResult] = await Promise.all([
        supabase.from("operational_tasks" as never).select("id, title, description, project_id, customer_id, assigned_to, status, planned_date").order("planned_date", { ascending: true, nullsFirst: false }),
        supabase.from("project_tasks").select("id, project_id, task_name, phase_name, responsible_id, status, planned_date, approved_progress_pct").order("planned_date", { ascending: true, nullsFirst: false }),
        supabase.from("work_orders").select("id, work_order_no, title, project_id, customer_id, status, scheduled_at, progress_pct").order("scheduled_at", { ascending: true, nullsFirst: false }),
        supabase.from("work_order_assignments").select("work_order_id, contractor_id"),
        supabase.from("projects").select("id, name, project_no").order("created_at", { ascending: false }),
        supabase.from("customers").select("id, name").order("name"),
        supabase.rpc("list_task_assignees"),
      ]);
        if (independentResult.error) throw independentResult.error;
        if (projectTasksResult.error) throw projectTasksResult.error;
        if (workOrdersResult.error) throw workOrdersResult.error;
        if (assignmentsResult.error) throw assignmentsResult.error;
      if (projectsResult.error) throw projectsResult.error;
      if (customersResult.error) throw customersResult.error;
      if (assigneesResult.error) throw assigneesResult.error;
      return {
        independent: (independentResult.data ?? []) as unknown as IndependentTask[],
        projectTasks: (projectTasksResult.data ?? []) as ProjectTask[],
        workOrders: (workOrdersResult.data ?? []) as AssignedWorkOrder[],
        assignments: (assignmentsResult.data ?? []) as WorkOrderAssignment[],
        projects: projectsResult.data ?? [],
        customers: customersResult.data ?? [],
        assignees: (assigneesResult.data ?? []) as Assignee[],
      };
    },
  });

  useEffect(() => {
    if (!tasksQuery.data || typeof window === "undefined") return;
    const targetId = window.location.hash.replace("#", "");
    if (!targetId) return;
    const timer = window.setTimeout(() => {
      document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [tasksQuery.data]);

  const createTask = useMutation({
    mutationFn: async () => {
      if (form.title.trim().length < 3) throw new Error("Görev adı en az 3 karakter olmalıdır.");
      const { error } = await supabase.rpc("create_operational_task", {
        task_title: form.title.trim(),
        task_description: form.description.trim() || undefined,
        target_project_id: form.projectId === "none" ? undefined : form.projectId,
        target_customer_id: form.customerId === "none" ? undefined : form.customerId,
        assigned_user_id: canAssignTasks && form.assigneeId !== "none" ? form.assigneeId : undefined,
        planned_on: form.plannedDate || undefined,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["unified-tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
      setForm({ title: "", description: "", projectId: "none", customerId: "none", assigneeId: "none", plannedDate: "" });
      setOpen(false);
      toast.success("Bağımsız görev oluşturuldu");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const updateTask = useMutation({
    mutationFn: async () => {
      if (!editingTask) throw new Error("Düzenlenecek görev bulunamadı.");
      if (form.title.trim().length < 3) throw new Error("Görev adı en az 3 karakter olmalıdır.");
      const { error } = canAssignTasks
        ? await supabase.rpc("update_operational_task", {
            target_task_id: editingTask.id,
            task_title: form.title.trim(),
            task_description: form.description.trim() || undefined,
            target_project_id: form.projectId === "none" ? undefined : form.projectId,
            target_customer_id: form.customerId === "none" ? undefined : form.customerId,
            assigned_user_id: form.assigneeId === "none" ? undefined : form.assigneeId,
            planned_on: form.plannedDate || undefined,
          })
        : await supabase.rpc("update_operational_task_technical" as never, {
            target_task_id: editingTask.id,
            task_title: form.title.trim(),
            task_description: form.description.trim() || undefined,
            target_project_id: form.projectId === "none" ? undefined : form.projectId,
            target_customer_id: form.customerId === "none" ? undefined : form.customerId,
            planned_on: form.plannedDate || undefined,
            new_status: editingTask.status,
          } as never);
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["unified-tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
      setEditingTask(null);
      setOpen(false);
      toast.success("Görev güncellendi");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const deleteTask = useMutation({
    mutationFn: async (taskId: string) => {
      const { error } = await supabase.rpc("delete_operational_task", { target_task_id: taskId });
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["unified-tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
      toast.success("Bağımsız görev silindi");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (!canViewTasks) return <AccessDenied />;
  if (tasksQuery.isLoading) return <LoadingState label="Görevler yükleniyor..." />;
  if (tasksQuery.error) return <p className="surface-panel p-5 text-destructive">{errorMessage(tasksQuery.error)}</p>;

  const data = tasksQuery.data ?? { independent: [], projectTasks: [], workOrders: [], assignments: [], projects: [], customers: [], assignees: [] };
  const projectById = new Map(data.projects.map((project) => [project.id, project]));
  const customerById = new Map(data.customers.map((customer) => [customer.id, customer.name]));
  const assigneeById = new Map(data.assignees.map((assignee) => [assignee.id, assignee]));
  const createButton = canCreateTasks ? (
    <Dialog open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); if (!nextOpen) setEditingTask(null); }}>
      <DialogTrigger asChild><Button className="h-12 font-bold" onClick={() => setEditingTask(null)}><Plus className="mr-2 h-4 w-4" /> Yeni Bağımsız Görev</Button></DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editingTask ? "Bağımsız görevi düzenle" : "Bağımsız görev oluştur"}</DialogTitle>
          <DialogDescription>Müşteri ve proje isteğe bağlıdır. Finansal bilgi bu görev kaydında yer almaz. {!canAssignTasks ? "Sorumlu ataması yönetici tarafından yapılır." : ""}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <label className="grid gap-1.5 text-sm font-medium">Görev Başlığı<Input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} maxLength={180} /></label>
          <label className="grid gap-1.5 text-sm font-medium">Açıklama<Textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} maxLength={2000} /></label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium">Bağlı Proje (isteğe bağlı)<Select value={form.projectId} onValueChange={(projectId) => setForm({ ...form, projectId })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Bağımsız görev</SelectItem>{data.projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.project_no} · {project.name}</SelectItem>)}</SelectContent></Select></label>
            <label className="grid gap-1.5 text-sm font-medium">Müşteri (isteğe bağlı)<Select value={form.customerId} onValueChange={(customerId) => setForm({ ...form, customerId })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Müşteri seçilmedi</SelectItem>{data.customers.map((customer) => <SelectItem key={customer.id} value={customer.id}>{customer.name}</SelectItem>)}</SelectContent></Select></label>
          </div>
          <div className={canAssignTasks ? "grid gap-4 sm:grid-cols-2" : "grid gap-4"}>
            {canAssignTasks ? <label className="grid gap-1.5 text-sm font-medium">Sorumlu (isteğe bağlı)<Select value={form.assigneeId} onValueChange={(assigneeId) => setForm({ ...form, assigneeId })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Henüz atama yok</SelectItem>{data.assignees.map((assignee) => <SelectItem key={assignee.id} value={assignee.id}>{assignee.full_name || "İsimsiz kullanıcı"} · {roleLabels[assignee.role]}</SelectItem>)}</SelectContent></Select></label> : null}
            <label className="grid gap-1.5 text-sm font-medium">Planlanan Tarih<Input type="date" value={form.plannedDate} onChange={(event) => setForm({ ...form, plannedDate: event.target.value })} /></label>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Vazgeç</Button><Button onClick={() => editingTask ? updateTask.mutate() : createTask.mutate()} disabled={createTask.isPending || updateTask.isPending || form.title.trim().length < 3}>{createTask.isPending || updateTask.isPending ? "Kaydediliyor..." : editingTask ? "Değişiklikleri Kaydet" : "Görevi Oluştur"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  ) : null;

  const contractorsByWorkOrder = new Map<string, Assignee>();
  for (const assignment of data.assignments) {
    const contractor = assigneeById.get(assignment.contractor_id);
    if (contractor) contractorsByWorkOrder.set(assignment.work_order_id, contractor);
  }

  // Ana paneldeki “Açık Görevler” sayısı ile bu ekranın filtrelenmiş listesi
  // aynı kuralı kullanır. Böylece farklı ekranlarda farklı adet görünmez.
  const openProjectStatuses = ["in_progress", "external_approval", "blocked"];
  const showingOpenOnly = filter === "open";
  const visibleWorkOrders = showingOpenOnly
    ? data.workOrders.filter((task) => task.status === "in_progress")
    : data.workOrders;
  const visibleIndependentTasks = showingOpenOnly
    ? data.independent.filter((task) => openProjectStatuses.includes(task.status))
    : data.independent;
  const visibleProjectTasks = showingOpenOnly
    ? data.projectTasks.filter((task) => openProjectStatuses.includes(task.status))
    : data.projectTasks;
  const visibleTaskCount =
    visibleWorkOrders.length + visibleIndependentTasks.length + visibleProjectTasks.length;

  const projectTaskGroups = Array.from(
    visibleProjectTasks.reduce((groups, task) => {
      const tasks = groups.get(task.project_id) ?? [];
      tasks.push(task);
      groups.set(task.project_id, tasks);
      return groups;
    }, new Map<string, ProjectTask[]>()),
  );

  return <>
    <PageHeader title="Görevler" description={showingOpenOnly ? "Yalnızca devam eden, onayda veya engelli görevler." : "Projeye bağlı ve bağımsız operasyon görevlerini tek ekranda yönetin."} actions={createButton} />
    <section className="surface-panel mt-6 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
      <div>
        <h2 className="text-lg font-black">{showingOpenOnly ? "Açık Görevler" : "Görev Görünümü"}</h2>
        <p className="text-sm text-muted-foreground">{visibleTaskCount} görev listeleniyor.</p>
      </div>
      <div className="flex items-center gap-2">
        <a href="/tasks?filter=open" className={showingOpenOnly ? "rounded-lg bg-primary px-3 py-2 text-sm font-bold text-primary-foreground" : "rounded-lg border border-border px-3 py-2 text-sm font-bold text-muted-foreground hover:border-primary/60"}>Açık</a>
        <a href="/tasks" className={!showingOpenOnly ? "rounded-lg bg-primary px-3 py-2 text-sm font-bold text-primary-foreground" : "rounded-lg border border-border px-3 py-2 text-sm font-bold text-muted-foreground hover:border-primary/60"}>Tümü</a>
      </div>
    </section>
    <section className="surface-panel mt-6 p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between"><div><h2 className="text-lg font-black">Atanmış Saha Görevleri</h2><p className="text-sm text-muted-foreground">Taşeronlara atanmış görevleri finansal bilgi olmadan takip edin.</p></div>{role === "admin" ? <Link to="/work-orders" className="text-sm font-bold text-primary">Yönetim ekranını aç</Link> : null}</div>
      {visibleWorkOrders.length === 0 ? <div className="rounded-xl border border-border bg-muted/20 p-5 text-sm text-muted-foreground">{showingOpenOnly ? "Açık atanmış saha görevi yok." : "Atanmış saha görevi yok."}</div> : <div className="grid gap-3">{visibleWorkOrders.map((task) => <TaskCard key={task.id} title={`#${task.work_order_no ?? "—"} · ${task.title}`} status={task.status} plannedDate={task.scheduled_at} assignee={contractorsByWorkOrder.get(task.id)} subtitle={`${task.project_id ? projectById.get(task.project_id)?.name || "Proje" : "Bağımsız saha görevi"} · İlerleme %${task.progress_pct}`} />)}</div>}
    </section>
    <section className="surface-panel mt-7 p-4 sm:p-5">
      <div className="mb-3"><h2 className="text-lg font-black">Bağımsız Görevler</h2><p className="text-sm text-muted-foreground">Müşteri veya proje seçmeden açılabilen operasyon kayıtları.</p></div>
      {visibleIndependentTasks.length === 0 ? <EmptyState title={showingOpenOnly ? "Açık bağımsız görev yok" : "Bağımsız görev yok"} description="Saha, teknik ofis veya takip için ilk bağımsız görevi oluşturun." action={showingOpenOnly ? undefined : createButton} /> : <div className="grid gap-3">{visibleIndependentTasks.map((task) => <TaskCard key={task.id} id={`task-${task.id}`} title={task.title} status={task.status} plannedDate={task.planned_date} assignee={task.assigned_to ? assigneeById.get(task.assigned_to) : undefined} subtitle={[task.project_id ? projectById.get(task.project_id)?.name : null, task.customer_id ? customerById.get(task.customer_id) : null].filter(Boolean).join(" · ") || "Bağımsız görev"} actions={isOperationalManager(role) ? <><Button type="button" size="sm" variant="outline" onClick={() => { setEditingTask(task); setForm({ title: task.title, description: task.description ?? "", projectId: task.project_id ?? "none", customerId: task.customer_id ?? "none", assigneeId: task.assigned_to ?? "none", plannedDate: task.planned_date ?? "" }); setOpen(true); }}><Pencil className="mr-1.5 h-3.5 w-3.5" />Düzenle</Button>{role === "admin" ? <Button type="button" size="sm" variant="outline" className="border-destructive/40 text-destructive hover:text-destructive" onClick={() => { if (window.confirm(`“${task.title}” görevi silinsin mi?`)) deleteTask.mutate(task.id); }} disabled={deleteTask.isPending}><Trash2 className="mr-1.5 h-3.5 w-3.5" />Sil</Button> : null}</> : null} />)}</div>}
    </section>
    <section className="surface-panel mt-7 p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between"><div><h2 className="text-lg font-black">Proje Görevleri</h2><p className="text-sm text-muted-foreground">Projelerin süreçlerine bağlı kontrol ve saha görevleri.</p></div><Link to="/projects" className="text-sm font-bold text-primary">Projeleri aç</Link></div>
      {projectTaskGroups.length === 0 ? <div className="rounded-xl border border-border bg-muted/20 p-7 text-center text-sm text-muted-foreground">Henüz proje görevi yok.</div> : <Accordion type="multiple" className="rounded-xl border border-border bg-muted/10 px-4">
        {projectTaskGroups.map(([projectId, tasks]) => {
          const tasksByPhase = tasks.reduce((groups, task) => {
            const phaseTasks = groups.get(task.phase_name) ?? [];
            phaseTasks.push(task);
            groups.set(task.phase_name, phaseTasks);
            return groups;
          }, new Map<string, ProjectTask[]>());
          const project = projectById.get(projectId);
          return <AccordionItem key={projectId} value={projectId} className="border-border">
            <AccordionTrigger className="py-4 hover:no-underline"><span className="flex min-w-0 items-center gap-3"><FolderKanban className="h-5 w-5 shrink-0 text-primary" /><span className="min-w-0 text-left"><span className="block truncate font-black">{project?.name || "Proje"}</span><span className="block text-xs font-normal text-muted-foreground">{tasks.length} proje görevi · {tasksByPhase.size} süreç</span></span></span></AccordionTrigger>
            <AccordionContent className="pb-5"><div className="grid gap-4">{Array.from(tasksByPhase).map(([phaseName, phaseTasks]) => <div key={phaseName} className="rounded-xl border border-border bg-card/60 p-3"><div className="mb-3 flex items-center justify-between gap-3"><p className="font-bold">{phaseName}</p><Badge variant="secondary">{phaseTasks.length} görev</Badge></div><div className="grid gap-2">{phaseTasks.map((task) => <Link key={task.id} to="/projects/$projectId" params={{ projectId: task.project_id }} hash={`task-${task.id}`}><TaskCard title={task.task_name} status={task.status} plannedDate={task.planned_date} assignee={task.responsible_id ? assigneeById.get(task.responsible_id) : undefined} subtitle={`Onaylı ilerleme %${task.approved_progress_pct}`} /></Link>)}</div></div>)}</div></AccordionContent>
          </AccordionItem>;
        })}
      </Accordion>}
    </section>
  </>;
}

function TaskCard({ id, title, status, plannedDate, assignee, subtitle, actions }: { id?: string; title: string; status: string; plannedDate: string | null; assignee?: Assignee; subtitle: string; actions?: ReactNode }) {
  return <div id={id} className="scroll-mt-6 surface-panel p-4 transition-colors hover:border-primary/50"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-bold">{title}</p><p className="mt-1 text-sm text-muted-foreground">{subtitle}</p></div><div className="flex flex-wrap items-center gap-2 text-xs"><Badge variant="outline">{statusLabel[status] || status}</Badge>{assignee ? <Badge variant="secondary"><UserRound className="mr-1 h-3 w-3" />{assignee.full_name || "Kullanıcı"} · {roleLabels[assignee.role]}</Badge> : <Badge variant="secondary">Henüz atama yok</Badge>}{plannedDate ? <Badge variant="secondary"><CalendarDays className="mr-1 h-3 w-3" />{formatDate(plannedDate)}</Badge> : null}{actions}</div></div></div>;
}

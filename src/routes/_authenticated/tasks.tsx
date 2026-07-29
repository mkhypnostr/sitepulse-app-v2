import { useEffect, useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Pencil, Plus, Trash2, UserRound } from "lucide-react";
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

export const Route = createFileRoute("/_authenticated/tasks")({
  validateSearch: (search: Record<string, unknown>) => ({
    filter: ["open", "overdue", "approval", "completed"].includes(String(search.filter))
      ? (search.filter as "open" | "overdue" | "approval" | "completed")
      : undefined,
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
  note: string | null;
  approved_progress_pct: number;
};
type AssignedWorkOrder = {
  id: string;
  work_order_no: number | null;
  title: string;
  description: string | null;
  project_id: string | null;
  customer_id: string | null;
  status: string;
  scheduled_at: string | null;
  progress_pct: number;
};
type WorkOrderAssignment = { work_order_id: string; contractor_id: string };

const statusLabel: Record<string, string> = {
  planned: "Planlandı",
  not_started: "Planlandı",
  in_progress: "Devam ediyor",
  review_pending: "İş bitirme onayı bekliyor",
  external_approval: "Onay bekliyor",
  revision_required: "Revizyon gerekli",
  blocked: "Engellendi",
  completed: "Tamamlandı",
  cancelled: "İptal edildi",
  not_applicable: "Uygulanmaz",
};

type TaskFilter = "all" | "open" | "overdue" | "approval" | "completed";

const taskViews: Array<{ value: TaskFilter; label: string; description: string }> = [
  { value: "all", label: "Tümü", description: "Bütün görev kayıtları" },
  { value: "open", label: "Açık", description: "Planlanan, devam eden, engelli ve revizyondaki görevler" },
  { value: "approval", label: "Onay Bekleyen", description: "Yönetici incelemesi bekleyen görevler" },
  { value: "overdue", label: "Süresi Dolan", description: "Planlanan tarihi geçen açık görevler" },
  { value: "completed", label: "Tamamlanan", description: "Tamamlanmış veya uygulanmayacak görevler" },
];

function isTerminal(status: string) {
  return ["completed", "cancelled", "not_applicable"].includes(status);
}

function isOverdue(plannedDate: string | null) {
  if (!plannedDate) return false;
  return new Date(`${plannedDate.slice(0, 10)}T23:59:59`).getTime() < Date.now();
}

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
  const [editingWorkOrder, setEditingWorkOrder] = useState<AssignedWorkOrder | null>(null);
  const [workOrderForm, setWorkOrderForm] = useState({ title: "", description: "", assigneeId: "none", scheduledAt: "" });
  const [editingProjectTask, setEditingProjectTask] = useState<ProjectTask | null>(null);
  const [projectTaskForm, setProjectTaskForm] = useState({ title: "", note: "", assigneeId: "none", plannedDate: "" });
  const [selectedTask, setSelectedTask] = useState<IndependentTask | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<IndependentTask | null>(null);
  const [deleteWorkOrderTarget, setDeleteWorkOrderTarget] = useState<AssignedWorkOrder | null>(null);
  const [removeProjectTaskTarget, setRemoveProjectTaskTarget] = useState<ProjectTask | null>(null);

  const tasksQuery = useQuery({
    queryKey: ["unified-tasks"],
    enabled: canViewTasks,
    queryFn: async () => {
      const [independentResult, projectTasksResult, workOrdersResult, assignmentsResult, projectsResult, customersResult, assigneesResult] = await Promise.all([
        supabase.from("operational_tasks" as never).select("id, title, description, project_id, customer_id, assigned_to, status, planned_date").order("planned_date", { ascending: true, nullsFirst: false }),
        supabase.from("project_tasks").select("id, project_id, task_name, phase_name, responsible_id, status, planned_date, note, approved_progress_pct").order("planned_date", { ascending: true, nullsFirst: false }),
        supabase.from("work_orders").select("id, work_order_no, title, description, project_id, customer_id, status, scheduled_at, progress_pct").order("scheduled_at", { ascending: true, nullsFirst: false }),
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
      setDeleteTarget(null);
      setSelectedTask(null);
      toast.success("Bağımsız görev silindi");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const updateWorkOrder = useMutation({
    mutationFn: async () => {
      if (!editingWorkOrder) throw new Error("Düzenlenecek saha görevi bulunamadı.");
      if (workOrderForm.title.trim().length < 3) throw new Error("Görev adı en az 3 karakter olmalıdır.");
      if (!workOrderForm.scheduledAt) throw new Error("Planlanan tarih zorunludur.");
      const { error } = await supabase.rpc("update_work_order_task" as never, {
        target_work_order_id: editingWorkOrder.id,
        task_title: workOrderForm.title.trim(),
        task_description: workOrderForm.description.trim(),
        planned_at: new Date(workOrderForm.scheduledAt).toISOString(),
        assigned_user_id: workOrderForm.assigneeId === "none" ? null : workOrderForm.assigneeId,
      } as never);
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["unified-tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-work-orders"] }),
      ]);
      setEditingWorkOrder(null);
      toast.success("Saha görevi güncellendi");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const deleteWorkOrder = useMutation({
    mutationFn: async () => {
      if (!deleteWorkOrderTarget) throw new Error("Silinecek saha görevi bulunamadı.");
      const { error } = await supabase.rpc("delete_work_order_permanently" as never, {
        target_work_order_id: deleteWorkOrderTarget.id,
      } as never);
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["unified-tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-work-orders"] }),
      ]);
      setDeleteWorkOrderTarget(null);
      toast.success("Saha görevi kalıcı olarak silindi");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const updateProjectTask = useMutation({
    mutationFn: async () => {
      if (!editingProjectTask) throw new Error("Düzenlenecek proje görevi bulunamadı.");
      if (projectTaskForm.title.trim().length < 3) throw new Error("Görev adı en az 3 karakter olmalıdır.");
      const { error } = await supabase.rpc("manage_project_task_from_task_center" as never, {
        target_task_id: editingProjectTask.id,
        task_title: projectTaskForm.title.trim(),
        assigned_user_id: projectTaskForm.assigneeId === "none" ? null : projectTaskForm.assigneeId,
        planned_on: projectTaskForm.plannedDate || null,
        task_note: projectTaskForm.note.trim() || null,
      } as never);
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["unified-tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["projects-page"] }),
      ]);
      setEditingProjectTask(null);
      toast.success("Proje görevi güncellendi");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const removeProjectTask = useMutation({
    mutationFn: async () => {
      if (!removeProjectTaskTarget) throw new Error("Kaldırılacak proje görevi bulunamadı.");
      const { error } = await supabase.rpc("remove_project_task_from_task_center" as never, {
        target_task_id: removeProjectTaskTarget.id,
      } as never);
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["unified-tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["projects-page"] }),
      ]);
      setRemoveProjectTaskTarget(null);
      toast.success("Proje görevi aktif listeden kaldırıldı");
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

  const activeFilter: TaskFilter = filter ?? "all";
  const trackedProjectTask = (task: ProjectTask) =>
    Boolean(task.responsible_id) || task.approved_progress_pct > 0 ||
    ["in_progress", "external_approval", "revision_required", "blocked", "completed"].includes(task.status);
  const matchesFilter = (task: { status: string; plannedDate: string | null }, filterValue: TaskFilter) => {
    if (filterValue === "all") return true;
    if (filterValue === "open") return !isTerminal(task.status) && task.status !== "external_approval" && task.status !== "review_pending";
    if (filterValue === "approval") return ["external_approval", "review_pending"].includes(task.status);
    if (filterValue === "overdue") return !isTerminal(task.status) && isOverdue(task.plannedDate);
    return isTerminal(task.status);
  };
  const visibleWorkOrders = data.workOrders.filter((task) =>
    matchesFilter({ status: task.status, plannedDate: task.scheduled_at }, activeFilter),
  );
  const visibleIndependentTasks = data.independent.filter((task) =>
    matchesFilter({ status: task.status, plannedDate: task.planned_date }, activeFilter),
  );
  const visibleProjectTasks = data.projectTasks.filter((task) =>
    trackedProjectTask(task) &&
    matchesFilter({ status: task.status, plannedDate: task.planned_date }, activeFilter),
  );
  const visibleTaskCount =
    visibleWorkOrders.length + visibleIndependentTasks.length + visibleProjectTasks.length;

  const startEditingTask = (task: IndependentTask) => {
    setEditingTask(task);
    setForm({ title: task.title, description: task.description ?? "", projectId: task.project_id ?? "none", customerId: task.customer_id ?? "none", assigneeId: task.assigned_to ?? "none", plannedDate: task.planned_date ?? "" });
    setOpen(true);
  };

  const startEditingWorkOrder = (task: AssignedWorkOrder) => {
    const scheduledAt = task.scheduled_at ? new Date(task.scheduled_at) : null;
    const localDateTime = scheduledAt && !Number.isNaN(scheduledAt.getTime())
      ? new Date(scheduledAt.getTime() - scheduledAt.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
      : "";
    setEditingWorkOrder(task);
    setWorkOrderForm({
      title: task.title,
      description: task.description ?? "",
      assigneeId: contractorsByWorkOrder.get(task.id)?.id ?? "none",
      scheduledAt: localDateTime,
    });
  };

  const startEditingProjectTask = (task: ProjectTask) => {
    setEditingProjectTask(task);
    setProjectTaskForm({
      title: task.task_name,
      note: task.note ?? "",
      assigneeId: task.responsible_id ?? "none",
      plannedDate: task.planned_date ?? "",
    });
  };

  const unifiedTasks = [
    ...visibleWorkOrders.map((task) => ({
      id: `work-order-${task.id}`,
      category: "Saha",
      title: `#${task.work_order_no ?? "—"} · ${task.title}`,
      status: task.status,
      plannedDate: task.scheduled_at,
      assignee: contractorsByWorkOrder.get(task.id),
      relation: task.project_id ? `Proje: ${projectById.get(task.project_id)?.name || "Proje"}` : "Bağımsız saha görevi",
      subtitle: `İlerleme %${task.progress_pct}`,
      onOpen: () => { window.location.href = `/jobs/${task.id}`; },
      actions: <><Link to="/jobs/$jobId" params={{ jobId: task.id }}><Button type="button" size="sm" variant="outline">Görevi Aç</Button></Link>{role === "admin" ? <Button type="button" size="sm" variant="outline" onClick={() => startEditingWorkOrder(task)}><Pencil className="mr-1.5 h-3.5 w-3.5" />Düzenle</Button> : null}{role === "admin" ? <Button type="button" size="sm" variant="outline" className="border-destructive/40 text-destructive hover:text-destructive" onClick={() => setDeleteWorkOrderTarget(task)} disabled={deleteWorkOrder.isPending}><Trash2 className="mr-1.5 h-3.5 w-3.5" />Sil</Button> : null}</>,
    })),
    ...visibleIndependentTasks.map((task) => ({
      id: `operational-${task.id}`,
      category: task.project_id ? "Proje bağlantılı" : "Bağımsız",
      title: task.title,
      status: task.status,
      plannedDate: task.planned_date,
      assignee: task.assigned_to ? assigneeById.get(task.assigned_to) : undefined,
      relation: task.project_id ? `Proje: ${projectById.get(task.project_id)?.name || "Proje"}` : "Bağımsız görev",
      subtitle: task.customer_id ? `Müşteri: ${customerById.get(task.customer_id) || "Müşteri"}` : "Genel operasyon görevi",
      onOpen: () => setSelectedTask(task),
      actions: <><Button type="button" size="sm" variant="outline" onClick={() => setSelectedTask(task)}>Görevi Aç</Button>{isOperationalManager(role) ? <Button type="button" size="sm" variant="outline" onClick={() => startEditingTask(task)}><Pencil className="mr-1.5 h-3.5 w-3.5" />Düzenle</Button> : null}{role === "admin" ? <Button type="button" size="sm" variant="outline" className="border-destructive/40 text-destructive hover:text-destructive" onClick={() => setDeleteTarget(task)} disabled={deleteTask.isPending}><Trash2 className="mr-1.5 h-3.5 w-3.5" />Sil</Button> : null}</>,
    })),
    ...visibleProjectTasks.map((task) => ({
      id: `project-task-${task.id}`,
      category: "Proje süreci",
      title: task.task_name,
      status: task.status,
      plannedDate: task.planned_date,
      assignee: task.responsible_id ? assigneeById.get(task.responsible_id) : undefined,
      relation: `Proje: ${projectById.get(task.project_id)?.name || "Proje"}`,
      subtitle: `${task.phase_name} · Onaylı ilerleme %${task.approved_progress_pct}`,
      onOpen: () => { window.location.href = `/projects/${task.project_id}#task-${task.id}`; },
      actions: <><Link to="/projects/$projectId" params={{ projectId: task.project_id }} hash={`task-${task.id}`}><Button type="button" size="sm" variant="outline">Görevi Aç</Button></Link>{role === "admin" ? <Button type="button" size="sm" variant="outline" onClick={() => startEditingProjectTask(task)}><Pencil className="mr-1.5 h-3.5 w-3.5" />Düzenle</Button> : null}{role === "admin" ? <Button type="button" size="sm" variant="outline" className="border-destructive/40 text-destructive hover:text-destructive" onClick={() => setRemoveProjectTaskTarget(task)} disabled={removeProjectTask.isPending}><Trash2 className="mr-1.5 h-3.5 w-3.5" />Kaldır</Button> : null}</>,
    })),
  ].sort((left, right) => (left.plannedDate || "9999-12-31").localeCompare(right.plannedDate || "9999-12-31"));

  return <>
    <PageHeader title="Görevler" description="Bütün operasyon görevlerini tek merkezden açın, atayın, takip edin ve yönetin." actions={createButton} />
    <section className="surface-panel mt-6 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
      <div>
        <h2 className="text-lg font-black">{taskViews.find((view) => view.value === activeFilter)?.label} Görevler</h2>
        <p className="text-sm text-muted-foreground">{taskViews.find((view) => view.value === activeFilter)?.description} · {visibleTaskCount} kayıt listeleniyor.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {taskViews.map((view) => {
          const href = view.value === "all" ? "/tasks" : `/tasks?filter=${view.value}`;
          return <a key={view.value} href={href} className={activeFilter === view.value ? "rounded-lg bg-primary px-3 py-2 text-sm font-bold text-primary-foreground" : "rounded-lg border border-border bg-background/30 px-3 py-2 text-sm font-bold text-muted-foreground hover:border-primary/60 hover:text-foreground"}>{view.label}</a>;
        })}
      </div>
    </section>
    <section className="surface-panel mt-6 p-4 sm:p-5">
      <div className="mb-4"><h2 className="text-lg font-black">Görev Listesi</h2><p className="text-sm text-muted-foreground">Saha, proje ve bağımsız görevler burada tek listede yönetilir. Etiket yalnızca görevin nereden geldiğini gösterir.</p></div>
      {activeFilter === "all" ? <p className="mb-3 rounded-lg border border-primary/25 bg-primary/8 px-3 py-2 text-xs leading-5 text-muted-foreground">Henüz atanmamış proje kontrol listesi kalemleri burada görev sayılmaz; yalnızca proje detayında görünür. Bu liste, Paneldeki görev sayılarıyla aynı kayıtları gösterir.</p> : null}
      {unifiedTasks.length === 0 ? <EmptyState title="Bu görünümde görev yok" description="Filtreyi değiştirin veya yeni görev oluşturun." action={activeFilter === "all" ? createButton : undefined} /> : <div className="grid gap-3">{unifiedTasks.map((task) => <TaskCard key={task.id} category={task.category} title={task.title} status={task.status} plannedDate={task.plannedDate} assignee={task.assignee} relation={task.relation} subtitle={task.subtitle} onOpen={task.onOpen} actions={task.actions} />)}</div>}
    </section>
    <Dialog open={Boolean(selectedTask)} onOpenChange={(nextOpen) => { if (!nextOpen) setSelectedTask(null); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{selectedTask?.title || "Görev Detayı"}</DialogTitle>
          <DialogDescription>Bağımsız operasyon görevi bilgileri</DialogDescription>
        </DialogHeader>
        {selectedTask ? <div className="grid gap-3 text-sm">
          <div className="rounded-xl border border-border bg-muted/20 p-3"><p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Açıklama</p><p className="mt-1 whitespace-pre-wrap">{selectedTask.description?.trim() || "Açıklama girilmemiş."}</p></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border p-3"><p className="text-xs font-bold text-muted-foreground">Sorumlu</p><p className="mt-1 font-bold">{selectedTask.assigned_to ? assigneeById.get(selectedTask.assigned_to)?.full_name || "Kullanıcı" : "Henüz atama yok"}</p></div>
            <div className="rounded-xl border border-border p-3"><p className="text-xs font-bold text-muted-foreground">Planlanan Tarih</p><p className="mt-1 font-bold">{selectedTask.planned_date ? formatDate(selectedTask.planned_date) : "Tarih belirlenmedi"}</p></div>
            <div className="rounded-xl border border-border p-3"><p className="text-xs font-bold text-muted-foreground">Bağlı Proje</p><p className="mt-1 font-bold">{selectedTask.project_id ? projectById.get(selectedTask.project_id)?.name || "Proje" : "Bağımsız"}</p></div>
            <div className="rounded-xl border border-border p-3"><p className="text-xs font-bold text-muted-foreground">Müşteri</p><p className="mt-1 font-bold">{selectedTask.customer_id ? customerById.get(selectedTask.customer_id) || "Müşteri" : "Seçilmedi"}</p></div>
          </div>
        </div> : null}
        <DialogFooter>{selectedTask && isOperationalManager(role) ? <Button variant="outline" onClick={() => { const task = selectedTask; setSelectedTask(null); startEditingTask(task); }}><Pencil className="mr-2 h-4 w-4" />Düzenle</Button> : null}<Button variant="outline" onClick={() => setSelectedTask(null)}>Kapat</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(editingProjectTask)} onOpenChange={(nextOpen) => { if (!nextOpen && !updateProjectTask.isPending) setEditingProjectTask(null); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Proje görevini düzenle</DialogTitle>
          <DialogDescription>Bu ekrandan görev tanımı, plan tarihi ve sorumlusu yönetilir. Kanıt, ilerleme ve onay akışı “Kanıt / Detay” ekranında korunur.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <label className="grid gap-1.5 text-sm font-medium">Görev Başlığı<Input value={projectTaskForm.title} onChange={(event) => setProjectTaskForm({ ...projectTaskForm, title: event.target.value })} maxLength={180} /></label>
          <label className="grid gap-1.5 text-sm font-medium">Planlama Notu<Textarea value={projectTaskForm.note} onChange={(event) => setProjectTaskForm({ ...projectTaskForm, note: event.target.value })} maxLength={2000} /></label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium">Sorumlu<Select value={projectTaskForm.assigneeId} onValueChange={(assigneeId) => setProjectTaskForm({ ...projectTaskForm, assigneeId })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Henüz atama yok</SelectItem>{data.assignees.map((assignee) => <SelectItem key={assignee.id} value={assignee.id}>{assignee.full_name || "İsimsiz kullanıcı"} · {roleLabels[assignee.role]}</SelectItem>)}</SelectContent></Select></label>
            <label className="grid gap-1.5 text-sm font-medium">Planlanan Tarih<Input type="date" value={projectTaskForm.plannedDate} onChange={(event) => setProjectTaskForm({ ...projectTaskForm, plannedDate: event.target.value })} /></label>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setEditingProjectTask(null)} disabled={updateProjectTask.isPending}>Vazgeç</Button><Button onClick={() => updateProjectTask.mutate()} disabled={updateProjectTask.isPending || projectTaskForm.title.trim().length < 3}>{updateProjectTask.isPending ? "Kaydediliyor..." : "Değişiklikleri Kaydet"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(editingWorkOrder)} onOpenChange={(nextOpen) => { if (!nextOpen && !updateWorkOrder.isPending) setEditingWorkOrder(null); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Saha görevini düzenle</DialogTitle>
          <DialogDescription>Ticari bilgiler burada görünmez veya değiştirilemez. Kanıt ve ilerleme ayrıntıları “Kanıt / Detay” ekranındadır.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <label className="grid gap-1.5 text-sm font-medium">Görev Başlığı<Input value={workOrderForm.title} onChange={(event) => setWorkOrderForm({ ...workOrderForm, title: event.target.value })} maxLength={180} /></label>
          <label className="grid gap-1.5 text-sm font-medium">Açıklama<Textarea value={workOrderForm.description} onChange={(event) => setWorkOrderForm({ ...workOrderForm, description: event.target.value })} maxLength={2000} /></label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium">Sorumlu<Select value={workOrderForm.assigneeId} onValueChange={(assigneeId) => setWorkOrderForm({ ...workOrderForm, assigneeId })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Henüz atama yok</SelectItem>{data.assignees.map((assignee) => <SelectItem key={assignee.id} value={assignee.id}>{assignee.full_name || "İsimsiz kullanıcı"} · {roleLabels[assignee.role]}</SelectItem>)}</SelectContent></Select></label>
            <label className="grid gap-1.5 text-sm font-medium">Planlanan Tarih ve Saat<Input type="datetime-local" value={workOrderForm.scheduledAt} onChange={(event) => setWorkOrderForm({ ...workOrderForm, scheduledAt: event.target.value })} /></label>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setEditingWorkOrder(null)} disabled={updateWorkOrder.isPending}>Vazgeç</Button><Button onClick={() => updateWorkOrder.mutate()} disabled={updateWorkOrder.isPending || workOrderForm.title.trim().length < 3 || !workOrderForm.scheduledAt}>{updateWorkOrder.isPending ? "Kaydediliyor..." : "Değişiklikleri Kaydet"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(deleteTarget)} onOpenChange={(nextOpen) => { if (!nextOpen && !deleteTask.isPending) setDeleteTarget(null); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Bağımsız görev kalıcı olarak silinsin mi?</DialogTitle>
          <DialogDescription>“{deleteTarget?.title}” görevi geri alınamayacak şekilde silinir.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleteTask.isPending}>Vazgeç</Button>
          <Button variant="destructive" onClick={() => deleteTarget && deleteTask.mutate(deleteTarget.id)} disabled={deleteTask.isPending}>{deleteTask.isPending ? "Siliniyor..." : "Görevi Kalıcı Sil"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(deleteWorkOrderTarget)} onOpenChange={(nextOpen) => { if (!nextOpen && !deleteWorkOrder.isPending) setDeleteWorkOrderTarget(null); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Saha görevi kalıcı olarak silinsin mi?</DialogTitle>
          <DialogDescription>{deleteWorkOrderTarget ? `#${deleteWorkOrderTarget.work_order_no ?? "—"} · ${deleteWorkOrderTarget.title}` : "Bu saha görevi"} ve bağlı atama, ilerleme, kanıt ve finans kayıtları silinir. Bu işlem geri alınamaz.</DialogDescription>
        </DialogHeader>
        <DialogFooter><Button variant="outline" onClick={() => setDeleteWorkOrderTarget(null)} disabled={deleteWorkOrder.isPending}>Vazgeç</Button><Button variant="destructive" onClick={() => deleteWorkOrder.mutate()} disabled={deleteWorkOrder.isPending}>{deleteWorkOrder.isPending ? "Siliniyor..." : "Görevi Kalıcı Sil"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(removeProjectTaskTarget)} onOpenChange={(nextOpen) => { if (!nextOpen && !removeProjectTask.isPending) setRemoveProjectTaskTarget(null); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Proje görevi aktif listeden kaldırılsın mı?</DialogTitle>
          <DialogDescription>{removeProjectTaskTarget ? `“${removeProjectTaskTarget.task_name}” görevi` : "Bu görev"} uygulanmaz olarak işaretlenir. Proje, kanıt ve geçmiş kayıtları korunur; görev aktif listelerde görünmez.</DialogDescription>
        </DialogHeader>
        <DialogFooter><Button variant="outline" onClick={() => setRemoveProjectTaskTarget(null)} disabled={removeProjectTask.isPending}>Vazgeç</Button><Button variant="destructive" onClick={() => removeProjectTask.mutate()} disabled={removeProjectTask.isPending}>{removeProjectTask.isPending ? "Kaldırılıyor..." : "Görevi Aktif Listeden Kaldır"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}

function TaskCard({ id, category, title, status, plannedDate, assignee, relation, subtitle, onOpen, actions }: { id?: string; category?: string; title: string; status: string; plannedDate: string | null; assignee?: Assignee; relation: string; subtitle: string; onOpen?: () => void; actions?: ReactNode }) {
  const overdue = !isTerminal(status) && isOverdue(plannedDate);
  return <div id={id} className={`scroll-mt-6 surface-panel p-4 transition-colors hover:border-primary/50 ${overdue ? "border-amber-500/50 bg-amber-500/[0.035]" : ""}`}><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><button type="button" className="min-w-0 text-left transition-colors hover:text-primary" onClick={onOpen}><div className="flex flex-wrap items-center gap-2"><p className="font-bold">{title}</p>{category ? <Badge variant="secondary">{category}</Badge> : null}{overdue ? <Badge className="border-amber-500/50 bg-amber-500/15 text-amber-600 dark:text-amber-300">Gecikti</Badge> : null}</div><div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"><span className="font-semibold text-foreground/90">{relation}</span><span className="text-muted-foreground">• {subtitle}</span></div></button><div className="flex flex-wrap items-center gap-2 text-xs"><Badge variant="outline">{statusLabel[status] || status}</Badge>{assignee ? <Badge variant="secondary"><UserRound className="mr-1 h-3 w-3" />{assignee.full_name || "Kullanıcı"} · {roleLabels[assignee.role]}</Badge> : <Badge variant="secondary">Henüz atama yok</Badge>}{plannedDate ? <Badge className={overdue ? "border-amber-500/50 bg-amber-500/15 text-amber-600 dark:text-amber-300" : ""} variant="secondary"><CalendarDays className="mr-1 h-3 w-3" />{formatDate(plannedDate)}</Badge> : null}{actions}</div></div></div>;
}

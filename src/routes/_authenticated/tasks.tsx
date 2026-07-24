import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, FolderKanban, Plus, UserRound } from "lucide-react";
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

const statusLabel: Record<string, string> = {
  not_started: "Planlandı",
  in_progress: "Devam ediyor",
  completed: "Tamamlandı",
  not_applicable: "Uygulanmaz",
};

function TasksPage() {
  const { role } = useAuth();
  const canManage = isOperationalManager(role);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", projectId: "none", customerId: "none", assigneeId: "none", plannedDate: "" });

  const tasksQuery = useQuery({
    queryKey: ["unified-tasks"],
    enabled: canManage,
    queryFn: async () => {
      const [independentResult, projectTasksResult, projectsResult, customersResult, assigneesResult] = await Promise.all([
        supabase.from("operational_tasks" as never).select("id, title, description, project_id, customer_id, assigned_to, status, planned_date").order("planned_date", { ascending: true, nullsFirst: false }),
        supabase.from("project_tasks").select("id, project_id, task_name, phase_name, responsible_id, status, planned_date, approved_progress_pct").order("planned_date", { ascending: true, nullsFirst: false }),
        supabase.from("projects").select("id, name, project_no").order("created_at", { ascending: false }),
        supabase.from("customers").select("id, name").order("name"),
        supabase.rpc("list_task_assignees"),
      ]);
      if (independentResult.error) throw independentResult.error;
      if (projectTasksResult.error) throw projectTasksResult.error;
      if (projectsResult.error) throw projectsResult.error;
      if (customersResult.error) throw customersResult.error;
      if (assigneesResult.error) throw assigneesResult.error;
      return {
        independent: (independentResult.data ?? []) as unknown as IndependentTask[],
        projectTasks: (projectTasksResult.data ?? []) as ProjectTask[],
        projects: projectsResult.data ?? [],
        customers: customersResult.data ?? [],
        assignees: (assigneesResult.data ?? []) as Assignee[],
      };
    },
  });

  const createTask = useMutation({
    mutationFn: async () => {
      if (form.title.trim().length < 3) throw new Error("Görev adı en az 3 karakter olmalıdır.");
      const { error } = await supabase.rpc("create_operational_task", {
        task_title: form.title.trim(),
        task_description: form.description.trim() || undefined,
        target_project_id: form.projectId === "none" ? undefined : form.projectId,
        target_customer_id: form.customerId === "none" ? undefined : form.customerId,
        assigned_user_id: form.assigneeId === "none" ? undefined : form.assigneeId,
        planned_on: form.plannedDate || undefined,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["unified-tasks"] });
      setForm({ title: "", description: "", projectId: "none", customerId: "none", assigneeId: "none", plannedDate: "" });
      setOpen(false);
      toast.success("Bağımsız görev oluşturuldu");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (!canManage) return <AccessDenied />;
  if (tasksQuery.isLoading) return <LoadingState label="Görevler yükleniyor..." />;
  if (tasksQuery.error) return <p className="surface-panel p-5 text-destructive">{errorMessage(tasksQuery.error)}</p>;

  const data = tasksQuery.data ?? { independent: [], projectTasks: [], projects: [], customers: [], assignees: [] };
  const projectById = new Map(data.projects.map((project) => [project.id, project]));
  const customerById = new Map(data.customers.map((customer) => [customer.id, customer.name]));
  const assigneeById = new Map(data.assignees.map((assignee) => [assignee.id, assignee]));
  const createButton = (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button className="h-12 font-bold"><Plus className="mr-2 h-4 w-4" /> Yeni Bağımsız Görev</Button></DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Bağımsız görev oluştur</DialogTitle>
          <DialogDescription>Müşteri ve proje isteğe bağlıdır. Finansal bilgi bu görev kaydında yer almaz.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <label className="grid gap-1.5 text-sm font-medium">Görev Başlığı<Input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} maxLength={180} /></label>
          <label className="grid gap-1.5 text-sm font-medium">Açıklama<Textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} maxLength={2000} /></label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium">Bağlı Proje (isteğe bağlı)<Select value={form.projectId} onValueChange={(projectId) => setForm({ ...form, projectId })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Bağımsız görev</SelectItem>{data.projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.project_no} · {project.name}</SelectItem>)}</SelectContent></Select></label>
            <label className="grid gap-1.5 text-sm font-medium">Müşteri (isteğe bağlı)<Select value={form.customerId} onValueChange={(customerId) => setForm({ ...form, customerId })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Müşteri seçilmedi</SelectItem>{data.customers.map((customer) => <SelectItem key={customer.id} value={customer.id}>{customer.name}</SelectItem>)}</SelectContent></Select></label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium">Sorumlu (isteğe bağlı)<Select value={form.assigneeId} onValueChange={(assigneeId) => setForm({ ...form, assigneeId })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Henüz atama yok</SelectItem>{data.assignees.map((assignee) => <SelectItem key={assignee.id} value={assignee.id}>{assignee.full_name || "İsimsiz kullanıcı"} · {roleLabels[assignee.role]}</SelectItem>)}</SelectContent></Select></label>
            <label className="grid gap-1.5 text-sm font-medium">Planlanan Tarih<Input type="date" value={form.plannedDate} onChange={(event) => setForm({ ...form, plannedDate: event.target.value })} /></label>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Vazgeç</Button><Button onClick={() => createTask.mutate()} disabled={createTask.isPending || form.title.trim().length < 3}>{createTask.isPending ? "Kaydediliyor..." : "Görevi Oluştur"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return <>
    <PageHeader title="Görevler" description="Projeye bağlı ve bağımsız operasyon görevlerini tek ekranda yönetin." actions={createButton} />
    <section className="mt-6">
      <div className="mb-3"><h2 className="text-lg font-black">Bağımsız Görevler</h2><p className="text-sm text-muted-foreground">Müşteri veya proje seçmeden açılabilen operasyon kayıtları.</p></div>
      {data.independent.length === 0 ? <EmptyState title="Bağımsız görev yok" description="Saha, teknik ofis veya takip için ilk bağımsız görevi oluşturun." action={createButton} /> : <div className="grid gap-3">{data.independent.map((task) => <TaskCard key={task.id} title={task.title} status={task.status} plannedDate={task.planned_date} assignee={task.assigned_to ? assigneeById.get(task.assigned_to) : undefined} subtitle={[task.project_id ? projectById.get(task.project_id)?.name : null, task.customer_id ? customerById.get(task.customer_id) : null].filter(Boolean).join(" · ") || "Bağımsız görev"} />)}</div>}
    </section>
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between"><div><h2 className="text-lg font-black">Proje Görevleri</h2><p className="text-sm text-muted-foreground">Projelerin süreçlerine bağlı kontrol ve saha görevleri.</p></div><Link to="/projects" className="text-sm font-bold text-primary">Projeleri aç</Link></div>
      {data.projectTasks.length === 0 ? <div className="surface-panel p-7 text-center text-sm text-muted-foreground">Henüz proje görevi yok.</div> : <div className="grid gap-3">{data.projectTasks.slice(0, 20).map((task) => <Link key={task.id} to="/projects/$projectId" params={{ projectId: task.project_id }} hash={`task-${task.id}`}><TaskCard title={task.task_name} status={task.status} plannedDate={task.planned_date} assignee={task.responsible_id ? assigneeById.get(task.responsible_id) : undefined} subtitle={`${projectById.get(task.project_id)?.name || "Proje"} · ${task.phase_name} · Onaylı ilerleme %${task.approved_progress_pct}`} /></Link>)}</div>}
    </section>
  </>;
}

function TaskCard({ title, status, plannedDate, assignee, subtitle }: { title: string; status: string; plannedDate: string | null; assignee?: Assignee; subtitle: string }) {
  return <div className="surface-panel p-4 transition-colors hover:border-primary/50"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-bold">{title}</p><p className="mt-1 text-sm text-muted-foreground">{subtitle}</p></div><div className="flex flex-wrap items-center gap-2 text-xs"><Badge variant="outline">{statusLabel[status] || status}</Badge>{assignee ? <Badge variant="secondary"><UserRound className="mr-1 h-3 w-3" />{assignee.full_name || "Kullanıcı"} · {roleLabels[assignee.role]}</Badge> : <Badge variant="secondary">Henüz atama yok</Badge>}{plannedDate ? <Badge variant="secondary"><CalendarDays className="mr-1 h-3 w-3" />{formatDate(plannedDate)}</Badge> : null}</div></div></div>;
}

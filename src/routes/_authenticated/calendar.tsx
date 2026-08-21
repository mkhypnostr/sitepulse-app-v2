import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { errorMessage } from "@/lib/domain";
import { isOperationalManager } from "@/lib/permissions";
import {
  AccessDenied,
  LoadingState,
  PageHeader,
} from "@/components/page-states";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/calendar")({
  component: CalendarPage,
});

const WEEKDAY_LABELS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
const WORK_ORDER_TERMINAL = new Set(["completed", "cancelled"]);
const TASK_TERMINAL = new Set(["completed", "cancelled", "not_applicable"]);
const MONTH_WEEKS_SHOWN = 6;
const MONTH_CELL_COUNT = MONTH_WEEKS_SHOWN * 7;

type ViewMode = "month" | "week";
type ColorState = "overdue" | "today" | "future" | "done";

type LinkTarget = {
  to: string;
  params?: Record<string, string>;
  hash?: string;
};

type CalendarItem = {
  id: string;
  title: string;
  date: string;
  colorState: ColorState;
  link?: LinkTarget;
  eventId?: string;
  time?: string | null;
  eventType?: CalendarEventType;
  notes?: string | null;
};

type CalendarEventType = "plan" | "meeting" | "site_visit" | "reminder";
type CalendarEventStatus = "planned" | "completed" | "cancelled";
type CalendarEventForm = {
  title: string;
  scheduledDate: string;
  scheduledTime: string;
  eventType: CalendarEventType;
  projectId: string;
  workOrderId: string;
  responsibleId: string;
  notes: string;
  status: CalendarEventStatus;
};

const eventTypeLabels: Record<CalendarEventType, string> = {
  plan: "İş planı",
  meeting: "Toplantı",
  site_visit: "Saha ziyareti / keşif",
  reminder: "Hatırlatma",
};

const eventStatusLabels: Record<CalendarEventStatus, string> = {
  planned: "Planlandı",
  completed: "Tamamlandı",
  cancelled: "İptal edildi",
};

const colorClasses: Record<ColorState, string> = {
  overdue:
    "border-destructive/40 bg-destructive/15 text-destructive hover:bg-destructive/25",
  today: "border-warning/40 bg-warning/15 text-warning hover:bg-warning/25",
  future:
    "border-highlight/40 bg-highlight/15 text-highlight hover:bg-highlight/25",
  // Tamamlanmış/iptal edilmiş kayıtlar bilerek sade/nötr — kırmızı/amber/mavi
  // "aksiyon gerekiyor" anlamına geldiği için kapanmış işlerde kullanılmıyor.
  done: "border-border bg-muted/60 text-muted-foreground hover:bg-muted",
};

const legendDotClasses: Record<ColorState, string> = {
  overdue: "bg-destructive",
  today: "bg-warning",
  future: "bg-highlight",
  done: "bg-muted-foreground",
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toDateKey(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startOfWeek(d: Date) {
  const offset = (d.getDay() + 6) % 7; // Pazartesi = 0
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset);
  return start;
}

function colorStateFor(
  dateKey: string,
  todayKey: string,
  terminal: boolean,
): ColorState {
  if (terminal) return "done";
  if (dateKey < todayKey) return "overdue";
  if (dateKey === todayKey) return "today";
  return "future";
}

function initialEventForm(scheduledDate: string): CalendarEventForm {
  return {
    title: "",
    scheduledDate,
    scheduledTime: "",
    eventType: "plan",
    projectId: "",
    workOrderId: "",
    responsibleId: "",
    notes: "",
    status: "planned",
  };
}

function CalendarPage() {
  const { role, user } = useAuth();
  const canView =
    role === "admin" || role === "technical_office" || role === "contractor";
  const isManager = isOperationalManager(role);
  const isContractor = role === "contractor";
  const queryClient = useQueryClient();

  const [view, setView] = useState<ViewMode>("month");
  const [anchor, setAnchor] = useState(() => new Date());
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [eventForm, setEventForm] = useState<CalendarEventForm>(() =>
    initialEventForm(toDateKey(new Date())),
  );
  const now = new Date();
  const todayKey = toDateKey(now);

  const { gridStart, gridEnd, cells, periodLabel } = useMemo(() => {
    if (view === "week") {
      const start = startOfWeek(anchor);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      const dayCells = Array.from({ length: 7 }, (_, index) => {
        const date = new Date(start);
        date.setDate(start.getDate() + index);
        return { date, key: toDateKey(date), inCurrentMonth: true };
      });
      const fmt = new Intl.DateTimeFormat("tr-TR", {
        day: "numeric",
        month: "short",
      });
      const label = `${fmt.format(start)} – ${fmt.format(end)} ${end.getFullYear()}`;
      return {
        gridStart: start,
        gridEnd: end,
        cells: dayCells,
        periodLabel: label,
      };
    }

    const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const startOffset = (monthStart.getDay() + 6) % 7; // Pazartesi = 0
    const start = new Date(
      anchor.getFullYear(),
      anchor.getMonth(),
      1 - startOffset,
    );
    const end = new Date(start);
    end.setDate(start.getDate() + MONTH_CELL_COUNT - 1);

    const dayCells = Array.from({ length: MONTH_CELL_COUNT }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return {
        date,
        key: toDateKey(date),
        inCurrentMonth: date.getMonth() === anchor.getMonth(),
      };
    });

    const label = new Intl.DateTimeFormat("tr-TR", {
      month: "long",
      year: "numeric",
    }).format(monthStart);
    return {
      gridStart: start,
      gridEnd: end,
      cells: dayCells,
      periodLabel: label,
    };
  }, [view, anchor]);

  const query = useQuery({
    queryKey: [
      "calendar-tasks",
      view,
      toDateKey(gridStart),
      toDateKey(gridEnd),
      role,
      user?.id,
    ],
    enabled: canView && Boolean(user?.id),
    queryFn: async () => {
      const gridStartKey = toDateKey(gridStart);
      const gridEndKey = toDateKey(gridEnd);
      const gridEndExclusive = new Date(gridEnd);
      gridEndExclusive.setDate(gridEnd.getDate() + 1);

      // Taslak iş emirleri ve plan tarihi olmayan kayıtlar takvime hiç girmez.
      const workOrdersQuery = supabase
        .from("work_orders")
        .select("id, title, scheduled_at, status")
        .neq("status", "draft")
        .gte("scheduled_at", gridStart.toISOString())
        .lt("scheduled_at", gridEndExclusive.toISOString());

      let projectTasksQuery = supabase
        .from("project_tasks")
        .select(
          "id, project_id, task_name, planned_date, status, responsible_id",
        )
        .gte("planned_date", gridStartKey)
        .lte("planned_date", gridEndKey);

      let operationalTasksQuery = supabase
        .from("operational_tasks")
        .select("id, title, planned_date, status, assigned_to")
        .gte("planned_date", gridStartKey)
        .lte("planned_date", gridEndKey);

      // Yönetici (admin/technical_office) tüm kayıtları görür (RLS zaten
      // buna göre kapsıyor); taşeron yalnızca kendisine atanmış kayıtları
      // görür. work_orders için ek filtre gerekmiyor — RLS taşeronu zaten
      // yalnızca kendi atandığı iş emirleriyle sınırlıyor.
      if (isContractor && user) {
        projectTasksQuery = projectTasksQuery.eq("responsible_id", user.id);
        operationalTasksQuery = operationalTasksQuery.eq(
          "assigned_to",
          user.id,
        );
      }

      let calendarEventsQuery = supabase
        .from("calendar_events")
        .select(
          "id, title, event_type, scheduled_date, scheduled_time, project_id, work_order_id, responsible_id, notes, status",
        )
        .gte("scheduled_date", gridStartKey)
        .lte("scheduled_date", gridEndKey)
        .order("scheduled_date")
        .order("scheduled_time");

      const [workOrdersResult, projectTasksResult, operationalTasksResult, calendarEventsResult, projectsResult, allWorkOrdersResult, profilesResult] =
        await Promise.all([
          workOrdersQuery,
          projectTasksQuery,
          operationalTasksQuery,
          calendarEventsQuery,
          isManager
            ? supabase.from("projects").select("id, project_no, name").order("name")
            : Promise.resolve({ data: [], error: null }),
          isManager
            ? supabase.from("work_orders").select("id, work_order_no, title").order("title")
            : Promise.resolve({ data: [], error: null }),
          isManager
            ? supabase.from("profiles").select("id, full_name").order("full_name")
            : Promise.resolve({ data: [], error: null }),
        ]);
      if (workOrdersResult.error) throw workOrdersResult.error;
      if (projectTasksResult.error) throw projectTasksResult.error;
      if (operationalTasksResult.error) throw operationalTasksResult.error;
      if (calendarEventsResult.error) throw calendarEventsResult.error;
      if (projectsResult.error) throw projectsResult.error;
      if (allWorkOrdersResult.error) throw allWorkOrdersResult.error;
      if (profilesResult.error) throw profilesResult.error;

      const items: CalendarItem[] = [];

      for (const order of workOrdersResult.data ?? []) {
        if (!order.scheduled_at || order.status === "draft") continue;
        const dateKey = order.scheduled_at.slice(0, 10);
        items.push({
          id: `wo-${order.id}`,
          title: order.title,
          date: dateKey,
          colorState: colorStateFor(
            dateKey,
            todayKey,
            WORK_ORDER_TERMINAL.has(order.status),
          ),
          link: { to: "/jobs/$jobId", params: { jobId: order.id } },
        });
      }

      for (const task of projectTasksResult.data ?? []) {
        if (!task.planned_date) continue;
        items.push({
          id: `pt-${task.id}`,
          title: task.task_name,
          date: task.planned_date,
          colorState: colorStateFor(
            task.planned_date,
            todayKey,
            TASK_TERMINAL.has(task.status),
          ),
          link: isManager
            ? {
                to: "/projects/$projectId",
                params: { projectId: task.project_id },
                hash: `task-${task.id}`,
              }
            : { to: "/my-project-tasks" },
        });
      }

      for (const task of operationalTasksResult.data ?? []) {
        if (!task.planned_date) continue;
        items.push({
          id: `ot-${task.id}`,
          title: task.title,
          date: task.planned_date,
          colorState: colorStateFor(
            task.planned_date,
            todayKey,
            TASK_TERMINAL.has(task.status),
          ),
          link: isManager
            ? { to: "/tasks", hash: `operational-${task.id}` }
            : { to: "/my-jobs" },
        });
      }

      for (const event of calendarEventsResult.data ?? []) {
        const status = event.status as CalendarEventStatus;
        items.push({
          id: `ce-${event.id}`,
          eventId: event.id,
          title: event.title,
          date: event.scheduled_date,
          time: event.scheduled_time,
          eventType: event.event_type as CalendarEventType,
          notes: event.notes,
          colorState: colorStateFor(
            event.scheduled_date,
            todayKey,
            status === "completed" || status === "cancelled",
          ),
        });
      }

      const byDate = new Map<string, CalendarItem[]>();
      for (const item of items) {
        const list = byDate.get(item.date) ?? [];
        list.push(item);
        byDate.set(item.date, list);
      }
      return {
        itemsByDate: byDate,
        calendarEvents: calendarEventsResult.data ?? [],
        projects: projectsResult.data ?? [],
        workOrders: allWorkOrdersResult.data ?? [],
        profiles: profilesResult.data ?? [],
      };
    },
  });

  const itemsByDate = query.data?.itemsByDate ?? new Map<string, CalendarItem[]>();
  const maxVisiblePerCell = view === "week" ? 6 : 3;

  const goPrev = () => {
    setAnchor((prev) => {
      if (view === "week") {
        const d = new Date(prev);
        d.setDate(d.getDate() - 7);
        return d;
      }
      return new Date(prev.getFullYear(), prev.getMonth() - 1, 1);
    });
  };

  const goNext = () => {
    setAnchor((prev) => {
      if (view === "week") {
        const d = new Date(prev);
        d.setDate(d.getDate() + 7);
        return d;
      }
      return new Date(prev.getFullYear(), prev.getMonth() + 1, 1);
    });
  };

  const goToday = () => setAnchor(new Date());

  const agendaDays =
    view === "week"
      ? cells
      : cells.filter((cell) => (itemsByDate.get(cell.key) ?? []).length > 0);
  const agendaDateFormatter = new Intl.DateTimeFormat("tr-TR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  function openCreateEvent(date = todayKey) {
    setEditingEventId(null);
    setEventForm(initialEventForm(date));
    setEventDialogOpen(true);
  }

  function openEditEvent(eventId: string) {
    const event = (query.data?.calendarEvents ?? []).find(
      (item) => item.id === eventId,
    );
    if (!event) return;
    setEditingEventId(event.id);
    setEventForm({
      title: event.title,
      scheduledDate: event.scheduled_date,
      scheduledTime: event.scheduled_time ?? "",
      eventType: event.event_type as CalendarEventType,
      projectId: event.project_id ?? "",
      workOrderId: event.work_order_id ?? "",
      responsibleId: event.responsible_id ?? "",
      notes: event.notes ?? "",
      status: event.status as CalendarEventStatus,
    });
    setEventDialogOpen(true);
  }

  const saveEvent = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Oturum bulunamadı.");
      if (eventForm.title.trim().length < 3) {
        throw new Error("Plan başlığı en az 3 karakter olmalıdır.");
      }
      if (!eventForm.scheduledDate) {
        throw new Error("Plan tarihi gereklidir.");
      }
      const payload = {
        title: eventForm.title.trim(),
        scheduled_date: eventForm.scheduledDate,
        scheduled_time: eventForm.scheduledTime || null,
        event_type: eventForm.eventType,
        project_id: eventForm.projectId || null,
        work_order_id: eventForm.workOrderId || null,
        responsible_id: eventForm.responsibleId || null,
        notes: eventForm.notes.trim() || null,
        status: eventForm.status,
        updated_at: new Date().toISOString(),
      };
      if (editingEventId) {
        const { error } = await supabase
          .from("calendar_events")
          .update(payload)
          .eq("id", editingEventId);
        if (error) throw error;
        return "updated";
      }
      const { error } = await supabase
        .from("calendar_events")
        .insert({ ...payload, created_by: user.id });
      if (error) throw error;
      return "created";
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["calendar-tasks"] });
      setEventDialogOpen(false);
      toast.success(result === "created" ? "Plan takvime eklendi." : "Plan güncellendi.");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (!canView) return <AccessDenied />;

  return (
    <>
      <PageHeader
        title="Takvim"
        description={
          isManager
            ? "Tüm iş emirleri ve görevler tarihe göre görüntüleniyor."
            : "Size atanan iş emirleri ve görevler tarihe göre görüntüleniyor."
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {isManager ? (
              <Button type="button" onClick={() => openCreateEvent()}>
                <Plus className="mr-2 h-4 w-4" /> Plan Ekle
              </Button>
            ) : null}
            <div className="inline-flex overflow-hidden rounded-md border border-input">
              <Button
                type="button"
                variant={view === "month" ? "default" : "ghost"}
                size="sm"
                className="rounded-none"
                onClick={() => setView("month")}
              >
                Ay
              </Button>
              <Button
                type="button"
                variant={view === "week" ? "default" : "ghost"}
                size="sm"
                className="rounded-none"
                onClick={() => setView("week")}
              >
                Hafta
              </Button>
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={goPrev}
              aria-label="Önceki"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-32 text-center text-sm font-black capitalize">
              {periodLabel}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={goNext}
              aria-label="Sonraki"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button type="button" variant="outline" onClick={goToday}>
              Bugün
            </Button>
          </div>
        }
      />
      <Dialog open={eventDialogOpen} onOpenChange={setEventDialogOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingEventId ? "Planı düzenle" : "Takvime plan ekle"}</DialogTitle>
            <DialogDescription>
              Aynı gün için istediğiniz kadar plan veya not ekleyebilirsiniz.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">
              Başlık
              <Input value={eventForm.title} maxLength={180} placeholder="Örn. Müşteriyle keşif toplantısı" onChange={(event) => setEventForm((form) => ({ ...form, title: event.target.value }))} />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Tarih
              <Input type="date" value={eventForm.scheduledDate} onChange={(event) => setEventForm((form) => ({ ...form, scheduledDate: event.target.value }))} />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Saat (opsiyonel)
              <Input type="time" value={eventForm.scheduledTime} onChange={(event) => setEventForm((form) => ({ ...form, scheduledTime: event.target.value }))} />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Tür
              <Select value={eventForm.eventType} onValueChange={(eventType) => setEventForm((form) => ({ ...form, eventType: eventType as CalendarEventType }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(eventTypeLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Durum
              <Select value={eventForm.status} onValueChange={(status) => setEventForm((form) => ({ ...form, status: status as CalendarEventStatus }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(eventStatusLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">
              Proje (opsiyonel)
              <Select value={eventForm.projectId || "none"} onValueChange={(projectId) => setEventForm((form) => ({ ...form, projectId: projectId === "none" ? "" : projectId }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="none">Proje seçilmedi</SelectItem>{(query.data?.projects ?? []).map((project) => <SelectItem key={project.id} value={project.id}>{project.project_no} · {project.name}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">
              İş emri (opsiyonel)
              <Select value={eventForm.workOrderId || "none"} onValueChange={(workOrderId) => setEventForm((form) => ({ ...form, workOrderId: workOrderId === "none" ? "" : workOrderId }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="none">İş emri seçilmedi</SelectItem>{(query.data?.workOrders ?? []).map((workOrder) => <SelectItem key={workOrder.id} value={workOrder.id}>#{workOrder.work_order_no} · {workOrder.title}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">
              Sorumlu kişi (opsiyonel)
              <Select value={eventForm.responsibleId || "none"} onValueChange={(responsibleId) => setEventForm((form) => ({ ...form, responsibleId: responsibleId === "none" ? "" : responsibleId }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="none">Sorumlu atanmadı</SelectItem>{(query.data?.profiles ?? []).map((profile) => <SelectItem key={profile.id} value={profile.id}>{profile.full_name}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">
              Not
              <Textarea value={eventForm.notes} maxLength={2000} placeholder="Görüşme notu, hazırlık veya hatırlatma..." onChange={(event) => setEventForm((form) => ({ ...form, notes: event.target.value }))} />
            </label>
          </div>
          <DialogFooter><Button onClick={() => saveEvent.mutate()} disabled={saveEvent.isPending}>{saveEvent.isPending ? "Kaydediliyor..." : editingEventId ? "Değişiklikleri Kaydet" : "Planı Kaydet"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="mb-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span
            className={`h-2.5 w-2.5 rounded-full ${legendDotClasses.overdue}`}
          />{" "}
          Geciken
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className={`h-2.5 w-2.5 rounded-full ${legendDotClasses.today}`}
          />{" "}
          Bugün
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className={`h-2.5 w-2.5 rounded-full ${legendDotClasses.future}`}
          />{" "}
          Gelecek
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className={`h-2.5 w-2.5 rounded-full ${legendDotClasses.done}`}
          />{" "}
          Tamamlandı / İptal
        </span>
      </div>

      {query.isLoading ? (
        <LoadingState label="Takvim yükleniyor..." />
      ) : query.error ? (
        <p className="surface-panel p-5 text-destructive">
          {errorMessage(query.error)}
        </p>
      ) : (
        <>
          {/* Ay/hafta grid — dar ekranlarda (mobil) tamamen gizli, yerine
              aşağıdaki agenda listesi gösterilir; grid hiçbir zaman yatay
              kaydırmaya düşmez. */}
          <div className="surface-panel hidden p-2 sm:block sm:p-3">
            <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
              {WEEKDAY_LABELS.map((label) => (
                <div
                  key={label}
                  className="px-1 py-1 text-center text-[10px] font-black uppercase tracking-wide text-muted-foreground sm:text-xs"
                >
                  {label}
                </div>
              ))}
              {cells.map((cell) => {
                const items = itemsByDate.get(cell.key) ?? [];
                const isToday = cell.key === todayKey;
                const visibleItems = items.slice(0, maxVisiblePerCell);
                const hiddenCount = items.length - visibleItems.length;
                return (
                  <div
                    key={cell.key}
                    className={`surface-panel flex min-h-[92px] flex-col gap-1 p-1.5 sm:min-h-[120px] sm:p-2 ${
                      cell.inCurrentMonth ? "" : "opacity-40"
                    } ${isToday ? "border-highlight/60" : ""}`}
                  >
                    {isManager ? (
                      <button type="button" onClick={() => openCreateEvent(cell.key)} className={`w-fit rounded px-1 text-xs font-bold hover:bg-muted ${isToday ? "text-highlight" : "text-muted-foreground"}`}>
                        {cell.date.getDate()}
                      </button>
                    ) : (
                      <span className={`text-xs font-bold ${isToday ? "text-highlight" : "text-muted-foreground"}`}>
                        {cell.date.getDate()}
                      </span>
                    )}
                    <div className="flex flex-col gap-1 overflow-hidden">
                      {visibleItems.map((item) => item.link ? (
                        <Link key={item.id} to={item.link.to} params={item.link.params} hash={item.link.hash} title={item.title} className={`truncate rounded border px-1 py-0.5 text-[10px] font-semibold transition-colors sm:text-[11px] ${colorClasses[item.colorState]}`}>
                          {item.title}
                        </Link>
                      ) : (
                        <button key={item.id} type="button" onClick={() => item.eventId && openEditEvent(item.eventId)} title={item.notes ?? item.title} className={`truncate rounded border px-1 py-0.5 text-left text-[10px] font-semibold transition-colors sm:text-[11px] ${colorClasses[item.colorState]}`}>
                          {item.time ? `${item.time.slice(0, 5)} · ` : ""}{item.title}
                        </button>
                      ))}
                      {hiddenCount > 0 ? (
                        <span className="px-1 text-[10px] text-muted-foreground">
                          +{hiddenCount} tane daha
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Mobil agenda listesi: yalnızca dar ekranlarda görünür, yatay
              kaydırma gerektirmeyen dikey liste. */}
          <div className="flex flex-col gap-3 sm:hidden">
            {agendaDays.length === 0 ? (
              <p className="surface-panel p-5 text-center text-sm text-muted-foreground">
                Bu {view === "week" ? "hafta" : "ay"} planlı kayıt yok.
              </p>
            ) : (
              agendaDays.map((cell) => {
                const items = itemsByDate.get(cell.key) ?? [];
                const isToday = cell.key === todayKey;
                return (
                  <div key={cell.key} className="surface-panel p-3">
                    <p
                      className={`mb-2 text-xs font-black capitalize ${isToday ? "text-highlight" : "text-foreground"}`}
                    >
                      {agendaDateFormatter.format(cell.date)}
                      {isToday ? " · Bugün" : ""}
                    </p>
                    {items.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Planlı iş yok
                      </p>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {items.map((item) => item.link ? (
                          <Link key={item.id} to={item.link.to} params={item.link.params} hash={item.link.hash} className={`truncate rounded border px-2 py-1.5 text-xs font-semibold transition-colors ${colorClasses[item.colorState]}`}>
                            {item.title}
                          </Link>
                        ) : (
                          <button key={item.id} type="button" onClick={() => item.eventId && openEditEvent(item.eventId)} className={`truncate rounded border px-2 py-1.5 text-left text-xs font-semibold transition-colors ${colorClasses[item.colorState]}`}>
                            {item.time ? `${item.time.slice(0, 5)} · ` : ""}{item.title}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </>
  );
}

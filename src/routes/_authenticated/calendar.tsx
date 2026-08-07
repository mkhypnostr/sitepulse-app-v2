import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { errorMessage } from "@/lib/domain";
import { isOperationalManager } from "@/lib/permissions";
import { AccessDenied, LoadingState, PageHeader } from "@/components/page-states";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/calendar")({
  component: CalendarPage,
});

const WEEKDAY_LABELS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
const WORK_ORDER_TERMINAL = new Set(["completed", "cancelled"]);
const TASK_TERMINAL = new Set(["completed", "cancelled", "not_applicable"]);
const WEEKS_SHOWN = 6;
const CELL_COUNT = WEEKS_SHOWN * 7;

type ColorState = "overdue" | "today" | "future" | "done";

type CalendarItem = {
  id: string;
  title: string;
  date: string;
  colorState: ColorState;
  href: string;
};

const colorClasses: Record<ColorState, string> = {
  overdue: "border-destructive/40 bg-destructive/15 text-destructive hover:bg-destructive/25",
  today: "border-warning/40 bg-warning/15 text-warning hover:bg-warning/25",
  future: "border-highlight/40 bg-highlight/15 text-highlight hover:bg-highlight/25",
  done: "border-success/40 bg-success/15 text-success hover:bg-success/25",
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toDateKey(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function colorStateFor(dateKey: string, todayKey: string, terminal: boolean): ColorState {
  if (terminal) return "done";
  if (dateKey < todayKey) return "overdue";
  if (dateKey === todayKey) return "today";
  return "future";
}

function CalendarPage() {
  const { role, user } = useAuth();
  const canView = role === "admin" || role === "technical_office" || role === "contractor";
  const isManager = isOperationalManager(role);
  const isContractor = role === "contractor";

  const now = new Date();
  const [cursor, setCursor] = useState({ year: now.getFullYear(), month: now.getMonth() });

  const { gridStart, gridEnd, cells, monthLabel } = useMemo(() => {
    const monthStart = new Date(cursor.year, cursor.month, 1);
    const startOffset = (monthStart.getDay() + 6) % 7; // Pazartesi = 0
    const start = new Date(cursor.year, cursor.month, 1 - startOffset);
    const end = new Date(start);
    end.setDate(start.getDate() + CELL_COUNT - 1);

    const dayCells = Array.from({ length: CELL_COUNT }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return {
        date,
        key: toDateKey(date),
        inCurrentMonth: date.getMonth() === cursor.month,
      };
    });

    const label = new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" }).format(monthStart);

    return { gridStart: start, gridEnd: end, cells: dayCells, monthLabel: label };
  }, [cursor]);

  const todayKey = toDateKey(now);

  const query = useQuery({
    queryKey: ["calendar-tasks", cursor.year, cursor.month, role, user?.id],
    enabled: canView && Boolean(user?.id),
    queryFn: async () => {
      const gridStartKey = toDateKey(gridStart);
      const gridEndKey = toDateKey(gridEnd);
      const gridEndExclusive = new Date(gridEnd);
      gridEndExclusive.setDate(gridEnd.getDate() + 1);

      const workOrdersQuery = supabase
        .from("work_orders")
        .select("id, title, scheduled_at, status")
        .gte("scheduled_at", gridStart.toISOString())
        .lt("scheduled_at", gridEndExclusive.toISOString());

      let projectTasksQuery = supabase
        .from("project_tasks")
        .select("id, project_id, task_name, planned_date, status, responsible_id")
        .gte("planned_date", gridStartKey)
        .lte("planned_date", gridEndKey);

      let operationalTasksQuery = supabase
        .from("operational_tasks")
        .select("id, title, planned_date, status, assigned_to")
        .gte("planned_date", gridStartKey)
        .lte("planned_date", gridEndKey);

      if (isContractor && user) {
        projectTasksQuery = projectTasksQuery.eq("responsible_id", user.id);
        operationalTasksQuery = operationalTasksQuery.eq("assigned_to", user.id);
      }

      const [workOrdersResult, projectTasksResult, operationalTasksResult] = await Promise.all([
        workOrdersQuery,
        projectTasksQuery,
        operationalTasksQuery,
      ]);
      if (workOrdersResult.error) throw workOrdersResult.error;
      if (projectTasksResult.error) throw projectTasksResult.error;
      if (operationalTasksResult.error) throw operationalTasksResult.error;

      const items: CalendarItem[] = [];

      for (const order of workOrdersResult.data ?? []) {
        if (!order.scheduled_at) continue;
        const dateKey = order.scheduled_at.slice(0, 10);
        items.push({
          id: `wo-${order.id}`,
          title: order.title,
          date: dateKey,
          colorState: colorStateFor(dateKey, todayKey, WORK_ORDER_TERMINAL.has(order.status)),
          href: `/jobs/${order.id}`,
        });
      }

      for (const task of projectTasksResult.data ?? []) {
        if (!task.planned_date) continue;
        items.push({
          id: `pt-${task.id}`,
          title: task.task_name,
          date: task.planned_date,
          colorState: colorStateFor(task.planned_date, todayKey, TASK_TERMINAL.has(task.status)),
          href: isManager ? `/projects/${task.project_id}#task-${task.id}` : "/my-project-tasks",
        });
      }

      for (const task of operationalTasksResult.data ?? []) {
        if (!task.planned_date) continue;
        items.push({
          id: `ot-${task.id}`,
          title: task.title,
          date: task.planned_date,
          colorState: colorStateFor(task.planned_date, todayKey, TASK_TERMINAL.has(task.status)),
          href: isManager ? `/tasks#operational-${task.id}` : "/my-jobs",
        });
      }

      const byDate = new Map<string, CalendarItem[]>();
      for (const item of items) {
        const list = byDate.get(item.date) ?? [];
        list.push(item);
        byDate.set(item.date, list);
      }
      return byDate;
    },
  });

  if (!canView) return <AccessDenied />;

  const itemsByDate = query.data ?? new Map<string, CalendarItem[]>();

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
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() =>
                setCursor((prev) => {
                  const d = new Date(prev.year, prev.month - 1, 1);
                  return { year: d.getFullYear(), month: d.getMonth() };
                })
              }
              aria-label="Önceki ay"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-32 text-center text-sm font-black capitalize">{monthLabel}</span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() =>
                setCursor((prev) => {
                  const d = new Date(prev.year, prev.month + 1, 1);
                  return { year: d.getFullYear(), month: d.getMonth() };
                })
              }
              aria-label="Sonraki ay"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCursor({ year: now.getFullYear(), month: now.getMonth() })}
            >
              Bugün
            </Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-destructive" /> Geciken
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-warning" /> Bugün
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-highlight" /> Gelecek
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-success" /> Tamamlandı
        </span>
      </div>

      {query.isLoading ? (
        <LoadingState label="Takvim yükleniyor..." />
      ) : query.error ? (
        <p className="surface-panel p-5 text-destructive">{errorMessage(query.error)}</p>
      ) : (
        <div className="surface-panel overflow-x-auto p-2 sm:p-3">
          <div className="grid min-w-[560px] grid-cols-7 gap-1.5 sm:gap-2">
            {WEEKDAY_LABELS.map((label) => (
              <div key={label} className="px-1 py-1 text-center text-[10px] font-black uppercase tracking-wide text-muted-foreground sm:text-xs">
                {label}
              </div>
            ))}
            {cells.map((cell) => {
              const items = itemsByDate.get(cell.key) ?? [];
              const isToday = cell.key === todayKey;
              const visibleItems = items.slice(0, 3);
              const hiddenCount = items.length - visibleItems.length;
              return (
                <div
                  key={cell.key}
                  className={`surface-panel flex min-h-[92px] flex-col gap-1 p-1.5 sm:min-h-[120px] sm:p-2 ${
                    cell.inCurrentMonth ? "" : "opacity-40"
                  } ${isToday ? "border-highlight/60" : ""}`}
                >
                  <span className={`text-xs font-bold ${isToday ? "text-highlight" : "text-muted-foreground"}`}>
                    {cell.date.getDate()}
                  </span>
                  <div className="flex flex-col gap-1 overflow-hidden">
                    {visibleItems.map((item) => (
                      <a
                        key={item.id}
                        href={item.href}
                        title={item.title}
                        className={`truncate rounded border px-1 py-0.5 text-[10px] font-semibold transition-colors sm:text-[11px] ${colorClasses[item.colorState]}`}
                      >
                        {item.title}
                      </a>
                    ))}
                    {hiddenCount > 0 ? (
                      <span className="px-1 text-[10px] text-muted-foreground">+{hiddenCount} tane daha</span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

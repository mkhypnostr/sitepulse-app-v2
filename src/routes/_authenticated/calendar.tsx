import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
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
  link: LinkTarget;
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

function CalendarPage() {
  const { role, user } = useAuth();
  const canView =
    role === "admin" || role === "technical_office" || role === "contractor";
  const isManager = isOperationalManager(role);
  const isContractor = role === "contractor";

  const [view, setView] = useState<ViewMode>("month");
  const [anchor, setAnchor] = useState(() => new Date());
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

      const [workOrdersResult, projectTasksResult, operationalTasksResult] =
        await Promise.all([
          workOrdersQuery,
          projectTasksQuery,
          operationalTasksQuery,
        ]);
      if (workOrdersResult.error) throw workOrdersResult.error;
      if (projectTasksResult.error) throw projectTasksResult.error;
      if (operationalTasksResult.error) throw operationalTasksResult.error;

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
                    <span
                      className={`text-xs font-bold ${isToday ? "text-highlight" : "text-muted-foreground"}`}
                    >
                      {cell.date.getDate()}
                    </span>
                    <div className="flex flex-col gap-1 overflow-hidden">
                      {visibleItems.map((item) => (
                        <Link
                          key={item.id}
                          to={item.link.to}
                          params={item.link.params}
                          hash={item.link.hash}
                          title={item.title}
                          className={`truncate rounded border px-1 py-0.5 text-[10px] font-semibold transition-colors sm:text-[11px] ${colorClasses[item.colorState]}`}
                        >
                          {item.title}
                        </Link>
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
                        {items.map((item) => (
                          <Link
                            key={item.id}
                            to={item.link.to}
                            params={item.link.params}
                            hash={item.link.hash}
                            className={`truncate rounded border px-2 py-1.5 text-xs font-semibold transition-colors ${colorClasses[item.colorState]}`}
                          >
                            {item.title}
                          </Link>
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

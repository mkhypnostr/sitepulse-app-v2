// Önümüzdeki günlerin takvim kayıtlarını, görevlerini, iş emirlerini ve
// satış adımlarını bağlı Google hesabının takvimine gönderir.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck2, CalendarPlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/domain";
import {
  createGoogleCalendarEvent,
  getGoogleWorkspaceStatus,
  startGoogleWorkspaceConnection,
} from "@/lib/google-workspace";
import { todayIso } from "@/lib/sales";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type SourceType =
  | "calendar_event"
  | "operational_task"
  | "project_task"
  | "work_order"
  | "lead_action";

type SyncItem = {
  key: string;
  sourceType: SourceType;
  sourceId: string;
  date: string;
  /** "SS:DD" veya null (saat yoksa 09:00). */
  time: string | null;
  title: string;
  kindLabel: string;
  description?: string;
  linked: boolean;
};

const kindLabels: Record<SourceType, string> = {
  calendar_event: "Takvim",
  operational_task: "Görev",
  project_task: "Proje görevi",
  work_order: "İş emri",
  lead_action: "Satış",
};

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return todayIso(d);
}

function plusMinutes(time: string, minutes: number) {
  const [h, m] = time.split(":").map(Number);
  const total = Math.min(23 * 60 + 59, h * 60 + m + minutes);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function GoogleCalendarSync() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState("14");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const status = useQuery({
    queryKey: ["google-workspace-status"],
    enabled: open,
    staleTime: 5 * 60 * 1000,
    queryFn: getGoogleWorkspaceStatus,
  });

  const itemsQuery = useQuery({
    queryKey: ["google-sync-items", days],
    enabled: open,
    queryFn: async () => {
      const from = todayIso();
      const to = addDays(from, Number(days));
      const [events, opTasks, projTasks, orders, leads, links] =
        await Promise.all([
          supabase
            .from("calendar_events")
            .select("id, title, scheduled_date, scheduled_time, notes, status")
            .gte("scheduled_date", from)
            .lte("scheduled_date", to)
            .neq("status", "cancelled"),
          supabase
            .from("operational_tasks")
            .select("id, title, description, planned_date, status")
            .gte("planned_date", from)
            .lte("planned_date", to)
            .not("status", "in", "(completed,not_applicable)"),
          supabase
            .from("project_tasks")
            .select("id, task_name, planned_date, status")
            .gte("planned_date", from)
            .lte("planned_date", to)
            .not("status", "in", "(completed,not_applicable)"),
          supabase
            .from("work_orders")
            .select("id, title, scheduled_at, status, location")
            .gte("scheduled_at", `${from}T00:00:00`)
            .lte("scheduled_at", `${to}T23:59:59`)
            .not("status", "in", "(draft,completed,cancelled)"),
          supabase
            .from("sales_leads")
            .select("id, title, next_action, next_action_at, phone, location")
            .gte("next_action_at", from)
            .lte("next_action_at", to)
            .not("stage", "in", "(kazanildi,kaybedildi)"),
          supabase
            .from("google_calendar_links")
            .select("source_type, source_id, source_date")
            .gte("source_date", from),
        ]);
      for (const r of [events, opTasks, projTasks, orders, leads, links]) {
        if (r.error) throw r.error;
      }
      const linked = new Set(
        (links.data ?? []).map(
          (l) => `${l.source_type}:${l.source_id}:${l.source_date}`,
        ),
      );
      const items: SyncItem[] = [];
      const push = (item: Omit<SyncItem, "key" | "linked">) => {
        const key = `${item.sourceType}:${item.sourceId}:${item.date}`;
        items.push({ ...item, key, linked: linked.has(key) });
      };
      for (const e of events.data ?? []) {
        push({
          sourceType: "calendar_event",
          sourceId: e.id,
          date: e.scheduled_date,
          time: e.scheduled_time?.slice(0, 5) ?? null,
          title: e.title,
          kindLabel: kindLabels.calendar_event,
          description: e.notes ?? undefined,
        });
      }
      for (const t of opTasks.data ?? []) {
        if (!t.planned_date) continue;
        push({
          sourceType: "operational_task",
          sourceId: t.id,
          date: t.planned_date,
          time: null,
          title: t.title,
          kindLabel: kindLabels.operational_task,
          description: t.description ?? undefined,
        });
      }
      for (const t of projTasks.data ?? []) {
        if (!t.planned_date) continue;
        push({
          sourceType: "project_task",
          sourceId: t.id,
          date: t.planned_date,
          time: null,
          title: t.task_name,
          kindLabel: kindLabels.project_task,
        });
      }
      for (const o of orders.data ?? []) {
        if (!o.scheduled_at) continue;
        const local = new Date(o.scheduled_at);
        push({
          sourceType: "work_order",
          sourceId: o.id,
          date: todayIso(local),
          time: `${String(local.getHours()).padStart(2, "0")}:${String(local.getMinutes()).padStart(2, "0")}`,
          title: o.title,
          kindLabel: kindLabels.work_order,
          description: o.location ?? undefined,
        });
      }
      for (const l of leads.data ?? []) {
        if (!l.next_action_at) continue;
        push({
          sourceType: "lead_action",
          sourceId: l.id,
          date: l.next_action_at,
          time: null,
          title: `${l.next_action || "Satış takibi"} — ${l.title}`,
          kindLabel: kindLabels.lead_action,
          description: [l.phone ? `Tel: ${l.phone}` : "", l.location ?? ""]
            .filter(Boolean)
            .join("\n"),
        });
      }
      items.sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          (a.time ?? "09:00").localeCompare(b.time ?? "09:00"),
      );
      return items;
    },
  });

  const items = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data]);
  // Liste her yüklendiğinde henüz gönderilmemişleri seçili getir.
  useEffect(() => {
    setSelected(new Set(items.filter((i) => !i.linked).map((i) => i.key)));
  }, [items]);

  const send = useMutation({
    mutationFn: async () => {
      const chosen = items.filter((i) => selected.has(i.key) && !i.linked);
      let ok = 0;
      const failures: string[] = [];
      for (const item of chosen) {
        const start = item.time ?? "09:00";
        try {
          const result = await createGoogleCalendarEvent({
            summary: `[NES] ${item.title}`.slice(0, 180),
            description: [
              item.description,
              `${item.kindLabel} kaydı — app.nesgrup.com`,
            ]
              .filter(Boolean)
              .join("\n\n"),
            start: `${item.date}T${start}:00`,
            end: `${item.date}T${plusMinutes(start, item.time ? 60 : 30)}:00`,
          });
          const { error } = await supabase
            .from("google_calendar_links")
            .insert({
              source_type: item.sourceType,
              source_id: item.sourceId,
              source_date: item.date,
              google_event_id: result.event_id,
              google_event_url: result.event_url ?? null,
            });
          if (error) throw error;
          ok += 1;
        } catch (error) {
          failures.push(`${item.title}: ${errorMessage(error)}`);
        }
      }
      return { ok, failures };
    },
    onSuccess: async ({ ok, failures }) => {
      await queryClient.invalidateQueries({ queryKey: ["google-sync-items"] });
      if (ok > 0) toast.success(`${ok} kayıt Google Takvim'e eklendi.`);
      if (failures.length > 0) {
        toast.error(`${failures.length} kayıt eklenemedi. ${failures[0]}`);
      }
      if (ok === 0 && failures.length === 0) {
        toast.message("Gönderilecek yeni kayıt seçilmedi.");
      }
    },
  });

  const connected = status.data?.connected;
  const pending = items.filter((i) => !i.linked);

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <CalendarPlus className="mr-2 h-4 w-4" /> Google Takvim
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Google Takvim'e gönder</DialogTitle>
            <DialogDescription>
              Önümüzdeki günlerin takvim kayıtları, görevler, iş emirleri ve
              satış adımları bağlı Google hesabının takvimine eklenir. Daha önce
              gönderilenler tekrar gönderilmez. Uygulamada sonradan yapılan
              tarih değişiklikleri Google'a kendiliğinden yansımaz; yeni tarih
              için kayıt yeniden gönderilir.
            </DialogDescription>
          </DialogHeader>

          {status.isLoading ? (
            <p className="text-sm text-muted-foreground">
              Google bağlantısı kontrol ediliyor...
            </p>
          ) : status.error ? (
            <p className="text-sm text-destructive">
              {errorMessage(status.error)}
            </p>
          ) : !connected ? (
            <div className="space-y-2 rounded-md bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
              <p>
                Google hesabı bağlı değil. Aşağıdaki düğmeyle nesgrup.com
                hesabınızı bağlayın; Google onayından sonra bu pencereyi yeniden
                açın.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    const url = await startGoogleWorkspaceConnection();
                    window.open(url, "_blank", "noopener");
                  } catch (error) {
                    toast.error(errorMessage(error));
                  }
                }}
              >
                Google hesabını bağla
              </Button>
            </div>
          ) : (
            <p className="text-sm">
              Bağlı hesap: <b>{status.data?.google_account}</b>
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger className="h-9 w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Önümüzdeki 7 gün</SelectItem>
                <SelectItem value="14">Önümüzdeki 14 gün</SelectItem>
                <SelectItem value="30">Önümüzdeki 30 gün</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setSelected(new Set(pending.map((i) => i.key)))}
            >
              Tümünü seç
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setSelected(new Set())}
            >
              Hiçbiri
            </Button>
          </div>

          {itemsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Yükleniyor...</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Bu aralıkta tarihli kayıt yok.
            </p>
          ) : (
            <div className="grid gap-1">
              {items.map((item) => (
                <label
                  key={item.key}
                  className={`flex items-start gap-2 rounded-md p-2 text-sm hover:bg-muted ${item.linked ? "opacity-60" : ""}`}
                >
                  {item.linked ? (
                    <CalendarCheck2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  ) : (
                    <Checkbox
                      checked={selected.has(item.key)}
                      onCheckedChange={(checked) =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (checked) next.add(item.key);
                          else next.delete(item.key);
                          return next;
                        })
                      }
                      className="mt-0.5"
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{item.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {item.date.split("-").reverse().join(".")}{" "}
                      {item.time ?? "(saat yok → 09:00)"} · {item.kindLabel}
                      {item.linked ? " · takvimde" : ""}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Kapat
            </Button>
            <Button
              onClick={() => send.mutate()}
              disabled={
                !connected ||
                send.isPending ||
                pending.filter((i) => selected.has(i.key)).length === 0
              }
            >
              {send.isPending
                ? "Gönderiliyor..."
                : `${pending.filter((i) => selected.has(i.key)).length} kaydı gönder`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

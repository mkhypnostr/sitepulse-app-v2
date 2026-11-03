import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightToLine,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/domain";
import { toWeekKey } from "@/lib/week-key";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

// Takvimin haftalık notları: günü belli olmayan ama o hafta yapılacak işler.
// Yalnız yönetici ve teknik ofis görür (RLS). Geçmiş haftalardan tamamlanmamış
// notlar seçili haftada "devreden" olarak görünür ve tek dokunuşla bu haftaya
// alınabilir; böylece unutulmaz.

type WeekNote = {
  id: string;
  week_start: string;
  body: string;
  is_done: boolean;
  created_at: string;
};

function shiftWeek(key: string, weeks: number) {
  const [y, m, d] = key.split("-").map(Number);
  return toWeekKey(new Date(y, m - 1, d + weeks * 7));
}

function weekLabel(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  const start = new Date(y, m - 1, d);
  const end = new Date(y, m - 1, d + 6);
  const fmt = new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "short",
  });
  return `${fmt.format(start)} – ${fmt.format(end)}`;
}

function weeksBetween(from: string, to: string) {
  const a = new Date(`${from}T00:00:00`).getTime();
  const b = new Date(`${to}T00:00:00`).getTime();
  return Math.round((b - a) / (7 * 24 * 3600 * 1000));
}

export function WeeklyNotes({ initialWeek }: { initialWeek: string }) {
  const qc = useQueryClient();
  const [week, setWeek] = useState(initialWeek);
  const [draft, setDraft] = useState("");
  const thisWeek = toWeekKey(new Date());
  const queryKey = ["calendar-week-notes", week];

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const [own, carried] = await Promise.all([
        supabase
          .from("calendar_week_notes")
          .select("id, week_start, body, is_done, created_at")
          .eq("week_start", week)
          .order("is_done")
          .order("created_at"),
        supabase
          .from("calendar_week_notes")
          .select("id, week_start, body, is_done, created_at")
          .lt("week_start", week)
          .eq("is_done", false)
          .order("week_start")
          .order("created_at")
          .limit(50),
      ]);
      if (own.error) throw own.error;
      if (carried.error) throw carried.error;
      return {
        own: (own.data ?? []) as WeekNote[],
        // Devredenler yalnız bu hafta ve sonrası için anlamlı; geçmiş bir
        // haftaya bakarken o haftanın kendi listesi yeterli.
        carried: week >= thisWeek ? ((carried.data ?? []) as WeekNote[]) : [],
      };
    },
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["calendar-week-notes"] });

  const add = useMutation({
    mutationFn: async (body: string) => {
      const { error } = await supabase
        .from("calendar_week_notes")
        .insert({ week_start: week, body });
      if (error) throw error;
    },
    onSuccess: async () => {
      setDraft("");
      await invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const update = useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: { is_done?: boolean; week_start?: string };
    }) => {
      const { data: auth } = await supabase.auth.getUser();
      const values: {
        is_done?: boolean;
        week_start?: string;
        updated_at: string;
        done_at?: string | null;
        done_by?: string | null;
      } = { ...patch, updated_at: new Date().toISOString() };
      if (patch.is_done !== undefined) {
        values.done_at = patch.is_done ? new Date().toISOString() : null;
        values.done_by = patch.is_done ? (auth.user?.id ?? null) : null;
      }
      const { error } = await supabase
        .from("calendar_week_notes")
        .update(values)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e) => toast.error(errorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: async (note: WeekNote) => {
      const { error } = await supabase
        .from("calendar_week_notes")
        .delete()
        .eq("id", note.id);
      if (error) throw error;
      return note;
    },
    onSuccess: async (note) => {
      await invalidate();
      toast("Not silindi", {
        action: {
          label: "Geri al",
          onClick: () =>
            void supabase
              .from("calendar_week_notes")
              .insert({
                week_start: note.week_start,
                body: note.body,
                is_done: note.is_done,
              })
              .then(({ error }) => {
                if (error) toast.error(errorMessage(error));
                else void invalidate();
              }),
        },
      });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  function submit() {
    const body = draft.trim();
    if (!body || add.isPending) return;
    add.mutate(body.slice(0, 500));
  }

  const own = query.data?.own ?? [];
  const carried = query.data?.carried ?? [];
  const openCount = own.filter((n) => !n.is_done).length + carried.length;

  return (
    <section className="surface-panel mb-4 p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-bold">
            Haftanın notları
            {openCount ? (
              <span className="ml-2 rounded-full bg-highlight/15 px-2 py-0.5 text-xs font-semibold text-highlight">
                {openCount} açık
              </span>
            ) : null}
          </h2>
          <p className="text-xs text-muted-foreground">
            Günü belli olmayan, bu hafta yapılacak işler. Yalnız NES ekibi
            görür.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9"
            aria-label="Önceki hafta"
            onClick={() => setWeek((w) => shiftWeek(w, -1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <button
            type="button"
            className="min-w-32 rounded-md px-2 text-center text-sm font-semibold"
            onClick={() => setWeek(thisWeek)}
            title="Bu haftaya dön"
          >
            {week === thisWeek ? "Bu hafta" : weekLabel(week)}
          </button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9"
            aria-label="Sonraki hafta"
            onClick={() => setWeek((w) => shiftWeek(w, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Input
          value={draft}
          maxLength={500}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="örn. Zeybek'ten kablo siparişini kesinleştir"
          className="h-11 text-base"
          aria-label="Haftalık not"
        />
        <Button
          type="submit"
          className="h-11 shrink-0"
          disabled={!draft.trim() || add.isPending}
        >
          <Plus className="mr-1 h-4 w-4" /> Ekle
        </Button>
      </form>

      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">Notlar yükleniyor...</p>
      ) : query.error ? (
        <p className="text-sm text-destructive">{errorMessage(query.error)}</p>
      ) : own.length === 0 && carried.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Bu hafta için not yok. Yukarıdan ekleyin.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {carried.map((note) => (
            <li key={note.id} className="flex items-start gap-3 py-2">
              <Checkbox
                className="mt-1"
                checked={false}
                aria-label="Tamamlandı"
                onCheckedChange={() =>
                  update.mutate({ id: note.id, patch: { is_done: true } })
                }
              />
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-wrap break-words text-sm">
                  {note.body}
                </p>
                <p className="text-xs text-warning">
                  {weeksBetween(note.week_start, week)} hafta önceden devreden
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 shrink-0"
                onClick={() =>
                  update.mutate({ id: note.id, patch: { week_start: week } })
                }
              >
                <ArrowRightToLine className="mr-1 h-4 w-4" /> Bu haftaya al
              </Button>
            </li>
          ))}
          {own.map((note) => (
            <li key={note.id} className="flex items-start gap-3 py-2">
              <Checkbox
                className="mt-1"
                checked={note.is_done}
                aria-label="Tamamlandı"
                onCheckedChange={(v) =>
                  update.mutate({
                    id: note.id,
                    patch: { is_done: v === true },
                  })
                }
              />
              <p
                className={`min-w-0 flex-1 whitespace-pre-wrap break-words text-sm ${
                  note.is_done ? "text-muted-foreground line-through" : ""
                }`}
              >
                {note.body}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0 text-muted-foreground"
                aria-label="Notu sil"
                onClick={() => remove.mutate(note)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

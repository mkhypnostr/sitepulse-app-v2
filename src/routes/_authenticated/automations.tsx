import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Play, Plus, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { errorMessage } from "@/lib/domain";
import {
  assignModes,
  DATE_TRIGGERS,
  describeRule,
  triggerTypes,
  triggerValues,
  type AssignMode,
  type TriggerType,
} from "@/lib/automation";
import {
  AccessDenied,
  LoadingState,
  PageHeader,
} from "@/components/page-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/automations")({
  component: AutomationsPage,
});

type Rule = {
  id: string;
  name: string;
  is_active: boolean;
  trigger_type: TriggerType;
  trigger_value: string | null;
  offset_days: number;
  task_title: string;
  task_description: string | null;
  assign_mode: AssignMode;
  assignee_id: string | null;
};

type Draft = Omit<Rule, "id"> & { id?: string };

const emptyDraft: Draft = {
  name: "",
  is_active: true,
  trigger_type: "offer_status",
  trigger_value: "sent",
  offset_days: 3,
  task_title: "",
  task_description: "",
  assign_mode: "owner",
  assignee_id: null,
};

function Labeled({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1 text-sm font-medium">
      {label}
      {children}
      {hint ? (
        <span className="text-xs font-normal text-muted-foreground">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

function AutomationsPage() {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);

  const pageQuery = useQuery({
    queryKey: ["automations-page"],
    enabled: isAdmin,
    queryFn: async () => {
      const [rulesResult, runsResult, teamResult] = await Promise.all([
        supabase
          .from("automation_rules")
          .select(
            "id, name, is_active, trigger_type, trigger_value, offset_days, task_title, task_description, assign_mode, assignee_id",
          )
          .order("created_at"),
        supabase
          .from("automation_runs")
          .select("rule_id, fired_at")
          .order("fired_at", { ascending: false })
          .limit(1000),
        supabase.rpc("list_project_assignees"),
      ]);
      if (rulesResult.error) throw rulesResult.error;
      if (runsResult.error) throw runsResult.error;
      const stats = new Map<string, { count: number; last: string }>();
      for (const run of runsResult.data ?? []) {
        const s = stats.get(run.rule_id);
        if (s) s.count += 1;
        else stats.set(run.rule_id, { count: 1, last: run.fired_at });
      }
      return {
        rules: (rulesResult.data ?? []) as Rule[],
        stats,
        team: (teamResult.data ?? []).filter(
          (m) => m.role === "admin" || m.role === "technical_office",
        ),
      };
    },
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["automations-page"] });

  const save = useMutation({
    mutationFn: async (d: Draft) => {
      if (d.name.trim().length < 2) throw new Error("Kural adı yazın.");
      if (d.task_title.trim().length < 2) throw new Error("Görev adı yazın.");
      const isDate = DATE_TRIGGERS.includes(d.trigger_type);
      if (!isDate && !d.trigger_value) throw new Error("Durumu seçin.");
      if (d.assign_mode === "user" && !d.assignee_id) {
        throw new Error("Görevin atanacağı kişiyi seçin.");
      }
      const row = {
        name: d.name.trim(),
        is_active: d.is_active,
        trigger_type: d.trigger_type,
        trigger_value: isDate ? null : d.trigger_value,
        offset_days: Math.max(0, Math.min(365, Math.round(d.offset_days))),
        task_title: d.task_title.trim(),
        task_description: d.task_description?.trim() || null,
        assign_mode: d.assign_mode,
        assignee_id: d.assign_mode === "user" ? d.assignee_id : null,
      };
      const { error } = d.id
        ? await supabase.from("automation_rules").update(row).eq("id", d.id)
        : await supabase.from("automation_rules").insert(row);
      if (error) throw error;
    },
    onSuccess: async () => {
      await refresh();
      setDraft(null);
      toast.success("Kural kaydedildi.");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const toggle = useMutation({
    mutationFn: async (rule: Rule) => {
      const { error } = await supabase
        .from("automation_rules")
        .update({ is_active: !rule.is_active })
        .eq("id", rule.id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (error) => toast.error(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: async (rule: Rule) => {
      const { error } = await supabase
        .from("automation_rules")
        .delete()
        .eq("id", rule.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await refresh();
      toast.success("Kural silindi. Açılmış görevler yerinde kalır.");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const runNow = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("run_automations_now");
      if (error) throw error;
      return data ?? 0;
    },
    onSuccess: async (count) => {
      await refresh();
      await queryClient.invalidateQueries({ queryKey: ["sidebar-badges"] });
      toast.success(
        count > 0
          ? `${count} yeni görev açıldı (Görevler ekranında).`
          : "Tarihi gelen yeni görev yok.",
      );
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (!isAdmin) return <AccessDenied />;
  if (pageQuery.isLoading) return <LoadingState />;
  if (pageQuery.error) {
    return (
      <div className="surface-panel p-6 text-sm text-destructive">
        {errorMessage(pageQuery.error)}
      </div>
    );
  }

  const rules = pageQuery.data?.rules ?? [];
  const isDate = draft ? DATE_TRIGGERS.includes(draft.trigger_type) : false;

  return (
    <>
      <PageHeader
        title="Otomatik Görevler"
        description="Bir teklif, fırsat, proje veya servis talebi belirli bir duruma gelince ya da bir sözleşme/teklif süresi dolmadan önce Görevler ekranına kendiliğinden görev açılır. Atanan kişiye mevcut görev bildirimi gider."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="h-11"
              onClick={() => runNow.mutate()}
              disabled={runNow.isPending}
              title="Tarih kurallarını (sözleşme ve teklif süresi) şimdi kontrol eder; normalde her sabah 08:00'de çalışır."
            >
              <Play className="mr-2 h-4 w-4" />
              {runNow.isPending
                ? "Kontrol ediliyor..."
                : "Tarih kurallarını şimdi çalıştır"}
            </Button>
            <Button
              className="h-11 font-bold"
              onClick={() => setDraft(emptyDraft)}
            >
              <Plus className="mr-2 h-4 w-4" /> Yeni kural
            </Button>
          </div>
        }
      />

      <div className="grid gap-3">
        {rules.map((rule) => {
          const stat = pageQuery.data?.stats.get(rule.id);
          return (
            <div
              key={rule.id}
              className={`surface-panel flex flex-col gap-3 p-4 sm:flex-row sm:items-center ${rule.is_active ? "" : "opacity-60"}`}
            >
              <Switch
                checked={rule.is_active}
                onCheckedChange={() => toggle.mutate(rule)}
                aria-label="Kuralı aç/kapat"
              />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-bold">
                  <Zap className="h-4 w-4 text-amber-500" /> {rule.name}
                  {!rule.is_active ? (
                    <Badge variant="outline">Kapalı</Badge>
                  ) : null}
                </p>
                <p className="mt-0.5 text-sm">
                  {describeRule(rule)} →{" "}
                  <span className="font-semibold">{rule.task_title}</span>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Atanan:{" "}
                  {rule.assign_mode === "user"
                    ? (pageQuery.data?.team.find(
                        (m) => m.id === rule.assignee_id,
                      )?.full_name ?? "seçili kişi")
                    : rule.assign_mode === "owner"
                      ? "kaydın sahibi"
                      : "atanmıyor"}
                  {stat
                    ? ` · ${stat.count} görev açtı, son ${new Date(stat.last).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`
                    : " · henüz görev açmadı"}
                </p>
              </div>
              <div className="flex gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setDraft({
                      ...rule,
                      task_description: rule.task_description ?? "",
                    })
                  }
                >
                  <Pencil className="mr-1.5 h-3.5 w-3.5" /> Düzenle
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => {
                    if (window.confirm(`"${rule.name}" silinsin mi?`)) {
                      remove.mutate(rule);
                    }
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          );
        })}
        {rules.length === 0 ? (
          <p className="text-sm text-muted-foreground">Henüz kural yok.</p>
        ) : null}
      </div>

      <Dialog open={Boolean(draft)} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {draft?.id ? "Kuralı düzenle" : "Yeni kural"}
            </DialogTitle>
            <DialogDescription>
              Görev adında {"{ad}"} yazarsanız kaydın adı (teklif no, proje adı,
              müşteri) yerine konur.
            </DialogDescription>
          </DialogHeader>
          {draft ? (
            <div className="grid gap-3">
              <Labeled label="Kural adı">
                <Input
                  value={draft.name}
                  maxLength={120}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </Labeled>
              <Labeled label="Ne zaman">
                <Select
                  value={draft.trigger_type}
                  onValueChange={(v) => {
                    const type = v as TriggerType;
                    const first = Object.keys(triggerValues[type])[0] ?? null;
                    setDraft({
                      ...draft,
                      trigger_type: type,
                      trigger_value: DATE_TRIGGERS.includes(type)
                        ? null
                        : first,
                    });
                  }}
                >
                  <SelectTrigger className="h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(triggerTypes).map(([v, l]) => (
                      <SelectItem key={v} value={v}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Labeled>
              {!isDate ? (
                <Labeled label="Durum">
                  <Select
                    value={draft.trigger_value ?? ""}
                    onValueChange={(v) =>
                      setDraft({ ...draft, trigger_value: v })
                    }
                  >
                    <SelectTrigger className="h-10">
                      <SelectValue placeholder="Seçin" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(triggerValues[draft.trigger_type]).map(
                        ([v, l]) => (
                          <SelectItem key={v} value={v}>
                            {l}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </Labeled>
              ) : null}
              <Labeled
                label={isDate ? "Kaç gün önce" : "Kaç gün sonra"}
                hint={
                  isDate
                    ? "Bitiş tarihine bu kadar gün kala, her sabah yapılan kontrolde görev açılır."
                    : "0 = durum değiştiği gün. Görevin planlanan tarihi bu kadar gün sonraya yazılır."
                }
              >
                <Input
                  type="number"
                  min={0}
                  max={365}
                  value={draft.offset_days}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      offset_days: Number(e.target.value) || 0,
                    })
                  }
                />
              </Labeled>
              <Labeled
                label="Açılacak görev"
                hint="Ör. Teklif dönüşü için ara: {ad}"
              >
                <Input
                  value={draft.task_title}
                  maxLength={200}
                  onChange={(e) =>
                    setDraft({ ...draft, task_title: e.target.value })
                  }
                />
              </Labeled>
              <Labeled label="Görev açıklaması (isteğe bağlı)">
                <Textarea
                  rows={2}
                  maxLength={2000}
                  value={draft.task_description ?? ""}
                  onChange={(e) =>
                    setDraft({ ...draft, task_description: e.target.value })
                  }
                />
              </Labeled>
              <Labeled label="Kime atansın">
                <Select
                  value={draft.assign_mode}
                  onValueChange={(v) =>
                    setDraft({ ...draft, assign_mode: v as AssignMode })
                  }
                >
                  <SelectTrigger className="h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(assignModes).map(([v, l]) => (
                      <SelectItem key={v} value={v}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Labeled>
              {draft.assign_mode === "user" ? (
                <Labeled label="Kişi">
                  <Select
                    value={draft.assignee_id ?? ""}
                    onValueChange={(v) =>
                      setDraft({ ...draft, assignee_id: v })
                    }
                  >
                    <SelectTrigger className="h-10">
                      <SelectValue placeholder="Seçin" />
                    </SelectTrigger>
                    <SelectContent>
                      {(pageQuery.data?.team ?? []).map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Labeled>
              ) : null}
              <label className="flex items-center gap-3 text-sm font-medium">
                <Switch
                  checked={draft.is_active}
                  onCheckedChange={(is_active) =>
                    setDraft({ ...draft, is_active })
                  }
                />
                Kural açık
              </label>
              <p className="rounded-md bg-muted p-2 text-xs">
                Özet: {describeRule(draft)} → "{draft.task_title || "…"}"
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setDraft(null)}>
                  Vazgeç
                </Button>
                <Button
                  onClick={() => save.mutate(draft)}
                  disabled={save.isPending}
                >
                  {save.isPending ? "Kaydediliyor..." : "Kaydet"}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

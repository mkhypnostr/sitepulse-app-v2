import type { Database } from "@/integrations/supabase/types";

export type ProjectType = Database["public"]["Enums"]["project_type"];
export type ProjectStatus = Database["public"]["Enums"]["project_status"];
export type ProjectTaskStatus = Database["public"]["Enums"]["project_task_status"];

export const projectTypeOptions: Array<{
  value: ProjectType;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  {
    value: "electric_permit",
    label: "Elektrik Ruhsat Projesi",
    shortLabel: "Elektrik Ruhsat",
    description: "Belge toplama, proje çizimi, kurum onayları ve ruhsat süreci.",
  },
  {
    value: "site_project",
    label: "Şantiye Projesi",
    shortLabel: "Şantiye",
    description: "Saha metrajı, başvurular, sayaç ve tesisat kontrolleri.",
  },
  {
    value: "connection_line",
    label: "Bağlantı Hattı Projesi",
    shortLabel: "Bağlantı Hattı",
    description: "Bağlantı görüşü, proje çizimi, sayaç ve kontrol adımları.",
  },
];

export const projectStatusOptions: Array<{ value: ProjectStatus; label: string }> = [
  { value: "draft", label: "Taslak" },
  { value: "active", label: "Devam Ediyor" },
  { value: "on_hold", label: "Beklemede" },
  { value: "completed", label: "Tamamlandı" },
  { value: "cancelled", label: "İptal Edildi" },
];

export const projectTaskStatusOptions: Array<{
  value: ProjectTaskStatus;
  label: string;
}> = [
  { value: "not_started", label: "Başlanmadı" },
  { value: "in_progress", label: "Devam Ediyor" },
  { value: "external_approval", label: "Dış Onay Bekliyor" },
  { value: "revision_required", label: "Revizyon Gerekli" },
  { value: "blocked", label: "Engellendi" },
  { value: "completed", label: "Tamamlandı" },
  { value: "not_applicable", label: "Uygulanmayacak" },
];

export const projectTypeLabel = Object.fromEntries(
  projectTypeOptions.map((item) => [item.value, item.shortLabel]),
) as Record<ProjectType, string>;

export const projectStatusLabel = Object.fromEntries(
  projectStatusOptions.map((item) => [item.value, item.label]),
) as Record<ProjectStatus, string>;

export const projectTaskStatusLabel = Object.fromEntries(
  projectTaskStatusOptions.map((item) => [item.value, item.label]),
) as Record<ProjectTaskStatus, string>;

export const taskStatusClass: Record<ProjectTaskStatus, string> = {
  not_started: "border-border bg-muted/40 text-muted-foreground",
  in_progress: "border-blue-500/30 bg-blue-500/15 text-blue-300",
  external_approval: "border-amber-500/30 bg-amber-500/15 text-amber-300",
  revision_required: "border-orange-500/30 bg-orange-500/15 text-orange-300",
  blocked: "border-red-500/30 bg-red-500/15 text-red-300",
  completed: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300",
  not_applicable: "border-slate-500/30 bg-slate-500/15 text-slate-300",
};

export function formatProjectDate(value: string | null | undefined) {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(
    new Date(year, month - 1, day),
  );
}

export function formatProjectDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function projectProgress(statuses: ProjectTaskStatus[]) {
  const applicable = statuses.filter((status) => status !== "not_applicable");
  const completed = applicable.filter((status) => status === "completed").length;
  return {
    completed,
    total: applicable.length,
    percentage: applicable.length ? Math.round((completed / applicable.length) * 100) : 0,
  };
}

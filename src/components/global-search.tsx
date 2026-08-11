import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ClipboardList,
  FolderKanban,
  ListChecks,
  UsersRound,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { isOperationalManager } from "@/lib/permissions";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 300;
const RESULT_LIMIT = 5;

type ResultType = "work_order" | "task" | "project" | "customer";

type LinkTarget = {
  to: string;
  params?: Record<string, string>;
  hash?: string;
};

type SearchResult = {
  id: string;
  type: ResultType;
  title: string;
  subtitle?: string;
  link: LinkTarget;
};

const typeLabels: Record<ResultType, string> = {
  work_order: "İş Emri",
  task: "Görev",
  project: "Proje",
  customer: "Müşteri",
};

const typeIcons: Record<ResultType, typeof ListChecks> = {
  work_order: ListChecks,
  task: ClipboardList,
  project: FolderKanban,
  customer: UsersRound,
};

// PostgreSQL, "İ" (U+0130, Turkish nokta İ) karakterini lower()/ILIKE
// altında ASCII "i"ye değil, ayrışık "i" + combining-dot-above dizisine
// katlar (en_US.UTF-8 dahil, tr_TR'ye özgü olmayan tüm locale'lerde).
// Sonuç: normal klavyeyle yazılan "bobin", başlığı "BOBİN..." olan bir
// kayıtla ILIKE üzerinden hiçbir zaman eşleşmez (canlı veride doğrulandı:
// 'BOBİN DEĞİŞİMİ' ilike '%bobin%' → false). Ğ/Ş/Ü/Ö/Ç için bu sorun yok,
// onlar cross-case doğru katlanıyor.
// Çözüm: ILIKE yerine Postgres'in case-insensitive regex operatörünü
// (~*, PostgREST'te "imatch") kullanıp yalnızca i-ailesini (i/I/İ/ı)
// locale'den bağımsız, açık bir karakter sınıfıyla eşliyoruz. Regex
// olduğu için % / _ kaçışına gerek yok; genel regex özel karakterlerini
// (., *, +, ?, ^, $, (, ), [, ], {, }, |, \) kaçışlamak yeterli.
const REGEX_SPECIAL_CHARS = /[.*+?^${}()|[\]\\]/g;

function toTurkishSafePattern(term: string): string {
  const escaped = term.replace(REGEX_SPECIAL_CHARS, "\\$&");
  return escaped.replace(/[iIİı]/g, "[iIİı]");
}

async function searchWorkOrders(term: string): Promise<SearchResult[]> {
  const pattern = toTurkishSafePattern(term);
  const isNumeric = /^\d+$/.test(term);

  const queries = [
    supabase
      .from("work_orders")
      .select("id, work_order_no, title, customers(name)")
      .filter("title", "imatch", pattern)
      .limit(RESULT_LIMIT),
  ];
  if (isNumeric) {
    queries.push(
      supabase
        .from("work_orders")
        .select("id, work_order_no, title, customers(name)")
        .eq("work_order_no", Number(term))
        .limit(RESULT_LIMIT),
    );
  }

  const results = await Promise.all(queries);
  for (const r of results) if (r.error) throw r.error;

  const byId = new Map<string, SearchResult>();
  for (const r of results) {
    for (const row of r.data ?? []) {
      if (byId.has(row.id)) continue;
      byId.set(row.id, {
        id: `wo-${row.id}`,
        type: "work_order",
        title: row.title,
        subtitle: [`#${row.work_order_no}`, row.customers?.name]
          .filter(Boolean)
          .join(" · "),
        link: { to: "/jobs/$jobId", params: { jobId: row.id } },
      });
    }
  }
  return Array.from(byId.values()).slice(0, RESULT_LIMIT);
}

async function searchProjectTasks(
  term: string,
  isManager: boolean,
  userId: string,
): Promise<SearchResult[]> {
  let query = supabase
    .from("project_tasks")
    .select("id, task_name, project_id, projects(name)")
    .filter("task_name", "imatch", toTurkishSafePattern(term))
    .limit(RESULT_LIMIT);
  if (!isManager) query = query.eq("responsible_id", userId);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: `pt-${row.id}`,
    type: "task" as const,
    title: row.task_name,
    subtitle: ["Proje Görevi", row.projects?.name].filter(Boolean).join(" · "),
    link: isManager
      ? {
          to: "/projects/$projectId",
          params: { projectId: row.project_id },
          hash: `task-${row.id}`,
        }
      : { to: "/my-project-tasks" },
  }));
}

async function searchOperationalTasks(
  term: string,
  isManager: boolean,
  userId: string,
): Promise<SearchResult[]> {
  let query = supabase
    .from("operational_tasks")
    .select("id, title")
    .filter("title", "imatch", toTurkishSafePattern(term))
    .limit(RESULT_LIMIT);
  if (!isManager) query = query.eq("assigned_to", userId);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: `ot-${row.id}`,
    type: "task" as const,
    title: row.title,
    subtitle: "Operasyonel Görev",
    link: isManager
      ? { to: "/tasks", hash: `operational-${row.id}` }
      : { to: "/my-jobs" },
  }));
}

async function searchProjects(term: string): Promise<SearchResult[]> {
  const pattern = toTurkishSafePattern(term);
  // .or() ile tek bir raw filter string'i birleştirmek yerine iki ayrı sorgu
  // kullanılıyor: arama teriminde virgül geçerse PostgREST'in or() söz dizimi
  // (virgülle ayrılmış koşullar) bozulabilir.
  const [byName, byNumber] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, project_no")
      .filter("name", "imatch", pattern)
      .limit(RESULT_LIMIT),
    supabase
      .from("projects")
      .select("id, name, project_no")
      .filter("project_no", "imatch", pattern)
      .limit(RESULT_LIMIT),
  ]);
  if (byName.error) throw byName.error;
  if (byNumber.error) throw byNumber.error;

  const byId = new Map<string, SearchResult>();
  for (const row of [...(byName.data ?? []), ...(byNumber.data ?? [])]) {
    if (byId.has(row.id)) continue;
    byId.set(row.id, {
      id: `pr-${row.id}`,
      type: "project",
      title: row.name,
      subtitle: row.project_no,
      link: { to: "/projects/$projectId", params: { projectId: row.id } },
    });
  }
  return Array.from(byId.values()).slice(0, RESULT_LIMIT);
}

async function searchCustomers(term: string): Promise<SearchResult[]> {
  const { data, error } = await supabase
    .from("customers")
    .select("id, name, contact")
    .filter("name", "imatch", toTurkishSafePattern(term))
    .limit(RESULT_LIMIT);
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: `cu-${row.id}`,
    type: "customer" as const,
    title: row.name,
    subtitle: row.contact ?? undefined,
    link: { to: "/customers" },
  }));
}

export function GlobalSearch({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { role, user } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, DEBOUNCE_MS);
  const trimmed = debouncedQuery.trim();
  const isManager = isOperationalManager(role);
  // Proje/Müşteri sonuçları yalnızca yöneticiye (admin/technical_office)
  // gösterilir: /projects/$projectId ve /customers sayfaları zaten yalnızca
  // bu rollere açık (AccessDenied) — taşeron/müşteri için tıklanabilir bir
  // hedef olmayan bir sonuç göstermek "zaten görebildiği kayıt" ilkesini
  // ihlal eder.
  const canSearchProjectsCustomers = isManager;
  // Görev (project_tasks/operational_tasks) tüm operasyonel roller için
  // aranabilir; müşteri rolünün bu tablolara hiç RLS erişimi yok.
  const canSearchTasks =
    role === "admin" || role === "technical_office" || role === "contractor";

  const searchQuery = useQuery({
    queryKey: ["global-search", trimmed, role, user?.id],
    enabled: open && trimmed.length >= MIN_QUERY_LENGTH && Boolean(user?.id),
    queryFn: async () => {
      const jobs: { type: ResultType; promise: Promise<SearchResult[]> }[] = [
        { type: "work_order", promise: searchWorkOrders(trimmed) },
      ];
      if (canSearchTasks && user) {
        jobs.push({
          type: "task",
          promise: searchProjectTasks(trimmed, isManager, user.id),
        });
        jobs.push({
          type: "task",
          promise: searchOperationalTasks(trimmed, isManager, user.id),
        });
      }
      if (canSearchProjectsCustomers) {
        jobs.push({ type: "project", promise: searchProjects(trimmed) });
        jobs.push({ type: "customer", promise: searchCustomers(trimmed) });
      }

      // Promise.all yerine allSettled: bir kategorideki sorgu hata verirse
      // (ör. tek bir tablo/RLS sorunu), diğer kategorilerin bulduğu doğru
      // sonuçları (ör. iş emri) de siler ve ayrım yapılamayan bir "sonuç
      // bulunamadı" gösterirdi. Her hata, hangi kategoriye ait olduğu
      // belirtilerek konsola loglanır; yalnızca TÜM kategoriler aynı anda
      // başarısız olursa arama genel bir hata durumuna geçer.
      const settled = await Promise.allSettled(jobs.map((j) => j.promise));
      const results: SearchResult[] = [];
      let failureCount = 0;
      settled.forEach((outcome, index) => {
        if (outcome.status === "fulfilled") {
          results.push(...outcome.value);
        } else {
          failureCount++;
          console.error(
            `[GlobalSearch] "${jobs[index].type}" araması başarısız oldu:`,
            outcome.reason,
          );
        }
      });
      if (failureCount > 0 && failureCount === jobs.length) {
        throw new Error(
          `Global arama tüm kategorilerde (${jobs.length}) başarısız oldu`,
        );
      }
      return results;
    },
  });

  const grouped = useMemo(() => {
    const results = searchQuery.data ?? [];
    const groups: Record<ResultType, SearchResult[]> = {
      work_order: [],
      task: [],
      project: [],
      customer: [],
    };
    for (const result of results) groups[result.type].push(result);
    return groups;
  }, [searchQuery.data]);

  const totalResults = Object.values(grouped).reduce(
    (sum, list) => sum + list.length,
    0,
  );

  const handleSelect = (result: SearchResult) => {
    onOpenChange(false);
    setQuery("");
    navigate({
      to: result.link.to,
      params: result.link.params,
      hash: result.link.hash,
    });
  };

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
    if (!next) setQuery("");
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {/* Mobilde tam ekran panel (inset-0, köşesiz); sm ve üstünde ortalanmış
          klasik komut paleti moduna döner. */}
      <DialogContent className="left-0 top-0 flex h-full max-h-full w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:left-[50%] sm:top-[50%] sm:h-auto sm:max-h-[85vh] sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:border">
        <DialogTitle className="sr-only">Genel Arama</DialogTitle>
        {/* shouldFilter={false}: sonuçlar zaten server-side (ILIKE/imatch) ile
            filtreleniyor. cmdk'nin varsayılan filtresi kapatılmazsa, kendi
            fuzzy eşleştirmesini CommandItem'ın `value` prop'una (burada
            item.id — seçim/navigasyon için gerekli bir opak UUID) karşı
            çalıştırıp, arama metniyle eşleşmeyen (neredeyse tüm) item'ları
            gizliyor ve "Sonuç bulunamadı" gösteriyordu — sunucu doğru sonucu
            döndürse bile (canlıda #7 "BOBİN DEĞİŞİMİ" ile doğrulandı). */}
        <Command
          shouldFilter={false}
          className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5"
        >
          <CommandInput
            placeholder="İş emri, görev, proje veya müşteri ara..."
            value={query}
            onValueChange={setQuery}
          />
          <CommandList className="max-h-[calc(100vh-3.5rem)] sm:max-h-[300px]">
            {trimmed.length < MIN_QUERY_LENGTH ? (
              <CommandEmpty>
                Aramak için en az {MIN_QUERY_LENGTH} karakter yazın.
              </CommandEmpty>
            ) : searchQuery.isFetching ? (
              <CommandEmpty>Aranıyor...</CommandEmpty>
            ) : searchQuery.isError ? (
              <CommandEmpty>
                Arama şu anda yapılamıyor. Tekrar deneyin.
              </CommandEmpty>
            ) : totalResults === 0 ? (
              <CommandEmpty>"{trimmed}" için sonuç bulunamadı.</CommandEmpty>
            ) : (
              (Object.keys(typeLabels) as ResultType[]).map((type) => {
                const items = grouped[type];
                if (items.length === 0) return null;
                const Icon = typeIcons[type];
                return (
                  <CommandGroup key={type} heading={typeLabels[type]}>
                    {items.map((item) => (
                      <CommandItem
                        key={item.id}
                        value={item.id}
                        onSelect={() => handleSelect(item)}
                      >
                        <Icon className="h-4 w-4 shrink-0 text-highlight" />
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate font-semibold">
                            {item.title}
                          </span>
                          {item.subtitle ? (
                            <span className="truncate text-xs text-muted-foreground">
                              {item.subtitle}
                            </span>
                          ) : null}
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                );
              })
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

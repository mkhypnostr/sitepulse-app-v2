import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlarmClock,
  BellRing,
  Eye,
  EyeOff,
  Plus,
  Search,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { errorMessage } from "@/lib/domain";
import {
  computeFollowUps,
  OPEN_STAGES,
  pipelineSummary,
  serviceLabels,
  sourceLabels,
  stageLabels,
  stageProbability,
  todayIso,
  type FollowUp,
  type SalesStage,
} from "@/lib/sales";
import type { TcmbRates } from "@/lib/tcmb";
import { LeadSheet, type LeadRow } from "@/components/sales/lead-sheet";
import {
  AccessDenied,
  LoadingState,
  PageHeader,
} from "@/components/page-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/sales")({
  validateSearch: (search: Record<string, unknown>): { leadId?: string } =>
    typeof search.leadId === "string" && search.leadId
      ? { leadId: search.leadId }
      : {},
  component: SalesPage,
});

const LEAD_SELECT =
  "id, title, customer_id, company_name, contact_name, phone, email, location, service, source, stage, estimated_value, currency, expected_close, next_action, next_action_at, lost_reason, notes, created_at, updated_at, stage_changed_at, closed_at, project_id, customers(name), offers(id, offer_no, title, status, total_amount, currency, offer_share_links(created_at, view_count, last_viewed_at, revoked_at))";

const tl = (value: number) =>
  new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 0,
  }).format(value);

const followUpIcon: Record<FollowUp["kind"], typeof BellRing> = {
  gecikmis: AlarmClock,
  planli: BellRing,
  acilmadi: EyeOff,
  acildi_donus_yok: Eye,
  hareketsiz: AlarmClock,
};

function SalesPage() {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const queryClient = useQueryClient();
  const { leadId } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [service, setService] = useState("all");
  const [showClosed, setShowClosed] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  const pageQuery = useQuery({
    queryKey: ["sales-page"],
    enabled: isAdmin,
    queryFn: async () => {
      const [leadsResult, activitiesResult, customersResult] =
        await Promise.all([
          supabase
            .from("sales_leads")
            .select(LEAD_SELECT)
            .order("updated_at", { ascending: false }),
          supabase
            .from("sales_activities")
            .select("lead_id, occurred_at")
            .not("lead_id", "is", null)
            .order("occurred_at", { ascending: false })
            .limit(3000),
          supabase.from("customers").select("id, name").order("name"),
        ]);
      if (leadsResult.error) throw leadsResult.error;
      if (activitiesResult.error) throw activitiesResult.error;
      if (customersResult.error) throw customersResult.error;
      const lastActivity = new Map<string, string>();
      for (const row of activitiesResult.data ?? []) {
        if (row.lead_id && !lastActivity.has(row.lead_id)) {
          lastActivity.set(row.lead_id, row.occurred_at);
        }
      }
      return {
        leads: (leadsResult.data ?? []) as unknown as LeadRow[],
        lastActivity,
        customers: customersResult.data ?? [],
      };
    },
  });

  // Farklı para birimindeki tutarları TL'de toplamak için güncel TCMB kuru.
  const ratesQuery = useQuery({
    queryKey: ["tcmb-rates"],
    enabled: isAdmin,
    staleTime: 60 * 60 * 1000,
    queryFn: async () => {
      const response = await fetch("/api/tcmb-rates");
      if (!response.ok) return null;
      return (await response.json()) as TcmbRates;
    },
  });

  const moveStage = useMutation({
    mutationFn: async ({
      lead,
      stage,
    }: {
      lead: LeadRow;
      stage: SalesStage;
    }) => {
      const { error } = await supabase
        .from("sales_leads")
        .update({ stage })
        .eq("id", lead.id);
      if (error) throw error;
      await supabase.from("sales_activities").insert({
        lead_id: lead.id,
        customer_id: lead.customer_id,
        kind: "asama",
        summary: `${stageLabels[lead.stage]} → ${stageLabels[stage]}`,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["sales-page"] });
      await queryClient.invalidateQueries({ queryKey: ["sidebar-badges"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const leads = useMemo(() => pageQuery.data?.leads ?? [], [pageQuery.data]);
  const rates = ratesQuery.data;
  const toTl = (value: number | null, currency: string) => {
    if (!value) return 0;
    if (currency === "USD") return rates ? value * rates.USD.selling : 0;
    if (currency === "EUR") return rates ? value * rates.EUR.selling : 0;
    return value;
  };

  const filtered = leads.filter((lead) => {
    if (service !== "all" && lead.service !== service) return false;
    const text = query.trim().toLocaleLowerCase("tr-TR");
    if (!text) return true;
    return [
      lead.title,
      lead.company_name,
      lead.contact_name,
      lead.phone,
      lead.location,
      lead.customers?.name,
    ]
      .filter(Boolean)
      .some((v) => String(v).toLocaleLowerCase("tr-TR").includes(text));
  });

  const followUps = useMemo(
    () =>
      computeFollowUps(
        leads as never,
        pageQuery.data?.lastActivity ?? new Map(),
      ),
    [leads, pageQuery.data],
  );
  const summary = pipelineSummary(
    leads.map((lead) => ({
      stage: lead.stage,
      valueTl: toTl(lead.estimated_value, lead.currency),
      closed_at: lead.closed_at,
    })),
  );

  const selected = leadId ? (leads.find((l) => l.id === leadId) ?? null) : null;
  const openLead = (id: string) =>
    void navigate({ search: { leadId: id }, replace: true });
  const closeLead = () => void navigate({ search: {}, replace: true });

  if (!isAdmin) return <AccessDenied />;
  if (pageQuery.isLoading) return <LoadingState />;
  if (pageQuery.error) {
    return (
      <div className="surface-panel p-6 text-sm text-destructive">
        {errorMessage(pageQuery.error)}
      </div>
    );
  }

  const today = todayIso();
  const columns: SalesStage[] = showClosed
    ? [...OPEN_STAGES, "kazanildi", "kaybedildi"]
    : OPEN_STAGES;

  return (
    <>
      <PageHeader
        title="Satış Takibi"
        description="Gelen talepleri aşama aşama izleyin; görüşmeleri kaydedin, sonraki adımı planlayın. Teklif linki açılmadığında veya müşteri açıp dönüş yapmadığında burada hatırlatılır."
        actions={
          <Button className="h-11 font-bold" onClick={() => setCreating(true)}>
            <Plus className="mr-2 h-4 w-4" /> Yeni fırsat
          </Button>
        }
      />

      {/* Özet */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          [
            "Açık fırsat",
            `${summary.openCount}`,
            `${tl(summary.openValue)} toplam`,
          ],
          [
            "Olasılıklı huni değeri",
            tl(summary.weightedValue),
            "aşama olasılığıyla ağırlıklı",
          ],
          [
            "Son 90 gün kazanılan",
            `${summary.wonCount90}`,
            tl(summary.wonValue90),
          ],
          [
            "Kazanma oranı (90 gün)",
            summary.winRate90 === null
              ? "-"
              : `%${Math.round(summary.winRate90 * 100)}`,
            "kazanılan / kapanan",
          ],
        ].map(([label, value, hint]) => (
          <div key={label} className="surface-panel p-4">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 text-lg font-black sm:text-xl">{value}</p>
            <p className="text-xs text-muted-foreground">{hint}</p>
          </div>
        ))}
      </div>

      {/* Takip listesi */}
      <section className="surface-panel mb-4 p-4">
        <h2 className="mb-2 flex items-center gap-2 font-black">
          <BellRing className="h-4 w-4 text-amber-500" /> Takip edilecekler
          {followUps.length > 0 ? (
            <Badge variant="secondary">{followUps.length}</Badge>
          ) : null}
        </h2>
        {followUps.length === 0 ? (
          <p className="text-sm text-muted-foreground">Bekleyen takip yok.</p>
        ) : (
          <div className="grid gap-1.5">
            {followUps.slice(0, 12).map((item, index) => {
              const Icon = followUpIcon[item.kind];
              return (
                <button
                  key={`${item.leadId}-${item.kind}-${index}`}
                  type="button"
                  onClick={() => openLead(item.leadId)}
                  className={`flex items-start gap-2 rounded-md p-2 text-left text-sm hover:bg-muted ${item.kind === "gecikmis" ? "text-destructive" : item.kind === "acildi_donus_yok" ? "text-emerald-700 dark:text-emerald-400" : ""}`}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    <b>{item.leadTitle}</b> — {item.message}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Filtre */}
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Ara: başlık, kişi, telefon, konum"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Select value={service} onValueChange={setService}>
          <SelectTrigger className="h-10 sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tüm hizmetler</SelectItem>
            {Object.entries(serviceLabels).map(([v, l]) => (
              <SelectItem key={v} value={v}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          className="h-10"
          onClick={() => setShowClosed((v) => !v)}
        >
          {showClosed ? "Kapananları gizle" : "Kazanılan / kaybedilen"}
        </Button>
      </div>

      {/* Pano */}
      <div className="flex gap-3 overflow-x-auto pb-4">
        {columns.map((stage) => {
          const items = filtered.filter((lead) => lead.stage === stage);
          const total = items.reduce(
            (sum, lead) => sum + toTl(lead.estimated_value, lead.currency),
            0,
          );
          return (
            <div
              key={stage}
              className="flex w-72 shrink-0 flex-col rounded-lg border border-border bg-muted/40"
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                const lead = leads.find((l) => l.id === dragId);
                setDragId(null);
                if (!lead || lead.stage === stage) return;
                if (stage === "kaybedildi") {
                  toast.message("Kaybedilme nedenini seçip kaydedin.");
                  openLead(lead.id);
                  return;
                }
                moveStage.mutate({ lead, stage });
              }}
            >
              <div className="border-b border-border px-3 py-2">
                <p className="flex items-center justify-between text-sm font-bold">
                  {stageLabels[stage]}
                  <span className="text-xs font-normal text-muted-foreground">
                    {items.length}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {tl(total)}
                  {stage !== "kazanildi" && stage !== "kaybedildi"
                    ? ` · %${Math.round(stageProbability[stage] * 100)} olasılık`
                    : ""}
                </p>
              </div>
              <div className="grid min-h-24 content-start gap-2 p-2">
                {items.map((lead) => {
                  const overdue =
                    lead.next_action_at && lead.next_action_at < today;
                  const link = lead.offers
                    .flatMap((o) => o.offer_share_links)
                    .find((l) => !l.revoked_at);
                  return (
                    <button
                      key={lead.id}
                      type="button"
                      draggable
                      onDragStart={() => setDragId(lead.id)}
                      onClick={() => openLead(lead.id)}
                      className="grid gap-1 rounded-md border border-border bg-card p-2.5 text-left text-sm shadow-sm hover:border-primary"
                    >
                      <span className="font-semibold leading-snug">
                        {lead.title}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {lead.customers?.name ??
                          lead.company_name ??
                          lead.contact_name ??
                          "-"}
                        {lead.location ? ` · ${lead.location}` : ""}
                      </span>
                      <span className="flex flex-wrap items-center gap-1">
                        <Badge variant="outline" className="text-[10px]">
                          {serviceLabels[lead.service]}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">
                          {sourceLabels[lead.source]}
                        </Badge>
                        {lead.estimated_value ? (
                          <span className="text-xs font-bold">
                            {new Intl.NumberFormat("tr-TR", {
                              style: "currency",
                              currency: lead.currency,
                              maximumFractionDigits: 0,
                            }).format(lead.estimated_value)}
                          </span>
                        ) : null}
                      </span>
                      {lead.next_action || lead.next_action_at ? (
                        <span
                          className={`text-xs ${overdue ? "font-semibold text-destructive" : "text-muted-foreground"}`}
                        >
                          Sonraki: {lead.next_action || "Sonraki adım"}
                          {lead.next_action_at
                            ? ` · ${lead.next_action_at.split("-").reverse().join(".")}`
                            : ""}
                        </span>
                      ) : null}
                      {link ? (
                        <span
                          className={`flex items-center gap-1 text-xs ${link.view_count > 0 ? "text-emerald-600" : "text-muted-foreground"}`}
                        >
                          <Eye className="h-3 w-3" />
                          {link.view_count > 0
                            ? `Teklif ${link.view_count} kez açıldı`
                            : "Teklif linki açılmadı"}
                        </span>
                      ) : null}
                      {stage === "kaybedildi" && lead.lost_reason ? (
                        <span className="text-xs text-muted-foreground">
                          {lead.lost_reason}
                        </span>
                      ) : null}
                      <Select
                        value={lead.stage}
                        onValueChange={(v) => {
                          if (v === "kaybedildi") {
                            openLead(lead.id);
                            return;
                          }
                          moveStage.mutate({ lead, stage: v as SalesStage });
                        }}
                      >
                        <SelectTrigger
                          className="mt-1 h-8 text-xs md:hidden"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[...OPEN_STAGES, "kazanildi", "kaybedildi"].map(
                            (s) => (
                              <SelectItem key={s} value={s}>
                                {stageLabels[s as SalesStage]}
                              </SelectItem>
                            ),
                          )}
                        </SelectContent>
                      </Select>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {leads.length === 0 ? (
        <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
          <TrendingUp className="h-4 w-4" /> İlk fırsatı "Yeni fırsat" ile
          ekleyin. Telefonla gelen her talebi buraya yazmak, kaçan işi görmenin
          en kolay yolu.
        </p>
      ) : null}

      <LeadSheet
        lead={selected}
        open={Boolean(selected) || creating}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false);
            closeLead();
          }
        }}
        customers={pageQuery.data?.customers ?? []}
      />
    </>
  );
}

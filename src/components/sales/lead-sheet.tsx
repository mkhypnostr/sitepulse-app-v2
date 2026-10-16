// Fırsat ayrıntısı: bilgiler, aşama, sonraki adım, görüşme geçmişi ve
// bağlı teklifler. Yeni fırsat da bu panelden açılır.
import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  Eye,
  FileText,
  FolderPlus,
  MessageSquarePlus,
  Phone,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/domain";
import {
  activityLabels,
  LOST_REASONS,
  serviceLabels,
  SALES_STAGES,
  sourceLabels,
  stageLabels,
  todayIso,
  type ActivityKind,
  type SalesService,
  type SalesSource,
  type SalesStage,
} from "@/lib/sales";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

export type LeadRow = {
  id: string;
  title: string;
  customer_id: string | null;
  company_name: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  location: string | null;
  service: SalesService;
  source: SalesSource;
  stage: SalesStage;
  estimated_value: number | null;
  currency: "TRY" | "USD" | "EUR";
  expected_close: string | null;
  next_action: string | null;
  next_action_at: string | null;
  lost_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  stage_changed_at: string;
  closed_at: string | null;
  project_id: string | null;
  customers: { name: string } | null;
  offers: {
    id: string;
    offer_no: string;
    title: string;
    status: string;
    total_amount: number;
    currency: string;
    offer_share_links: {
      created_at: string;
      view_count: number;
      last_viewed_at: string | null;
      revoked_at: string | null;
    }[];
  }[];
};

type Draft = Omit<
  LeadRow,
  | "id"
  | "created_at"
  | "updated_at"
  | "stage_changed_at"
  | "closed_at"
  | "project_id"
  | "customers"
  | "offers"
>;

const emptyDraft: Draft = {
  title: "",
  customer_id: null,
  company_name: "",
  contact_name: "",
  phone: "",
  email: "",
  location: "",
  service: "ges",
  source: "telefon",
  stage: "yeni",
  estimated_value: null,
  currency: "TRY",
  expected_close: null,
  next_action: "",
  next_action_at: null,
  lost_reason: null,
  notes: "",
};

const offerStatusLabels: Record<string, string> = {
  draft: "Taslak",
  internal_review: "İç onay",
  sent: "Gönderildi",
  revision_pending: "Revizyon",
  approved: "Onaylandı",
  lost: "Kaybedildi",
  cancelled: "İptal",
};

function Labeled({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`grid gap-1 text-xs font-medium ${className ?? ""}`}>
      {label}
      {children}
    </label>
  );
}

const dt = (value: string) =>
  new Date(value).toLocaleString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const clean = (value: string | null | undefined) => {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
};

export function LeadSheet({
  lead,
  open,
  onOpenChange,
  customers,
}: {
  /** null = yeni fırsat. */
  lead: LeadRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customers: { id: string; name: string }[];
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [activityKind, setActivityKind] = useState<ActivityKind>("arama");
  const [activityText, setActivityText] = useState("");
  const [nextText, setNextText] = useState("");
  const [nextDate, setNextDate] = useState("");

  useEffect(() => {
    if (!open) return;
    if (lead) {
      const {
        id: _id,
        created_at: _c,
        updated_at: _u,
        stage_changed_at: _s,
        closed_at: _cl,
        project_id: _p,
        customers: _cu,
        offers: _o,
        ...rest
      } = lead;
      setDraft(rest);
    } else {
      setDraft(emptyDraft);
    }
    setActivityText("");
    setNextText("");
    setNextDate("");
  }, [lead, open]);

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const activitiesQuery = useQuery({
    queryKey: ["sales-activities", lead?.id],
    enabled: Boolean(lead?.id) && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_activities")
        .select("id, kind, summary, occurred_at")
        .eq("lead_id", lead!.id)
        .order("occurred_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["sales-page"] });
    await queryClient.invalidateQueries({ queryKey: ["sidebar-badges"] });
    if (lead) {
      await queryClient.invalidateQueries({
        queryKey: ["sales-activities", lead.id],
      });
    }
  };

  const save = useMutation({
    mutationFn: async () => {
      if (draft.title.trim().length < 2) throw new Error("Başlık yazın.");
      if (draft.stage === "kaybedildi" && !clean(draft.lost_reason)) {
        throw new Error("Kaybedilme nedenini seçin.");
      }
      const row = {
        title: draft.title.trim(),
        customer_id: draft.customer_id,
        company_name: clean(draft.company_name),
        contact_name: clean(draft.contact_name),
        phone: clean(draft.phone),
        email: clean(draft.email),
        location: clean(draft.location),
        service: draft.service,
        source: draft.source,
        stage: draft.stage,
        estimated_value: draft.estimated_value,
        currency: draft.currency,
        expected_close: draft.expected_close || null,
        next_action: clean(draft.next_action),
        next_action_at: draft.next_action_at || null,
        lost_reason:
          draft.stage === "kaybedildi" ? clean(draft.lost_reason) : null,
        notes: clean(draft.notes),
      };
      if (lead) {
        const { error } = await supabase
          .from("sales_leads")
          .update(row)
          .eq("id", lead.id);
        if (error) throw error;
        if (lead.stage !== draft.stage) {
          await supabase.from("sales_activities").insert({
            lead_id: lead.id,
            customer_id: draft.customer_id,
            kind: "asama",
            summary: `${stageLabels[lead.stage]} → ${stageLabels[draft.stage]}${draft.stage === "kaybedildi" && row.lost_reason ? ` (${row.lost_reason})` : ""}`,
          });
        }
      } else {
        const { error } = await supabase.from("sales_leads").insert(row);
        if (error) throw error;
      }
    },
    onSuccess: async () => {
      await refresh();
      toast.success(lead ? "Fırsat güncellendi." : "Fırsat eklendi.");
      if (!lead) onOpenChange(false);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const addActivity = useMutation({
    mutationFn: async () => {
      if (!lead) throw new Error("Önce fırsatı kaydedin.");
      if (!activityText.trim()) throw new Error("Görüşme notunu yazın.");
      const { error } = await supabase.from("sales_activities").insert({
        lead_id: lead.id,
        customer_id: lead.customer_id,
        kind: activityKind,
        summary: activityText.trim(),
      });
      if (error) throw error;
      // Görüşme kaydı planlı adımı kapatır; yenisi yazıldıysa onu planlar.
      const patch: {
        next_action: string | null;
        next_action_at: string | null;
        stage?: SalesStage;
      } = {
        next_action: clean(nextText),
        next_action_at: nextDate || null,
      };
      if (
        lead.stage === "yeni" &&
        ["arama", "ziyaret", "toplanti", "whatsapp", "eposta"].includes(
          activityKind,
        )
      ) {
        patch.stage = "gorusuldu";
      }
      if (
        activityKind === "kesif" &&
        ["yeni", "gorusuldu"].includes(lead.stage)
      ) {
        patch.stage = "kesif";
      }
      const { error: updateError } = await supabase
        .from("sales_leads")
        .update(patch)
        .eq("id", lead.id);
      if (updateError) throw updateError;
      return patch;
    },
    onSuccess: async (patch) => {
      setActivityText("");
      setNextText("");
      setNextDate("");
      set({
        next_action: patch.next_action,
        next_action_at: patch.next_action_at,
        ...(patch.stage ? { stage: patch.stage } : {}),
      });
      await refresh();
      toast.success(
        patch.next_action_at
          ? "Görüşme kaydedildi, sonraki adım planlandı."
          : "Görüşme kaydedildi.",
      );
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (!lead) return;
      const { error } = await supabase
        .from("sales_leads")
        .delete()
        .eq("id", lead.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await refresh();
      toast.success("Fırsat silindi.");
      onOpenChange(false);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const navigate = useNavigate();
  const convert = useMutation({
    mutationFn: async () => {
      if (!lead) return;
      let customerId = lead.customer_id;
      if (!customerId) {
        const name =
          clean(draft.company_name) ?? clean(draft.contact_name) ?? lead.title;
        const contact = [
          clean(draft.contact_name),
          clean(draft.phone),
          clean(draft.email),
        ]
          .filter(Boolean)
          .join(" · ");
        const { data, error } = await supabase.rpc("save_customer_details", {
          customer_name: name,
          customer_contact: contact || "",
          customer_billing_title: name,
          customer_tax_office: "",
          customer_tax_no: "",
          customer_billing_address: clean(draft.location) ?? "",
        });
        if (error) throw error;
        customerId = data as string;
        const { error: linkError } = await supabase
          .from("sales_leads")
          .update({ customer_id: customerId })
          .eq("id", lead.id);
        if (linkError) throw linkError;
        await supabase
          .from("offers")
          .update({ customer_id: customerId })
          .eq("lead_id", lead.id)
          .is("customer_id", null);
      }
      return customerId;
    },
    onSuccess: async () => {
      await refresh();
      toast.success(
        lead?.customer_id
          ? "Proje formu fırsat bilgileriyle açılıyor."
          : "Müşteri kaydı açıldı; proje formu fırsat bilgileriyle açılıyor.",
      );
      onOpenChange(false);
      await navigate({ to: "/projects", search: { fromLead: lead!.id } });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const today = todayIso();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{lead ? lead.title : "Yeni fırsat"}</SheetTitle>
          <SheetDescription>
            {lead
              ? `${stageLabels[lead.stage]} · eklendi ${dt(lead.created_at)}`
              : "Gelen talebi kaydedin; görüşme ve teklifler bu kayda bağlanır."}
          </SheetDescription>
        </SheetHeader>

        <div className="grid gap-5 px-4 pb-8">
          {/* Bilgiler */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Labeled label="Başlık" className="sm:col-span-2">
              <Input
                value={draft.title}
                maxLength={180}
                placeholder="Örn. Ula villa 10 kWp GES"
                onChange={(e) => set({ title: e.target.value })}
              />
            </Labeled>
            <Labeled label="Kayıtlı müşteri" className="sm:col-span-2">
              <Select
                value={draft.customer_id ?? "none"}
                onValueChange={(v) =>
                  set({ customer_id: v === "none" ? null : v })
                }
              >
                <SelectTrigger className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    Henüz müşteri değil (aday)
                  </SelectItem>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Labeled>
            <Labeled label="Firma / kişi">
              <Input
                value={draft.company_name ?? ""}
                maxLength={160}
                onChange={(e) => set({ company_name: e.target.value })}
              />
            </Labeled>
            <Labeled label="Yetkili">
              <Input
                value={draft.contact_name ?? ""}
                maxLength={120}
                onChange={(e) => set({ contact_name: e.target.value })}
              />
            </Labeled>
            <Labeled label="Telefon">
              <div className="flex gap-1.5">
                <Input
                  value={draft.phone ?? ""}
                  maxLength={40}
                  inputMode="tel"
                  onChange={(e) => set({ phone: e.target.value })}
                />
                {draft.phone ? (
                  <Button
                    asChild
                    variant="outline"
                    size="icon"
                    className="h-10 w-10 shrink-0"
                  >
                    <a
                      href={`tel:${draft.phone.replace(/\s/g, "")}`}
                      aria-label="Ara"
                    >
                      <Phone className="h-4 w-4" />
                    </a>
                  </Button>
                ) : null}
              </div>
            </Labeled>
            <Labeled label="E-posta">
              <Input
                value={draft.email ?? ""}
                maxLength={160}
                inputMode="email"
                onChange={(e) => set({ email: e.target.value })}
              />
            </Labeled>
            <Labeled label="Konum">
              <Input
                value={draft.location ?? ""}
                maxLength={160}
                placeholder="Örn. Akyaka / Muğla"
                onChange={(e) => set({ location: e.target.value })}
              />
            </Labeled>
            <Labeled label="Hizmet">
              <Select
                value={draft.service}
                onValueChange={(v) => set({ service: v as SalesService })}
              >
                <SelectTrigger className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(serviceLabels).map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Labeled>
            <Labeled label="Kaynak">
              <Select
                value={draft.source}
                onValueChange={(v) => set({ source: v as SalesSource })}
              >
                <SelectTrigger className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(sourceLabels).map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Labeled>
            <Labeled label="Aşama">
              <Select
                value={draft.stage}
                onValueChange={(v) => set({ stage: v as SalesStage })}
              >
                <SelectTrigger className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SALES_STAGES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {stageLabels[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Labeled>
            {draft.stage === "kaybedildi" ? (
              <Labeled label="Kaybedilme nedeni">
                <Select
                  value={draft.lost_reason ?? "none"}
                  onValueChange={(v) =>
                    set({ lost_reason: v === "none" ? null : v })
                  }
                >
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="Seçin" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Seçin</SelectItem>
                    {LOST_REASONS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Labeled>
            ) : (
              <Labeled label="Tahmini kapanış">
                <Input
                  type="date"
                  value={draft.expected_close ?? ""}
                  onChange={(e) =>
                    set({ expected_close: e.target.value || null })
                  }
                />
              </Labeled>
            )}
            <Labeled label="Tahmini tutar (KDV hariç)">
              <div className="flex gap-1.5">
                <Input
                  inputMode="decimal"
                  value={draft.estimated_value ?? ""}
                  onChange={(e) => {
                    const v = Number(
                      e.target.value.replace(/\./g, "").replace(",", "."),
                    );
                    set({
                      estimated_value:
                        e.target.value.trim() === "" || !Number.isFinite(v)
                          ? null
                          : v,
                    });
                  }}
                />
                <Select
                  value={draft.currency}
                  onValueChange={(v) =>
                    set({ currency: v as Draft["currency"] })
                  }
                >
                  <SelectTrigger className="h-10 w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TRY">TL</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </Labeled>
            <Labeled label="Sonraki adım">
              <Input
                value={draft.next_action ?? ""}
                maxLength={200}
                placeholder="Örn. Keşif randevusu için ara"
                onChange={(e) => set({ next_action: e.target.value })}
              />
            </Labeled>
            <Labeled label="Sonraki adım tarihi">
              <Input
                type="date"
                value={draft.next_action_at ?? ""}
                className={
                  draft.next_action_at && draft.next_action_at < today
                    ? "border-destructive"
                    : ""
                }
                onChange={(e) =>
                  set({ next_action_at: e.target.value || null })
                }
              />
            </Labeled>
            <Labeled label="Notlar" className="sm:col-span-2">
              <Textarea
                rows={3}
                maxLength={4000}
                value={draft.notes ?? ""}
                onChange={(e) => set({ notes: e.target.value })}
              />
            </Labeled>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Button
                type="button"
                onClick={() => save.mutate()}
                disabled={save.isPending}
              >
                {save.isPending
                  ? "Kaydediliyor..."
                  : lead
                    ? "Kaydet"
                    : "Fırsatı ekle"}
              </Button>
              {lead ? (
                <>
                  <Button asChild type="button" variant="outline">
                    <Link to="/energy-offer" search={{ leadId: lead.id }}>
                      <FileText className="mr-2 h-4 w-4" /> Teklif hazırla
                    </Link>
                  </Button>
                  {lead.project_id ? (
                    <Button asChild type="button" variant="outline">
                      <Link
                        to="/projects/$projectId"
                        params={{ projectId: lead.project_id }}
                      >
                        <FolderPlus className="mr-2 h-4 w-4" /> Projeye git
                      </Link>
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant={
                        draft.stage === "kazanildi" ? "default" : "outline"
                      }
                      disabled={convert.isPending}
                      onClick={() => convert.mutate()}
                      title="Kayıtlı müşteri yoksa açar, sonra proje formunu bu fırsatın bilgileriyle doldurur."
                    >
                      <FolderPlus className="mr-2 h-4 w-4" />
                      {convert.isPending
                        ? "Hazırlanıyor..."
                        : lead.customer_id
                          ? "Proje oluştur"
                          : "Müşteri ve proje oluştur"}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    className="ml-auto text-destructive"
                    disabled={remove.isPending}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Fırsat ve görüşme geçmişi silinsin mi? Bağlı teklifler silinmez.",
                        )
                      ) {
                        remove.mutate();
                      }
                    }}
                  >
                    <Trash2 className="mr-1.5 h-4 w-4" /> Sil
                  </Button>
                </>
              ) : null}
            </div>
            {lead && draft.stage === "kazanildi" && !lead.project_id ? (
              <p className="rounded-md bg-emerald-500/10 p-2 text-xs text-emerald-700 sm:col-span-2 dark:text-emerald-400">
                Kazanıldı. "
                {lead.customer_id
                  ? "Proje oluştur"
                  : "Müşteri ve proje oluştur"}
                " ile
                {lead.customer_id ? "" : " müşteri kaydı açılır,"} proje formu
                bu fırsatın bilgileriyle dolar; proje açılınca fırsat ve
                teklifleri projeye bağlanır.
              </p>
            ) : null}
          </div>

          {lead ? (
            <>
              {/* Teklifler */}
              <section className="grid gap-2">
                <h3 className="text-sm font-bold">Teklifler</h3>
                {lead.offers.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Bu fırsata bağlı teklif yok. "Teklif hazırla" ile açılan
                    teklif buraya bağlanır.
                  </p>
                ) : (
                  lead.offers.map((offer) => {
                    const link = offer.offer_share_links.find(
                      (l) => !l.revoked_at,
                    );
                    return (
                      <Link
                        key={offer.id}
                        to="/energy-offer"
                        search={{ offerId: offer.id }}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2 text-sm hover:bg-muted"
                      >
                        <span>
                          <span className="font-mono text-xs font-bold">
                            {offer.offer_no}
                          </span>{" "}
                          {offer.title}
                        </span>
                        <span className="flex items-center gap-2 text-xs text-muted-foreground">
                          {offerStatusLabels[offer.status] ?? offer.status}
                          {Number(offer.total_amount) > 0
                            ? ` · ${new Intl.NumberFormat("tr-TR", { style: "currency", currency: offer.currency || "TRY", maximumFractionDigits: 0 }).format(Number(offer.total_amount))}`
                            : ""}
                          {link ? (
                            <span
                              className={`flex items-center gap-1 ${link.view_count > 0 ? "font-semibold text-emerald-600" : ""}`}
                            >
                              <Eye className="h-3.5 w-3.5" />
                              {link.view_count > 0
                                ? `${link.view_count} açılış`
                                : "açılmadı"}
                            </span>
                          ) : null}
                        </span>
                      </Link>
                    );
                  })
                )}
              </section>

              {/* Görüşme ekle */}
              <section className="grid gap-2 rounded-md border border-border p-3">
                <h3 className="flex items-center gap-2 text-sm font-bold">
                  <MessageSquarePlus className="h-4 w-4" /> Görüşme / not ekle
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      "arama",
                      "ziyaret",
                      "toplanti",
                      "whatsapp",
                      "eposta",
                      "kesif",
                      "not",
                    ] as ActivityKind[]
                  ).map((kind) => (
                    <Button
                      key={kind}
                      type="button"
                      size="sm"
                      variant={activityKind === kind ? "default" : "outline"}
                      onClick={() => setActivityKind(kind)}
                    >
                      {activityLabels[kind]}
                    </Button>
                  ))}
                </div>
                <Textarea
                  rows={3}
                  maxLength={2000}
                  placeholder="Ne konuşuldu, müşteri ne dedi?"
                  value={activityText}
                  onChange={(e) => setActivityText(e.target.value)}
                />
                <div className="grid gap-2 sm:grid-cols-[1fr_170px]">
                  <Input
                    value={nextText}
                    maxLength={200}
                    placeholder="Sonraki adım (boş bırakılırsa planlı adım kapanır)"
                    onChange={(e) => setNextText(e.target.value)}
                  />
                  <Input
                    type="date"
                    value={nextDate}
                    onChange={(e) => setNextDate(e.target.value)}
                  />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    ["Yarın", 1],
                    ["3 gün", 3],
                    ["1 hafta", 7],
                  ].map(([label, days]) => (
                    <Button
                      key={label}
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const d = new Date();
                        d.setDate(d.getDate() + Number(days));
                        setNextDate(todayIso(d));
                      }}
                    >
                      <CalendarClock className="mr-1 h-3.5 w-3.5" /> {label}
                    </Button>
                  ))}
                  <Button
                    type="button"
                    size="sm"
                    className="ml-auto"
                    onClick={() => addActivity.mutate()}
                    disabled={addActivity.isPending}
                  >
                    {addActivity.isPending ? "Kaydediliyor..." : "Kaydet"}
                  </Button>
                </div>
              </section>

              {/* Geçmiş */}
              <section className="grid gap-2">
                <h3 className="text-sm font-bold">Geçmiş</h3>
                {(activitiesQuery.data ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Henüz kayıt yok.
                  </p>
                ) : (
                  <ol className="grid gap-2 border-l border-border pl-4">
                    {(activitiesQuery.data ?? []).map((a) => (
                      <li key={a.id} className="relative text-sm">
                        <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-primary" />
                        <p className="text-xs text-muted-foreground">
                          {dt(a.occurred_at)} ·{" "}
                          {activityLabels[a.kind as ActivityKind] ?? a.kind}
                        </p>
                        <p className="whitespace-pre-wrap">{a.summary}</p>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

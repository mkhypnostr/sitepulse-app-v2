import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  BatteryCharging,
  CircleX,
  FileSpreadsheet,
  Percent,
  Plus,
  Printer,
  RefreshCw,
  Save,
  Sun,
  Trash2,
  Wand2,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useAuth } from "@/lib/auth-context";
import { errorMessage } from "@/lib/domain";
import { buildTechnicalOffer } from "@/lib/energy-offer-technical";
import { buildOfferDocument, NES_COMPANY } from "@/lib/energy-offer-document";
import {
  applyMarkup,
  buildGesLines,
  buildSarjLines,
  defaultDcCable,
  defaultGes,
  defaultPaymentPlan,
  defaultRecipient,
  defaultTechnical,
  defaultSarj,
  DEFAULT_SPECIFIC_YIELD,
  formatKwp,
  formatMoney,
  gesBatteryKwh,
  gesCapacityKwp,
  gesInverterKw,
  isEnergyOfferConfig,
  lineFromCatalog,
  markupForTargetSale,
  newLineKey,
  panelsForTarget,
  parseDecimal,
  priceLines,
  productionEstimate,
  recommendedInverterRange,
  round2,
  runChecks,
  suggestInverters,
  summarize,
  type Check,
  type CatalogItem,
  type Currency,
  type DraftLine,
  type EnergyOfferConfig,
  type ExchangeRates,
  type GesConfig,
  type LineCategory,
  type OfferModule,
  type OfferLayout,
  type OfferRecipient,
  type TechnicalContent,
  type PaymentStep,
  type PricedLine,
  type SarjConfig,
} from "@/lib/energy-offer";
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
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/energy-offer")({
  validateSearch: (search: Record<string, unknown>): { offerId?: string } =>
    typeof search.offerId === "string" && search.offerId
      ? { offerId: search.offerId }
      : {},
  component: EnergyOfferPage,
});

const moduleLabels: Record<OfferModule, string> = {
  ges: "Güneş Enerji Sistemi (GES)",
  sarj: "Elektrikli Araç Şarj Sistemi",
  taahhut: "Elektrik Taahhüt İşleri",
  genel: "Genel",
};

const categoryLabels: Record<LineCategory, string> = {
  malzeme: "Malzeme",
  iscilik: "İşçilik",
  nakliye_sarf: "Nakliye/Sarf",
  diger: "Diğer",
};

const statuses = {
  draft: "Taslak",
  internal_review: "İç Onay",
  sent: "Müşteriye Gönderildi",
  revision_pending: "Revizyon Bekliyor",
  approved: "Onaylandı",
  lost: "Kaybedildi",
  cancelled: "İptal",
} as const;
type Status = keyof typeof statuses;

const defaultTerms = [
  "Teklif bedeli yalnız teklif kapsamındaki mal ve hizmetlerin anahtar teslim bedelidir; KDV ayrıca gösterilmiştir.",
  "Döviz bazlı bedeller ödeme günündeki banka döviz satış kuru üzerinden TL'ye çevrilir.",
  "Paket içeriklerindeki markalar stok durumuna göre muadili ile değişebilir.",
  "Kabul sürecinde dağıtım şirketi veya resmi kurumlarca istenebilecek öngörülemeyen ek ekipman (çift yönlü sayaç ve modemi, ek sayaç panosu, yangın merdiveni vb.) müşteri sorumluluğundadır.",
  "Montaj yapılacak çatı/cephe alanlarının uygulama öncesi montaja uygun ve tam izolasyonlu olması müşteri sorumluluğundadır; statik yeterlilik keşif sonrası kesinleşir.",
].join("\n");

const technicalTerms = [
  "Faturalar teslim tarihinden itibaren 7 gün içinde ödenir.",
  "Proje dışı ve işverence talep edilen ilave işler, Ek-1 birim fiyatlarıyla veya karşılıklı mutabakatla fiyatlandırılır.",
  "Kullanılacak malzemeler TEDAŞ/EDAŞ onaylı tedarikçi listesinden, TS/ISO standartlarına uygun seçilir; muadil kullanımı işveren onayıyla yapılır.",
].join("\n");

const technicalTextFields: [
  Exclude<keyof TechnicalContent, "scheduleWeeks">,
  string,
  string,
  number,
][] = [
  [
    "intro",
    "Giriş yazısı",
    "Boşsa standart NES giriş yazısı kullanılır. Her satır bir paragraf.",
    4,
  ],
  [
    "summaryCards",
    "Özet kartları (en çok 3)",
    "Etiket: değer — ör. Kurulu güç: 2.452,5 kWe. Teklif bedeli kartı otomatik eklenir.",
    3,
  ],
  ["projectDescription", "Proje tanımı", "Her satır bir paragraf.", 4],
  [
    "technicalData",
    "Teknik veriler",
    "Etiket: değer — ör. Gerilim seviyesi: 31,5 kV",
    6,
  ],
  [
    "specialNotes",
    "Projedeki özel durumlar",
    "Başlık: açıklama — ör. Kamulaştırma: 5 ve 6 nolu direkler için süreç başlatılmalı.",
    4,
  ],
  ["included", "Teklife dahil olan işler", "Her satır bir madde.", 6],
  [
    "excluded",
    "Teklife dahil olmayan işler (işveren)",
    "Her satır bir madde.",
    5,
  ],
  [
    "methodology",
    "Uygulama metodolojisi",
    "Adım: açıklama — sırayla numaralanır.",
    6,
  ],
];

const fieldIds: Record<NonNullable<Check["field"]>, string> = {
  genel: "bolum-genel",
  ges: "bolum-ges",
  sarj: "bolum-sarj",
  kalemler: "bolum-kalemler",
  odeme: "bolum-odeme",
};

function scrollToField(field: Check["field"]) {
  if (!field) return;
  document
    .getElementById(fieldIds[field])
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function addDays(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmtNum(value: number, digits = 2) {
  return new Intl.NumberFormat("tr-TR", {
    maximumFractionDigits: digits,
  }).format(value);
}

/** Ondalık virgülle yazmaya izin veren sayı alanı. */
function NumField({
  value,
  onChange,
  className,
  placeholder,
}: {
  value: number;
  onChange: (value: number) => void;
  className?: string;
  placeholder?: string;
}) {
  const [text, setText] = useState(value ? fmtNum(value, 4) : "");
  useEffect(() => {
    if (parseDecimal(text) !== value) setText(value ? fmtNum(value, 4) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <Input
      inputMode="decimal"
      className={className}
      placeholder={placeholder}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        onChange(parseDecimal(event.target.value));
      }}
    />
  );
}

function Field({
  label,
  children,
  hint,
  className,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <label className={`grid gap-1.5 text-sm font-medium ${className ?? ""}`}>
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

function catalogLabel(item: CatalogItem) {
  const price = `${fmtNum(Number(item.cost_amount))} ${item.currency}`;
  const src = item.code.startsWith("EP-") ? "enerjipazari" : "NES maliyet";
  return `${item.brand ? `${item.brand} · ` : ""}${item.name} — ${price} (${src})`;
}

function CatalogSelect({
  items,
  value,
  onChange,
  placeholder,
}: {
  items: CatalogItem[];
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
}) {
  return (
    <Select
      value={value || "none"}
      onValueChange={(v) => onChange(v === "none" ? "" : v)}
    >
      <SelectTrigger className="h-11 text-left">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">{placeholder}</SelectItem>
        {items.map((item) => (
          <SelectItem key={item.id} value={item.id}>
            {catalogLabel(item)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

type LoadedOffer = {
  id: string;
  offer_no: string;
  title: string;
  status: string;
  customer_id: string | null;
  currency: string;
  vat_rate: number;
  valid_until: string | null;
  module_config: Json;
  exchange_rates: Json;
  payment_plan: Json;
  terms_note: string | null;
  notes: string | null;
};

type LoadedLine = {
  id: string;
  catalog_item_id: string | null;
  module: string | null;
  category: string;
  description: string;
  brand: string | null;
  unit: string;
  quantity: number;
  unit_cost: number;
  markup_rate: number;
  source_unit_cost: number | null;
  source_currency: string | null;
  visible_to_customer: boolean;
};

function EnergyOfferPage() {
  const { role, user } = useAuth();
  const isAdmin = role === "admin";
  const { offerId } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [status, setStatus] = useState<Status>("draft");
  const [currency, setCurrency] = useState<Currency>("TRY");
  const [vatRate, setVatRate] = useState(0.2);
  const [validUntil, setValidUntil] = useState(addDays(15));
  const [rates, setRates] = useState<ExchangeRates>({ USD: 0, EUR: 0 });
  const [ges, setGes] = useState<GesConfig>(defaultGes);
  const [sarj, setSarj] = useState<SarjConfig>(defaultSarj);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [paymentPlan, setPaymentPlan] =
    useState<PaymentStep[]>(defaultPaymentPlan);
  const [terms, setTerms] = useState(defaultTerms);
  const [targetKwp, setTargetKwp] = useState(0);
  const [taahhutPick, setTaahhutPick] = useState("");
  const [loadedOfferId, setLoadedOfferId] = useState<string | null>(null);
  const [recipient, setRecipient] = useState<OfferRecipient>(defaultRecipient);
  const [projectLocation, setProjectLocation] = useState("");
  const [markupRate, setMarkupRate] = useState(0.2);
  const [targetSale, setTargetSale] = useState(0);
  const [specificYield, setSpecificYield] = useState(DEFAULT_SPECIFIC_YIELD);
  const [showLinePrices, setShowLinePrices] = useState(false);
  const [layout, setLayout] = useState<OfferLayout>("otomatik");
  const [technical, setTechnical] =
    useState<TechnicalContent>(defaultTechnical);
  const [exporting, setExporting] = useState(false);

  const dataQuery = useQuery({
    queryKey: ["energy-offer", offerId ?? "new"],
    enabled: isAdmin,
    queryFn: async () => {
      const [catalogResult, customersResult] = await Promise.all([
        supabase
          .from("offer_catalog_items")
          .select("*")
          .eq("is_active", true)
          .order("module")
          .order("sort_order"),
        supabase
          .from("customers")
          .select("id, name, billing_title, billing_address")
          .order("name"),
      ]);
      if (catalogResult.error) throw catalogResult.error;
      if (customersResult.error) throw customersResult.error;
      let offer: LoadedOffer | null = null;
      let offerLines: LoadedLine[] = [];
      if (offerId) {
        const [offerResult, linesResult] = await Promise.all([
          supabase
            .from("offers")
            .select(
              "id, offer_no, title, status, customer_id, currency, vat_rate, valid_until, module_config, exchange_rates, payment_plan, terms_note, notes",
            )
            .eq("id", offerId)
            .single(),
          supabase
            .from("offer_line_items")
            .select(
              "id, catalog_item_id, module, category, description, brand, unit, quantity, unit_cost, markup_rate, source_unit_cost, source_currency, visible_to_customer",
            )
            .eq("offer_id", offerId)
            .order("sort_order"),
        ]);
        if (offerResult.error) throw offerResult.error;
        if (linesResult.error) throw linesResult.error;
        offer = offerResult.data as LoadedOffer;
        offerLines = (linesResult.data ?? []) as LoadedLine[];
      }
      return {
        catalog: (catalogResult.data ?? []) as unknown as CatalogItem[],
        customers: customersResult.data ?? [],
        offer,
        offerLines,
      };
    },
  });

  const catalog = useMemo(
    () => dataQuery.data?.catalog ?? [],
    [dataQuery.data],
  );

  // Kayıtlı teklifi bir kez forma yükle.
  useEffect(() => {
    const offer = dataQuery.data?.offer;
    if (!offer || loadedOfferId === offer.id) return;
    setLoadedOfferId(offer.id);
    setTitle(offer.title);
    setCustomerId(offer.customer_id ?? "");
    setStatus((offer.status as Status) ?? "draft");
    setCurrency(
      (["TRY", "USD", "EUR"].includes(offer.currency)
        ? offer.currency
        : "TRY") as Currency,
    );
    setVatRate(Number(offer.vat_rate ?? 0.2));
    setValidUntil(offer.valid_until ?? addDays(15));
    const er = (offer.exchange_rates ?? {}) as Partial<ExchangeRates>;
    setRates({ USD: Number(er.USD ?? 0), EUR: Number(er.EUR ?? 0) });
    if (isEnergyOfferConfig(offer.module_config)) {
      const cfg = offer.module_config as EnergyOfferConfig;
      setGes({ ...defaultGes, ...cfg.ges });
      setSarj({ ...defaultSarj, ...cfg.sarj });
      setRecipient({ ...defaultRecipient, ...cfg.recipient });
      setProjectLocation(cfg.projectLocation ?? "");
      if (typeof cfg.markupRate === "number") setMarkupRate(cfg.markupRate);
      setSpecificYield(cfg.specificYield ?? DEFAULT_SPECIFIC_YIELD);
      setShowLinePrices(Boolean(cfg.showLinePrices));
      setLayout(cfg.layout ?? "otomatik");
      setTechnical({ ...defaultTechnical, ...cfg.technical });
    }
    if (Array.isArray(offer.payment_plan)) {
      setPaymentPlan(offer.payment_plan as unknown as PaymentStep[]);
    }
    setTerms(offer.terms_note ?? defaultTerms);
    setLines(
      (dataQuery.data?.offerLines ?? []).map((line) => ({
        key: newLineKey(),
        catalogItemId: line.catalog_item_id,
        module: (line.module as OfferModule) ?? "genel",
        category: line.category as LineCategory,
        description: line.description,
        brand: line.brand,
        unit: line.unit,
        quantity: Number(line.quantity),
        sourceUnitCost: Number(line.source_unit_cost ?? line.unit_cost),
        sourceCurrency:
          (line.source_currency as Currency) ?? (offer.currency as Currency),
        markupRate: Number(line.markup_rate),
        auto: line.module === "ges" || line.module === "sarj",
        visibleToCustomer: line.visible_to_customer,
      })),
    );
  }, [dataQuery.data, loadedOfferId]);

  const gesPanels = catalog.filter((i) => i.template_role === "ges_panel");
  const gesInverters = catalog.filter((i) =>
    ges.systemType === "hibrit"
      ? i.template_role === "ges_inverter"
      : i.template_role === "ges_inverter" ||
        i.template_role === "ges_inverter_ongrid",
  );
  const gesBatteries = catalog.filter(
    (i) =>
      i.template_role === "ges_battery" || i.template_role === "ges_battery_hv",
  );
  const stations = catalog.filter((i) => i.template_role === "sarj_station");
  const extraItems = catalog.filter(
    (i) => i.module === "taahhut" || !i.template_role,
  );

  const kwp = gesCapacityKwp(ges, catalog);
  const acKw = gesInverterKw(ges, catalog);
  const batteryKwh = gesBatteryKwh(ges, catalog);
  const selectedPanel = catalog.find((i) => i.id === ges.panelId);

  const priced: PricedLine[] = useMemo(
    () => priceLines(lines, currency, rates),
    [lines, currency, rates],
  );
  const totals = useMemo(() => summarize(priced, vatRate), [priced, vatRate]);
  const checks = runChecks({
    customerId,
    recipient,
    ges,
    sarj,
    catalog,
    lines,
    paymentPlan,
    rates,
    offerCurrency: currency,
  });
  if (title.trim().length < 3) {
    checks.unshift({
      level: "error",
      field: "genel",
      message: "Teklif başlığı eksik.",
      fix: "Genel bilgiler > Teklif başlığı alanına en az 3 karakter yazın.",
    });
  }
  const errors = checks.filter((c) => c.level === "error");

  function regenerate() {
    const manual = lines.filter((line) => !line.auto);
    const generated = applyMarkup(
      [...buildGesLines(ges, catalog), ...buildSarjLines(sarj, catalog)],
      markupRate,
    );
    setLines([...generated, ...manual]);
    toast.success(
      `${generated.length} kalem oluşturuldu; kâr oranı %${fmtNum(markupRate * 100)} uygulandı.`,
    );
  }

  function applyGlobalMarkup() {
    setLines((current) => applyMarkup(current, markupRate));
    toast.success(`Tüm kalemlere %${fmtNum(markupRate * 100)} kâr uygulandı.`);
  }

  function applyTargetSale() {
    const rate = markupForTargetSale(lines, currency, rates, targetSale);
    if (rate === null) {
      toast.error("Önce kalem ve kurları girin, sonra hedef tutarı yazın.");
      return;
    }
    if (rate < 0) {
      toast.error(
        `Hedef tutar maliyetin altında (maliyet ${formatMoney(totals.cost, currency)}).`,
      );
      return;
    }
    const rounded = Math.round(rate * 10000) / 10000;
    setMarkupRate(rounded);
    setLines((current) => applyMarkup(current, rounded));
    toast.success(
      `Hedefe ulaşmak için tüm kalemlere %${fmtNum(rounded * 100)} kâr uygulandı.`,
    );
  }

  function pickSuggestedInverter() {
    const best = suggestInverters(ges, catalog)[0];
    if (!best) {
      toast.error(
        "Katalogda bu DC güce uygun tek inverter yok; adedi artırmayı deneyin.",
      );
      return;
    }
    setGes((g) => ({ ...g, inverterId: best.id, inverterCount: 1 }));
    toast.success(`${best.brand ?? ""} ${best.name} seçildi.`);
  }

  function recipientName() {
    return recipient.mode === "aday"
      ? recipient.name.trim()
      : (dataQuery.data?.customers.find((c) => c.id === customerId)?.name ??
          "");
  }

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  }

  function addCatalogLine(id: string) {
    const item = catalog.find((i) => i.id === id);
    if (!item) return;
    setLines((current) => [
      ...current,
      lineFromCatalog(item, 1, { auto: false }),
    ]);
    setTaahhutPick("");
  }

  function addFreeLine() {
    setLines((current) => [
      ...current,
      {
        key: newLineKey(),
        catalogItemId: null,
        module: "genel",
        category: "diger",
        description: "Yeni kalem",
        brand: null,
        unit: "adet",
        quantity: 1,
        sourceUnitCost: 0,
        sourceCurrency: currency,
        markupRate,
        auto: false,
        visibleToCustomer: true,
      },
    ]);
  }

  function summaryText() {
    const parts: string[] = [];
    if (ges.enabled && kwp > 0) {
      parts.push(
        `${formatKwp(kwp)} kWp ${ges.systemType === "hibrit" ? "hibrit" : "on-grid"} GES${batteryKwh > 0 ? ` + ${formatKwp(batteryKwh)} kWh batarya` : ""}`,
      );
    }
    if (sarj.enabled && sarj.stationCount > 0) {
      parts.push(`${sarj.stationCount} adet EV şarj istasyonu`);
    }
    if (lines.some((l) => l.module === "taahhut"))
      parts.push("elektrik taahhüt işleri");
    return parts.join(" + ") || "Enerji paketi";
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Oturum bulunamadı.");
      if (errors.length > 0) throw new Error(errors[0].message);
      const moduleConfig: EnergyOfferConfig = {
        kind: "enerji_paketi",
        version: 1,
        ges,
        sarj,
        recipient,
        projectLocation: projectLocation.trim(),
        markupRate,
        specificYield,
        showLinePrices,
        layout,
        technical: layout === "teknik" ? technical : undefined,
      };
      const header = {
        title: title.trim(),
        customer_id: recipient.mode === "kayitli" ? customerId || null : null,
        offer_type: "diger",
        status,
        currency,
        vat_rate: vatRate,
        valid_until: validUntil || null,
        total_amount_mode: "computed",
        primary_item_description: summaryText().slice(0, 500),
        primary_item_quantity: 1,
        primary_item_unit: "set",
        module_config: moduleConfig as unknown as Json,
        exchange_rates: {
          USD: rates.USD,
          EUR: rates.EUR,
          date: new Date().toISOString().slice(0, 10),
        } as unknown as Json,
        payment_plan: paymentPlan as unknown as Json,
        terms_note: terms.trim() || null,
      };
      let id = offerId;
      if (id) {
        const { error } = await supabase
          .from("offers")
          .update(header)
          .eq("id", id);
        if (error) throw error;
        const { error: deleteError } = await supabase
          .from("offer_line_items")
          .delete()
          .eq("offer_id", id);
        if (deleteError) throw deleteError;
      } else {
        const { data, error } = await supabase
          .from("offers")
          .insert({ ...header, created_by: user.id })
          .select("id")
          .single();
        if (error) throw error;
        id = data.id as string;
      }
      const rows = priced.map((line, index) => ({
        offer_id: id as string,
        sort_order: index,
        module: line.module,
        catalog_item_id: line.catalogItemId,
        category: line.category,
        description: line.description.slice(0, 500),
        brand: line.brand,
        unit: line.unit.slice(0, 20) || "adet",
        quantity: line.quantity,
        unit_cost: line.unitCost,
        markup_rate: line.markupRate,
        source_unit_cost: line.sourceUnitCost,
        source_currency: line.sourceCurrency,
        visible_to_customer: line.visibleToCustomer,
      }));
      if (rows.length > 0) {
        const { error } = await supabase.from("offer_line_items").insert(rows);
        if (error) throw error;
      }
      return id as string;
    },
    onSuccess: async (id) => {
      await queryClient.invalidateQueries({ queryKey: ["offers-page"] });
      toast.success("Teklif kaydedildi.");
      if (id !== offerId) {
        setLoadedOfferId(id);
        await navigate({ to: "/energy-offer", search: { offerId: id } });
      } else {
        await queryClient.invalidateQueries({ queryKey: ["energy-offer", id] });
      }
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  function documentInput() {
    return {
      offerNo: dataQuery.data?.offer?.offer_no ?? "TASLAK",
      issueDate: new Date(),
      validUntil,
      title,
      recipientName: recipientName(),
      contactName: recipient.mode === "aday" ? recipient.contactName : "",
      location: projectLocation.trim(),
      currency,
      vatRate,
      rates,
      ges,
      sarj,
      catalog,
      lines: priced,
      sale: totals.sale,
      vat: totals.vat,
      grandTotal: totals.grandTotal,
      paymentPlan,
      terms,
      showLinePrices,
      specificYield,
      recipientAddress:
        recipient.mode === "kayitli"
          ? (dataQuery.data?.customers.find((c) => c.id === customerId)
              ?.billing_address ?? "")
          : "",
      origin: window.location.origin,
    };
  }

  function openCustomerDocument() {
    if (errors.length > 0) {
      toast.error(`Önce kırmızı kontrolleri düzeltin: ${errors[0].message}`);
      return;
    }
    const win = window.open("", "_blank");
    if (!win) {
      toast.error(
        "Teklif penceresi açılamadı; tarayıcıda açılır pencere engelini kaldırın.",
      );
      return;
    }
    const input = documentInput();
    const offerHtml =
      layout === "teknik"
        ? buildTechnicalOffer(input, technical)
        : buildOfferDocument(input);
    const html = offerHtml.replace(
      "</body>",
      `<div class="noprint" style="position:fixed;top:12px;right:12px;display:flex;gap:8px"><button onclick="window.print()" style="padding:10px 16px;border:0;border-radius:8px;background:#0B4EA2;color:#fff;font-weight:700;cursor:pointer">PDF olarak kaydet / Yazdır</button></div><style>@media print{.noprint{display:none!important}}</style></body>`,
    );
    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  async function exportInternalExcel() {
    if (import.meta.env.SSR) return;
    if (lines.length === 0) {
      toast.error("Önce kalemleri oluşturun.");
      return;
    }
    setExporting(true);
    try {
      const { buildInternalCostWorkbook } =
        await import("@/lib/energy-offer-excel");
      const blob = await buildInternalCostWorkbook({
        offerNo: dataQuery.data?.offer?.offer_no ?? "TASLAK",
        title,
        recipientName: recipientName(),
        currency,
        rates,
        vatRate,
        lines: priced,
        catalogCodes: new Map(catalog.map((item) => [item.id, item.code])),
        logoUrl: NES_COMPANY.logoPath,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${dataQuery.data?.offer?.offer_no ?? "taslak"}-ic-maliyet.xlsx`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (error) {
      toast.error(errorMessage(error) || "Excel oluşturulamadı.");
    } finally {
      setExporting(false);
    }
  }

  if (!isAdmin) return <AccessDenied />;
  if (dataQuery.isLoading)
    return <LoadingState label="Katalog yükleniyor..." />;
  if (dataQuery.error) {
    return (
      <div className="surface-panel p-6 text-sm text-destructive">
        {errorMessage(dataQuery.error)}
      </div>
    );
  }

  const panelW = selectedPanel?.power_w ?? 0;

  return (
    <>
      <PageHeader
        title={
          dataQuery.data?.offer
            ? `${dataQuery.data.offer.offer_no} · Enerji paketi teklifi`
            : "Yeni enerji paketi teklifi"
        }
        description="GES, EV şarj ve taahhüt kalemlerini katalogdan seçin; maliyet, kâr ve müşteri fiyatı otomatik hesaplanır."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" className="h-11">
              <Link to="/offers">
                <ArrowLeft className="mr-2 h-4 w-4" /> Teklifler
              </Link>
            </Button>
            <Button
              variant="outline"
              className="h-11"
              onClick={exportInternalExcel}
              disabled={lines.length === 0 || exporting}
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              {exporting ? "Hazırlanıyor..." : "İç maliyet Excel"}
            </Button>
            <Button
              variant="outline"
              className="h-11"
              onClick={openCustomerDocument}
              disabled={lines.length === 0}
            >
              <Printer className="mr-2 h-4 w-4" /> Teklif dosyası (PDF)
            </Button>
            <Button
              className="h-11 font-bold"
              onClick={() => save.mutate()}
              disabled={save.isPending}
            >
              <Save className="mr-2 h-4 w-4" />
              {save.isPending ? "Kaydediliyor..." : "Kaydet"}
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="grid min-w-0 gap-4">
          {/* Genel bilgiler */}
          <section
            id="bolum-genel"
            className="surface-panel grid scroll-mt-4 gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4"
          >
            <Field label="Teklif başlığı" className="sm:col-span-2">
              <Input
                value={title}
                maxLength={180}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Örn. Bodrum villa 20 kWp GES + şarj"
              />
            </Field>
            <Field label="Teklif verilen" className="sm:col-span-2">
              <div className="flex gap-2">
                <Select
                  value={recipient.mode}
                  onValueChange={(mode) =>
                    setRecipient((r) => ({
                      ...r,
                      mode: mode as OfferRecipient["mode"],
                    }))
                  }
                >
                  <SelectTrigger className="h-11 w-40 shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="kayitli">Kayıtlı müşteri</SelectItem>
                    <SelectItem value="aday">Kayıtsız aday</SelectItem>
                  </SelectContent>
                </Select>
                {recipient.mode === "kayitli" ? (
                  <Select
                    value={customerId || "none"}
                    onValueChange={(v) => setCustomerId(v === "none" ? "" : v)}
                  >
                    <SelectTrigger className="h-11">
                      <SelectValue placeholder="Müşteri seçin" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Müşteri seçin</SelectItem>
                      {(dataQuery.data?.customers ?? []).map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={recipient.name}
                    maxLength={160}
                    placeholder="Ad soyad / firma unvanı"
                    onChange={(e) =>
                      setRecipient((r) => ({ ...r, name: e.target.value }))
                    }
                  />
                )}
              </div>
            </Field>
            {recipient.mode === "aday" ? (
              <>
                <Field label="Yetkili kişi">
                  <Input
                    value={recipient.contactName}
                    maxLength={120}
                    onChange={(e) =>
                      setRecipient((r) => ({
                        ...r,
                        contactName: e.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="Telefon">
                  <Input
                    value={recipient.phone}
                    maxLength={40}
                    inputMode="tel"
                    onChange={(e) =>
                      setRecipient((r) => ({ ...r, phone: e.target.value }))
                    }
                  />
                </Field>
                <Field label="E-posta" className="sm:col-span-2">
                  <Input
                    value={recipient.email}
                    maxLength={120}
                    inputMode="email"
                    onChange={(e) =>
                      setRecipient((r) => ({ ...r, email: e.target.value }))
                    }
                  />
                </Field>
              </>
            ) : null}
            <Field
              label="Proje lokasyonu"
              className="sm:col-span-2"
              hint="Teklif kapağında görünür"
            >
              <Input
                value={projectLocation}
                maxLength={120}
                placeholder="Örn. Akyaka / Muğla"
                onChange={(e) => setProjectLocation(e.target.value)}
              />
            </Field>
            <Field label="Teklif para birimi">
              <Select
                value={currency}
                onValueChange={(v) => setCurrency(v as Currency)}
              >
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TRY">TL</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="USD kuru (TL)" hint="1 USD kaç TL">
              <NumField
                value={rates.USD}
                onChange={(USD) => setRates((r) => ({ ...r, USD }))}
                placeholder="Örn. 41,85"
              />
            </Field>
            <Field label="EUR kuru (TL)" hint="1 EUR kaç TL">
              <NumField
                value={rates.EUR}
                onChange={(EUR) => setRates((r) => ({ ...r, EUR }))}
                placeholder="Örn. 48,60"
              />
            </Field>
            <Field label="KDV oranı (%)">
              <NumField
                value={round2(vatRate * 100)}
                onChange={(v) =>
                  setVatRate(Math.min(100, Math.max(0, v)) / 100)
                }
              />
            </Field>
            <Field label="Durum">
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as Status)}
              >
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(statuses).map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Geçerlilik tarihi">
              <Input
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
              />
            </Field>
          </section>

          {/* GES */}
          <section id="bolum-ges" className="surface-panel scroll-mt-4 p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 font-black">
                <Sun className="h-5 w-5 text-amber-500" /> GES
              </h2>
              <Switch
                checked={ges.enabled}
                onCheckedChange={(enabled) =>
                  setGes((g) => ({ ...g, enabled }))
                }
              />
            </div>
            {ges.enabled ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Sistem tipi">
                  <Select
                    value={ges.systemType}
                    onValueChange={(v) =>
                      setGes((g) => ({
                        ...g,
                        systemType: v as GesConfig["systemType"],
                        inverterId: "",
                      }))
                    }
                  >
                    <SelectTrigger className="h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ongrid">
                        On-grid (şebeke bağlantılı)
                      </SelectItem>
                      <SelectItem value="hibrit">Hibrit (bataryalı)</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Montaj yeri">
                  <Select
                    value={ges.roofType}
                    onValueChange={(v) =>
                      setGes((g) => ({
                        ...g,
                        roofType: v as GesConfig["roofType"],
                      }))
                    }
                  >
                    <SelectTrigger className="h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="kiremit">Kiremit çatı</SelectItem>
                      <SelectItem value="trapez">
                        Trapez/sandviç çatı
                      </SelectItem>
                      <SelectItem value="arazi">
                        Arazi/teras (alüminyum)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field
                  label="Hedef güç (kWp)"
                  hint="Girerseniz panel adedi hesaplanır"
                >
                  <NumField
                    value={targetKwp}
                    onChange={(v) => {
                      setTargetKwp(v);
                      if (panelW > 0) {
                        const count = panelsForTarget(v, panelW);
                        const newKwp = (count * panelW) / 1000;
                        setGes((g) => ({
                          ...g,
                          panelCount: count,
                          dcCableM: defaultDcCable(newKwp),
                        }));
                      }
                    }}
                  />
                </Field>
                <Field
                  label="Sözleşme gücü (kW)"
                  hint="Aboneliğin bağlantı gücü"
                >
                  <NumField
                    value={ges.contractPowerKw}
                    onChange={(v) =>
                      setGes((g) => ({ ...g, contractPowerKw: v }))
                    }
                  />
                </Field>
                <Field label="Panel" className="sm:col-span-2 lg:col-span-3">
                  <CatalogSelect
                    items={gesPanels}
                    value={ges.panelId}
                    placeholder="Panel seçin"
                    onChange={(panelId) => {
                      const p = catalog.find((i) => i.id === panelId);
                      setGes((g) => {
                        const count =
                          targetKwp > 0 && p?.power_w
                            ? panelsForTarget(targetKwp, p.power_w)
                            : g.panelCount;
                        const k = p?.power_w ? (count * p.power_w) / 1000 : 0;
                        return {
                          ...g,
                          panelId,
                          panelCount: count,
                          dcCableM: g.dcCableM || defaultDcCable(k),
                        };
                      });
                    }}
                  />
                </Field>
                <Field label="Panel adedi">
                  <NumField
                    value={ges.panelCount}
                    onChange={(v) =>
                      setGes((g) => ({
                        ...g,
                        panelCount: Math.max(0, Math.round(v)),
                      }))
                    }
                  />
                </Field>
                <Field
                  label="İnverter"
                  className="sm:col-span-2 lg:col-span-3"
                  hint={
                    kwp > 0
                      ? `Bu DC güç için uygun toplam inverter gücü: ${formatKwp(recommendedInverterRange(kwp).min)}–${formatKwp(recommendedInverterRange(kwp).max)} kW`
                      : undefined
                  }
                >
                  <div className="flex gap-2">
                    <div className="min-w-0 flex-1">
                      <CatalogSelect
                        items={gesInverters}
                        value={ges.inverterId}
                        placeholder="İnverter seçin"
                        onChange={(inverterId) =>
                          setGes((g) => ({ ...g, inverterId }))
                        }
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 shrink-0"
                      onClick={pickSuggestedInverter}
                      disabled={kwp <= 0}
                      title="DC/AC oranını 0,90–1,35 aralığına sokan en ekonomik inverteri seçer"
                    >
                      <Wand2 className="mr-1.5 h-4 w-4" /> Uygun olanı seç
                    </Button>
                  </div>
                </Field>
                <Field label="İnverter adedi">
                  <NumField
                    value={ges.inverterCount}
                    onChange={(v) =>
                      setGes((g) => ({
                        ...g,
                        inverterCount: Math.max(0, Math.round(v)),
                      }))
                    }
                  />
                </Field>
                {ges.systemType === "hibrit" ? (
                  <>
                    <Field
                      label="Batarya"
                      className="sm:col-span-2 lg:col-span-3"
                    >
                      <CatalogSelect
                        items={gesBatteries}
                        value={ges.batteryId}
                        placeholder="Batarya seçin"
                        onChange={(batteryId) =>
                          setGes((g) => ({ ...g, batteryId }))
                        }
                      />
                    </Field>
                    <Field label="Batarya adedi">
                      <NumField
                        value={ges.batteryCount}
                        onChange={(v) =>
                          setGes((g) => ({
                            ...g,
                            batteryCount: Math.max(0, Math.round(v)),
                          }))
                        }
                      />
                    </Field>
                  </>
                ) : null}
                <Field label="DC kablo (m)" hint="Varsayılan: kWp × 20 m">
                  <NumField
                    value={ges.dcCableM}
                    onChange={(v) =>
                      setGes((g) => ({
                        ...g,
                        dcCableM: Math.max(0, Math.round(v)),
                      }))
                    }
                  />
                </Field>
                <Field label="AC kablo (m)" hint="İnverter–pano arası">
                  <NumField
                    value={ges.acCableM}
                    onChange={(v) =>
                      setGes((g) => ({
                        ...g,
                        acCableM: Math.max(0, Math.round(v)),
                      }))
                    }
                  />
                </Field>
                <Field
                  label="Özgül üretim (kWh/kWp·yıl)"
                  hint="Muğla için tipik 1.450–1.550"
                >
                  <NumField
                    value={specificYield}
                    onChange={(v) => setSpecificYield(Math.max(0, v))}
                  />
                </Field>
                <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-3">
                  <Badge variant="secondary">DC: {formatKwp(kwp)} kWp</Badge>
                  {kwp > 0 ? (
                    <Badge variant="secondary">
                      Yıllık ~
                      {fmtNum(productionEstimate(kwp, specificYield).annual, 0)}{" "}
                      kWh
                    </Badge>
                  ) : null}
                  <Badge variant="secondary">AC: {formatKwp(acKw)} kW</Badge>
                  {acKw > 0 && kwp > 0 ? (
                    <Badge variant="outline">DC/AC {fmtNum(kwp / acKw)}</Badge>
                  ) : null}
                  {batteryKwh > 0 ? (
                    <Badge variant="secondary">
                      Batarya: {formatKwp(batteryKwh)} kWh
                    </Badge>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                GES bu teklifte yok.
              </p>
            )}
          </section>

          {/* Şarj */}
          <section id="bolum-sarj" className="surface-panel scroll-mt-4 p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 font-black">
                <BatteryCharging className="h-5 w-5 text-emerald-600" /> EV şarj
              </h2>
              <Switch
                checked={sarj.enabled}
                onCheckedChange={(enabled) =>
                  setSarj((s) => ({ ...s, enabled }))
                }
              />
            </div>
            {sarj.enabled ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field
                  label="Şarj istasyonu"
                  className="sm:col-span-2 lg:col-span-3"
                >
                  <CatalogSelect
                    items={stations}
                    value={sarj.stationId}
                    placeholder="İstasyon seçin"
                    onChange={(stationId) => {
                      const st = catalog.find((i) => i.id === stationId);
                      setSarj((s) => ({
                        ...s,
                        stationId,
                        phase: st?.phase ?? s.phase,
                      }));
                    }}
                  />
                </Field>
                <Field label="Adet">
                  <NumField
                    value={sarj.stationCount}
                    onChange={(v) =>
                      setSarj((s) => ({
                        ...s,
                        stationCount: Math.max(0, Math.round(v)),
                      }))
                    }
                  />
                </Field>
                <Field label="Besleme">
                  <Select
                    value={sarj.phase}
                    onValueChange={(v) =>
                      setSarj((s) => ({
                        ...s,
                        phase: v as SarjConfig["phase"],
                      }))
                    }
                  >
                    <SelectTrigger className="h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="trifaze">Trifaze (5x6 mm²)</SelectItem>
                      <SelectItem value="mono">Monofaze (3x6 mm²)</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="İstasyon başı kablo (m)">
                  <NumField
                    value={sarj.cableMPerStation}
                    onChange={(v) =>
                      setSarj((s) => ({
                        ...s,
                        cableMPerStation: Math.max(0, Math.round(v)),
                      }))
                    }
                  />
                </Field>
                <Field label="Bağlantı gücü (kW)" hint="Binanın mevcut gücü">
                  <NumField
                    value={sarj.connectionPowerKw}
                    onChange={(v) =>
                      setSarj((s) => ({ ...s, connectionPowerKw: v }))
                    }
                  />
                </Field>
                <label className="flex items-center gap-3 text-sm font-medium">
                  <Switch
                    checked={sarj.withStand}
                    onCheckedChange={(withStand) =>
                      setSarj((s) => ({ ...s, withStand }))
                    }
                  />
                  Ayaklı (stand) montaj
                </label>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Şarj istasyonu bu teklifte yok.
              </p>
            )}
          </section>

          {/* Kalemler */}
          <section
            id="bolum-kalemler"
            className="surface-panel scroll-mt-4 overflow-hidden"
          >
            <div className="flex flex-col gap-3 border-b border-border px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="flex items-center gap-2 font-black">
                  <Wrench className="h-5 w-5" /> Teklif kalemleri
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  "Kalemleri oluştur" GES ve şarj ayarlarından malzeme, işçilik
                  (kWp başına) ve yardımcı kalemleri üretir; elle eklenen
                  kalemler korunur. Kâr oranını tek yerden girip tüm kalemlere
                  uygulayın ya da hedef satış tutarını yazıp "Dağıt"a basın;
                  satır bazında değiştirmek isterseniz tablodaki Kâr % alanını
                  kullanın.
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="grid gap-1 text-xs font-medium">
                  Kâr oranı (maliyet üzerine)
                  <div className="flex items-center gap-1">
                    <Percent className="h-4 w-4 text-muted-foreground" />
                    <NumField
                      className="h-10 w-20"
                      value={round2(markupRate * 100)}
                      onChange={(v) => setMarkupRate(Math.max(0, v) / 100)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10"
                      onClick={applyGlobalMarkup}
                      disabled={lines.length === 0}
                    >
                      Tümüne uygula
                    </Button>
                  </div>
                </label>
                <label className="grid gap-1 text-xs font-medium">
                  veya hedef satış (KDV hariç, {currency})
                  <div className="flex items-center gap-1">
                    <NumField
                      className="h-10 w-32"
                      value={targetSale}
                      onChange={(v) => setTargetSale(Math.max(0, v))}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10"
                      onClick={applyTargetSale}
                      disabled={lines.length === 0 || targetSale <= 0}
                    >
                      Dağıt
                    </Button>
                  </div>
                </label>
                <Button variant="default" onClick={regenerate}>
                  <RefreshCw className="mr-2 h-4 w-4" /> Kalemleri oluştur
                </Button>
                <Button variant="outline" onClick={addFreeLine}>
                  <Plus className="mr-2 h-4 w-4" /> Serbest kalem
                </Button>
              </div>
            </div>
            <div className="border-b border-border px-5 py-3">
              <Field label="Katalogdan kalem ekle (taahhüt / aksesuar)">
                <Select
                  value={taahhutPick || "none"}
                  onValueChange={(v) => v !== "none" && addCatalogLine(v)}
                >
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder="Kalem seçin" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Kalem seçin</SelectItem>
                    {extraItems.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        [{item.category}] {catalogLabel(item)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            {lines.length === 0 ? (
              <p className="p-5 text-sm text-muted-foreground">
                Henüz kalem yok. Modülleri ayarlayıp "Kalemleri oluştur"a basın.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[260px]">Açıklama</TableHead>
                      <TableHead>Modül</TableHead>
                      <TableHead className="w-24">Miktar</TableHead>
                      <TableHead className="w-28">Alış (kaynak)</TableHead>
                      <TableHead className="w-20">Kâr %</TableHead>
                      <TableHead className="text-right">Maliyet</TableHead>
                      <TableHead className="text-right">Satış</TableHead>
                      <TableHead className="w-16">Müşteri</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {priced.map((line) => (
                      <TableRow
                        key={line.key}
                        className={line.visibleToCustomer ? "" : "opacity-50"}
                      >
                        <TableCell>
                          <Input
                            value={line.description}
                            onChange={(e) =>
                              updateLine(line.key, {
                                description: e.target.value,
                              })
                            }
                            className="h-9"
                          />
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {categoryLabels[line.category]} · {line.unit}
                            {line.brand ? ` · ${line.brand}` : ""}
                            {line.auto ? " · otomatik" : ""}
                          </p>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={line.module}
                            onValueChange={(v) =>
                              updateLine(line.key, { module: v as OfferModule })
                            }
                          >
                            <SelectTrigger className="h-9 w-28">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="ges">GES</SelectItem>
                              <SelectItem value="sarj">Şarj</SelectItem>
                              <SelectItem value="taahhut">Taahhüt</SelectItem>
                              <SelectItem value="genel">Genel</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <NumField
                            className="h-9"
                            value={line.quantity}
                            onChange={(quantity) =>
                              updateLine(line.key, { quantity })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <NumField
                              className="h-9"
                              value={line.sourceUnitCost}
                              onChange={(sourceUnitCost) =>
                                updateLine(line.key, { sourceUnitCost })
                              }
                            />
                            <span className="text-xs text-muted-foreground">
                              {line.sourceCurrency}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <NumField
                            className="h-9"
                            value={round2(line.markupRate * 100)}
                            onChange={(v) =>
                              updateLine(line.key, {
                                markupRate: Math.max(0, v) / 100,
                              })
                            }
                          />
                        </TableCell>
                        <TableCell className="text-right text-xs">
                          {formatMoney(line.totalCost, currency)}
                        </TableCell>
                        <TableCell className="text-right font-bold">
                          {formatMoney(line.saleAmount, currency)}
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={line.visibleToCustomer}
                            onCheckedChange={(visibleToCustomer) =>
                              updateLine(line.key, { visibleToCustomer })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              setLines((c) =>
                                c.filter((l) => l.key !== line.key),
                              )
                            }
                            aria-label="Kalemi sil"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>

          {/* Ödeme ve şartlar */}
          <section
            id="bolum-odeme"
            className="surface-panel grid scroll-mt-4 gap-4 p-5 lg:grid-cols-2"
          >
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <h2 className="font-black">Ödeme planı</h2>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setPaymentPlan((p) => [
                      ...p,
                      { label: "Yeni adım", percent: 0 },
                    ])
                  }
                >
                  <Plus className="mr-1 h-3.5 w-3.5" /> Adım
                </Button>
              </div>
              {paymentPlan.map((step, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    value={step.label}
                    onChange={(e) =>
                      setPaymentPlan((p) =>
                        p.map((s, i) =>
                          i === index ? { ...s, label: e.target.value } : s,
                        ),
                      )
                    }
                  />
                  {layout === "teknik" ? (
                    <Input
                      placeholder="Açıklama (ör. uzun termin malzeme blokajı)"
                      value={step.note ?? ""}
                      onChange={(e) =>
                        setPaymentPlan((p) =>
                          p.map((s, i) =>
                            i === index ? { ...s, note: e.target.value } : s,
                          ),
                        )
                      }
                    />
                  ) : null}
                  <div className="flex w-28 shrink-0 items-center gap-1">
                    <span className="text-sm">%</span>
                    <NumField
                      value={step.percent}
                      onChange={(percent) =>
                        setPaymentPlan((p) =>
                          p.map((s, i) =>
                            i === index ? { ...s, percent } : s,
                          ),
                        )
                      }
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      setPaymentPlan((p) => p.filter((_, i) => i !== index))
                    }
                    aria-label="Adımı sil"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Field label="Teklif şartları (müşteri çıktısında görünür)">
              <Textarea
                rows={7}
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
              />
            </Field>
          </section>

          {layout === "teknik" ? (
            <section className="surface-panel grid gap-4 p-5 lg:grid-cols-2">
              <div className="lg:col-span-2">
                <h2 className="font-black">Teknik teklif içeriği</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Boş bırakılan bölümler dosyada görünmez. Liste alanlarına her
                  satıra bir madde yazın; "Başlık: açıklama" yazarsanız başlık
                  kalın görünür.
                </p>
              </div>
              <Field
                label="Alt başlık"
                className="lg:col-span-2"
                hint="Kapakta başlığın altında, ör. 2.452,5 kWe GES – 31,5 kV havai hat, XLPE kablo – anahtar teslim"
              >
                <Input
                  value={technical.subtitle}
                  onChange={(e) =>
                    setTechnical((t) => ({ ...t, subtitle: e.target.value }))
                  }
                />
              </Field>
              <Field
                label="İş süresi"
                hint="ör. 12 hafta (malzeme termini ve EDAŞ kesinti programına bağlı)"
              >
                <Input
                  value={technical.duration}
                  onChange={(e) =>
                    setTechnical((t) => ({ ...t, duration: e.target.value }))
                  }
                />
              </Field>
              <Field label="Garanti">
                <Input
                  value={technical.warranty}
                  onChange={(e) =>
                    setTechnical((t) => ({ ...t, warranty: e.target.value }))
                  }
                />
              </Field>
              <Field label="Hazırlayan">
                <Input
                  value={technical.preparedByName}
                  onChange={(e) =>
                    setTechnical((t) => ({
                      ...t,
                      preparedByName: e.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="Unvan">
                <Input
                  value={technical.preparedByTitle}
                  onChange={(e) =>
                    setTechnical((t) => ({
                      ...t,
                      preparedByTitle: e.target.value,
                    }))
                  }
                />
              </Field>
              {technicalTextFields.map(([key, label, hint, rows]) => (
                <Field key={key} label={label} hint={hint}>
                  <Textarea
                    rows={rows}
                    value={String(technical[key])}
                    onChange={(e) =>
                      setTechnical((t) => ({ ...t, [key]: e.target.value }))
                    }
                  />
                </Field>
              ))}
              <Field
                label="İş programı"
                className="lg:col-span-2"
                hint='Her satır: "Faaliyet | başlangıç-bitiş haftası | malzeme" — ör. "Malzeme tedariki | 1-8 | malzeme". "malzeme" yazılan satır turuncu çizilir.'
              >
                <Textarea
                  rows={7}
                  value={technical.schedule}
                  onChange={(e) =>
                    setTechnical((t) => ({ ...t, schedule: e.target.value }))
                  }
                />
              </Field>
              <Field label="Toplam süre (hafta)">
                <NumField
                  value={technical.scheduleWeeks}
                  onChange={(v) =>
                    setTechnical((t) => ({
                      ...t,
                      scheduleWeeks: Math.max(1, Math.min(52, Math.round(v))),
                    }))
                  }
                />
              </Field>
            </section>
          ) : null}
        </div>

        {/* Özet */}
        <aside className="grid content-start gap-4 xl:sticky xl:top-4">
          <section className="surface-panel grid gap-2 p-5 text-sm">
            <h2 className="mb-1 font-black">Özet</h2>
            {totals.byModule
              .filter((m) => m.sale > 0)
              .map((m) => (
                <div key={m.module} className="flex justify-between">
                  <span>{moduleLabels[m.module]}</span>
                  <span>{formatMoney(m.sale, currency)}</span>
                </div>
              ))}
            <div className="mt-2 flex justify-between border-t border-border pt-2 font-bold">
              <span>Ara toplam</span>
              <span>{formatMoney(totals.sale, currency)}</span>
            </div>
            <div className="flex justify-between">
              <span>KDV</span>
              <span>{formatMoney(totals.vat, currency)}</span>
            </div>
            <div className="flex justify-between text-lg font-black">
              <span>Genel toplam</span>
              <span>{formatMoney(totals.grandTotal, currency)}</span>
            </div>
            <div className="mt-3 rounded-md bg-muted p-3 text-xs">
              <p className="mb-1 font-bold">Yalnız yönetici görür</p>
              <div className="flex justify-between">
                <span>Toplam maliyet</span>
                <span>{formatMoney(totals.cost, currency)}</span>
              </div>
              <div className="flex justify-between">
                <span>Brüt kâr</span>
                <span>{formatMoney(totals.profit, currency)}</span>
              </div>
              <div className="flex justify-between">
                <span>Kâr marjı (satış üzerinden)</span>
                <span>%{fmtNum(totals.margin * 100, 1)}</span>
              </div>
              <div className="flex justify-between">
                <span>Ort. kâr oranı (maliyet üzerinden)</span>
                <span>
                  %
                  {fmtNum(
                    totals.cost > 0 ? (totals.profit / totals.cost) * 100 : 0,
                    1,
                  )}
                </span>
              </div>
              {kwp > 0 && totals.sale > 0 ? (
                <div className="flex justify-between">
                  <span>kWp başı satış</span>
                  <span>{formatMoney(totals.sale / kwp, currency)}</span>
                </div>
              ) : null}
            </div>
          </section>

          <section className="surface-panel grid gap-2 p-5 text-sm">
            <h2 className="mb-1 font-black">Müşteri dosyası</h2>
            <Field label="Dosya düzeni">
              <Select
                value={layout}
                onValueChange={(value) => {
                  const next = value as OfferLayout;
                  setLayout(next);
                  if (next === "teknik" && terms === defaultTerms) {
                    setTerms(technicalTerms);
                  }
                  if (next === "otomatik" && terms === technicalTerms) {
                    setTerms(defaultTerms);
                  }
                }}
              >
                <SelectTrigger className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="otomatik">
                    GES sunumu / TEKLİF formu
                  </SelectItem>
                  <SelectItem value="teknik">
                    Teknik ve ticari teklif (taahhüt, OG)
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <label className="flex items-center justify-between gap-3">
              <span>Ayrıntılı fiyat listesi ekle</span>
              <Switch
                checked={showLinePrices}
                onCheckedChange={setShowLinePrices}
              />
            </label>
            <p
              className={`text-xs text-muted-foreground ${layout === "teknik" ? "hidden" : ""}`}
            >
              GES içeren teklif NES sunum dosyası (kapak, sistem özeti, hizmet
              kapsamı, donanımlar, proje süreci, fiyat) olarak çıkar; açarsanız
              sonuna kalem kalem fiyat listesi eklenir. Yalnız şarj/taahhüt
              teklifleri NES "TEKLİF" formu olarak çıkar; açarsanız tüm kalemler
              ayrı satırda, kapalıyken istasyon + "montaj ve sarf dahil" tek
              satırda görünür.
            </p>
            {layout === "teknik" ? (
              <p className="text-xs text-muted-foreground">
                Büyük taahhüt/OG işleri için Word tarzı dosya: kapak, giriş
                yazısı, teklif özeti, NES Grup hakkında, proje ve teknik
                veriler, iş kapsamı, iş programı, fiyat (malzeme/işçilik
                ayrımlı), ödeme planı, referanslar, onay ve Ek-1 birim fiyat
                cetveli. Metinleri soldaki "Teknik teklif içeriği" bölümünden
                düzenleyin. Ek-1 her zaman eklenir.
              </p>
            ) : null}
          </section>

          <section className="surface-panel grid gap-2 p-5 text-sm">
            <h2 className="mb-1 font-black">Kontroller</h2>
            {checks.length === 0 ? (
              <p className="text-emerald-700">Sorun bulunmadı.</p>
            ) : (
              checks.map((check, index) => (
                <button
                  type="button"
                  key={index}
                  onClick={() => scrollToField(check.field)}
                  className={`flex gap-2 rounded-md p-2 text-left hover:bg-muted ${check.level === "error" ? "text-destructive" : "text-amber-700"}`}
                >
                  {check.level === "error" ? (
                    <CircleX className="mt-0.5 h-4 w-4 shrink-0" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  )}
                  <span>
                    <span className="font-semibold">{check.message}</span>
                    <span className="mt-0.5 block text-xs text-foreground/70">
                      Nasıl düşer: {check.fix}
                    </span>
                  </span>
                </button>
              ))
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Kırmızılar düzelmeden kayıt ve teklif dosyası alınmaz. Sarılar
              uyarıdır; bilerek geçilebilir, kaydı engellemez. Bir uyarıya
              tıklarsanız ilgili bölüme gider.
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}

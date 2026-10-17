import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  BatteryCharging,
  CircleX,
  Landmark,
  FileSpreadsheet,
  Percent,
  Plus,
  CopyPlus,
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
  type StoredRates,
  convert,
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
import { Field, NumField } from "@/components/energy-offer/fields";
import { fmtNum } from "@/components/energy-offer/format";
import {
  FinancePanel,
  PackagePicker,
} from "@/components/energy-offer/ges-finance-panel";
import {
  applyPackage,
  defaultFinance,
  financeAnalysis,
  formatUsdPerWp,
  monthlyPerKwpFor,
  panelCostPerW,
  usdPerWp,
  type FinanceConfig,
} from "@/lib/energy-offer-finance";
import type { TcmbRates } from "@/lib/tcmb";
import {
  azimuthLabel,
  defaultSite,
  layoutSite,
  layoutSvg,
  type SiteConfig,
} from "@/lib/solar-site";
import { SiteDesigner } from "@/components/energy-offer/site-designer";
import {
  OfferStepper,
  ProjectTypePicker,
} from "@/components/energy-offer/project-configurator";
import {
  DEFAULT_MARKUP_RATE,
  DEFAULT_VAT_RATE,
  MIN_GROSS_MARGIN,
  baseOfferNo,
  belowMarginFloor,
  nextRevisionNo,
  validityRule,
} from "@/lib/offer-rules";
import { ShareLinkPanel } from "@/components/energy-offer/share-link-panel";

export const Route = createFileRoute("/_authenticated/energy-offer")({
  validateSearch: (search: Record<string, unknown>): OfferSearch => {
    const text = (key: string) =>
      typeof search[key] === "string" && search[key]
        ? { [key]: String(search[key]).slice(0, 200) }
        : {};
    const number = (key: string) => {
      const value = Number(search[key]);
      return Number.isFinite(value) && value > 0 ? { [key]: value } : {};
    };
    return {
      ...text("offerId"),
      ...text("leadId"),
      // Asistanın "GES teklifi hazırla" bağlantısı (yeni teklifte ön doldurma).
      ...number("kwp"),
      ...(search.sistem === "hibrit" || search.sistem === "ongrid"
        ? { sistem: search.sistem }
        : {}),
      ...number("batarya"),
      ...text("musteri"),
      ...text("aday"),
      ...text("konum"),
      ...text("baslik"),
    };
  },
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

type OfferSearch = {
  offerId?: string;
  leadId?: string;
  kwp?: number;
  sistem?: "ongrid" | "hibrit";
  batarya?: number;
  musteri?: string;
  aday?: string;
  konum?: string;
  baslik?: string;
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

function catalogLabel(item: CatalogItem) {
  const price = `${fmtNum(Number(item.cost_amount))} ${item.currency}`;
  const src = item.code.startsWith("EP-") ? "enerjipazari" : "NES maliyet";
  const perW =
    item.template_role === "ges_panel" && Number(item.power_w) > 0
      ? ` · ${fmtNum(panelCostPerW(item), 3)} ${item.currency}/Wp`
      : "";
  return `${item.brand ? `${item.brand} · ` : ""}${item.name} — ${price}${perW} (${src})`;
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
  lead_id: string | null;
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
  const search = Route.useSearch();
  const { offerId, leadId: leadParam } = search;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [status, setStatus] = useState<Status>("draft");
  const [currency, setCurrency] = useState<Currency>("TRY");
  const [vatRate, setVatRate] = useState(DEFAULT_VAT_RATE);
  const [validUntil, setValidUntil] = useState(addDays(15));
  // Geçerlilik tarihi elle değiştirildiyse kural önerisi otomatik uygulanmaz.
  const [validityTouched, setValidityTouched] = useState(false);
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
  const [markupRate, setMarkupRate] = useState(DEFAULT_MARKUP_RATE);
  const [targetSale, setTargetSale] = useState(0);
  const [specificYield, setSpecificYield] = useState(DEFAULT_SPECIFIC_YIELD);
  const [showLinePrices, setShowLinePrices] = useState(false);
  const [layout, setLayout] = useState<OfferLayout>("otomatik");
  const [technical, setTechnical] =
    useState<TechnicalContent>(defaultTechnical);
  const [exporting, setExporting] = useState(false);
  const [finance, setFinance] = useState<FinanceConfig>(defaultFinance);
  const [showPricePerWp, setShowPricePerWp] = useState(true);
  const [rateMeta, setRateMeta] = useState<{
    source: "TCMB" | "manual";
    tcmbDate?: string;
  }>({ source: "manual" });
  const [fetchingRates, setFetchingRates] = useState(false);
  const [site, setSite] = useState<SiteConfig>(defaultSite);
  const [showDesigner, setShowDesigner] = useState(false);
  const [autoRatesTried, setAutoRatesTried] = useState(false);

  const dataQuery = useQuery({
    queryKey: ["energy-offer", offerId ?? `new-${leadParam ?? ""}`],
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
              "id, offer_no, title, status, customer_id, currency, vat_rate, valid_until, module_config, exchange_rates, payment_plan, terms_note, notes, lead_id",
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
      // Teklif bir satış fırsatından açıldıysa (veya bağlıysa) fırsat bilgisi.
      const leadKey = offer?.lead_id ?? (offerId ? null : (leadParam ?? null));
      let lead: {
        id: string;
        title: string;
        stage: string;
        customer_id: string | null;
        company_name: string | null;
        contact_name: string | null;
        phone: string | null;
        email: string | null;
        location: string | null;
      } | null = null;
      if (leadKey) {
        const { data } = await supabase
          .from("sales_leads")
          .select(
            "id, title, stage, customer_id, company_name, contact_name, phone, email, location",
          )
          .eq("id", leadKey)
          .maybeSingle();
        lead = data ?? null;
      }
      return {
        catalog: (catalogResult.data ?? []) as unknown as CatalogItem[],
        customers: customersResult.data ?? [],
        offer,
        offerLines,
        lead,
      };
    },
  });

  const catalog = useMemo(
    () => dataQuery.data?.catalog ?? [],
    [dataQuery.data],
  );

  async function fetchTcmbRates(silent = false) {
    setFetchingRates(true);
    try {
      const response = await fetch("/api/tcmb-rates");
      const body = (await response.json()) as TcmbRates & { error?: string };
      if (!response.ok || body.error) {
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      setRates({
        USD: Math.round(body.USD.selling * 10000) / 10000,
        EUR: Math.round(body.EUR.selling * 10000) / 10000,
      });
      setRateMeta({ source: "TCMB", tcmbDate: body.date });
      if (!silent) {
        toast.success(
          `TCMB döviz satış kuru (${body.date.split("-").reverse().join(".")}): USD ${fmtNum(body.USD.selling, 4)}, EUR ${fmtNum(body.EUR.selling, 4)}`,
        );
      }
    } catch (error) {
      if (!silent) {
        toast.error(
          `TCMB kuru alınamadı: ${errorMessage(error)}. Kuru elle yazabilirsiniz.`,
        );
      }
    } finally {
      setFetchingRates(false);
    }
  }

  // Yeni teklifte kur boşsa TCMB'den bir kez otomatik al. Kayıtlı teklifin
  // kuru sabit kalır; güncellemek için düğmeye basılır.
  useEffect(() => {
    if (offerId || autoRatesTried || !isAdmin) return;
    setAutoRatesTried(true);
    if (rates.USD > 0 && rates.EUR > 0) return;
    void fetchTcmbRates(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerId, autoRatesTried, isAdmin]);

  // Satış fırsatından açılan yeni teklifte alıcı bilgilerini doldur (bir kez).
  const [leadPrefilled, setLeadPrefilled] = useState(false);
  useEffect(() => {
    const lead = dataQuery.data?.lead;
    if (offerId || leadPrefilled || !lead) return;
    setLeadPrefilled(true);
    setTitle((t) => t || lead.title);
    if (lead.customer_id) {
      setRecipient((r) => ({ ...r, mode: "kayitli" }));
      setCustomerId(lead.customer_id);
    } else {
      setRecipient({
        mode: "aday",
        name: lead.company_name || lead.contact_name || lead.title,
        contactName: lead.company_name ? (lead.contact_name ?? "") : "",
        phone: lead.phone ?? "",
        email: lead.email ?? "",
      });
    }
    if (lead.location) setProjectLocation((l) => l || lead.location || "");
  }, [dataQuery.data, offerId, leadPrefilled]);

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
    setValidityTouched(true);
    const er = (offer.exchange_rates ?? {}) as Partial<StoredRates>;
    setRates({ USD: Number(er.USD ?? 0), EUR: Number(er.EUR ?? 0) });
    setRateMeta({
      source: er.source === "TCMB" ? "TCMB" : "manual",
      tcmbDate: er.tcmbDate,
    });
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
      setFinance({ ...defaultFinance, ...cfg.finance });
      setShowPricePerWp(cfg.showPricePerWp ?? true);
      const loadedSite = { ...defaultSite, ...cfg.site };
      setSite(loadedSite);
      setShowDesigner(loadedSite.faces.length > 0 || loadedSite.lat !== null);
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
  // NES kuralı: kalemlere göre geçerlilik süresi (7 / 15 / 30 gün).
  const validity = useMemo(() => validityRule(priced), [priced]);
  const suggestedValidUntil = addDays(validity.days);
  useEffect(() => {
    if (offerId || validityTouched || priced.length === 0) return;
    setValidUntil(suggestedValidUntil);
  }, [offerId, validityTouched, priced.length, suggestedValidUntil]);
  const marginTooLow = belowMarginFloor(totals.sale, totals.margin);
  const monthlyPerKwp = monthlyPerKwpFor(specificYield, site.pvgis);
  const siteLayout = useMemo(() => layoutSite(site), [site]);
  const gesSale = totals.byModule.find((m) => m.module === "ges")?.sale ?? 0;
  const gesCost = priced
    .filter((line) => line.module === "ges")
    .reduce((sum, line) => sum + line.totalCost, 0);
  const gesInvestment = finance.includeVat ? gesSale * (1 + vatRate) : gesSale;
  const investmentTl =
    currency === "TRY"
      ? gesInvestment
      : rates[currency] > 0
        ? convert(gesInvestment, currency, "TRY", rates)
        : null;
  const financeResult = financeAnalysis({
    kwp,
    monthlyPerKwp,
    finance,
    investmentTl: investmentTl ?? 0,
  });
  const salePerWp = usdPerWp(gesSale, currency, rates, kwp);
  const costPerWp = usdPerWp(gesCost, currency, rates, kwp);
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
  if (
    ges.enabled &&
    site.faces.length > 0 &&
    ges.panelCount > siteLayout.total
  ) {
    checks.push({
      level: "warning",
      field: "ges",
      message: `GES: çizilen çatıya ${siteLayout.total} panel sığıyor, teklifte ${ges.panelCount} panel var.`,
      fix: 'Panel adedini azaltın ("Panel adedini teklife aktar"), daha güçlü panel seçin, kenar boşluğunu küçültün veya başka bir yüzey çizin.',
    });
  }
  if (ges.enabled && kwp > 0 && site.pvgis === null && site.lat !== null) {
    checks.push({
      level: "warning",
      field: "ges",
      message: "GES: konum/çatı değişti, üretim PVGIS ile güncellenmedi.",
      fix: 'Saha bölümünde "PVGIS üretimini al"a basın; basmazsanız elle yazılan özgül üretim kullanılır.',
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

  // Asistandan gelen ön doldurma: yeni teklifte bir kez uygulanır, sonra
  // kalemler oluşturulur. Kullanıcı kontrol edip Kaydet'e basar.
  const [prefillDone, setPrefillDone] = useState(false);
  const [prefillRegenerate, setPrefillRegenerate] = useState(false);
  useEffect(() => {
    if (offerId || prefillDone || !search.kwp) return;
    if (catalog.length === 0 || !(rates.USD > 0)) return;
    setPrefillDone(true);
    const systemType = search.sistem ?? "ongrid";
    const { ges: next, notes } = applyPackage(
      {
        id: "asistan",
        name: "Asistan",
        description: "",
        systemType,
        targetKwp: search.kwp,
        batteryKwh: systemType === "hibrit" ? (search.batarya ?? 0) : 0,
      },
      {
        ...ges,
        systemType,
        projectType: systemType === "hibrit" ? "hibrit" : ges.projectType,
      },
      catalog,
      rates,
    );
    setGes(next);
    setTargetKwp(search.kwp);
    if (search.baslik) setTitle(search.baslik);
    if (search.konum) setProjectLocation(search.konum);
    if (search.musteri) {
      setRecipient((r) => ({ ...r, mode: "kayitli" }));
      setCustomerId(search.musteri);
    } else if (search.aday) {
      setRecipient((r) => ({ ...r, mode: "aday", name: search.aday ?? "" }));
    }
    setPrefillRegenerate(true);
    toast.success(
      `Asistan teklifi hazırladı (${fmtNum(search.kwp)} kWp ${systemType === "hibrit" ? "hibrit" : "on-grid"}). Kontrol edip Kaydet'e basın.${notes.length ? ` ${notes.join(" ")}` : ""}`,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerId, prefillDone, search, catalog, rates]);
  useEffect(() => {
    if (!prefillRegenerate) return;
    setPrefillRegenerate(false);
    regenerate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillRegenerate, ges]);

  function applyGlobalMarkup() {
    // Taahhüt kalemleri kütüphanedeki kategori kâr oranlarıyla gelir
    // (şantiye %40, topraklama %45, sıva altı %30, işçilik %20); genel oran
    // onları ezmez. Hepsini değiştirmek için hedef satış "Dağıt" kullanılır.
    setLines((current) =>
      current.map((line) =>
        line.module === "taahhut" ? line : { ...line, markupRate },
      ),
    );
    const kept = lines.filter((line) => line.module === "taahhut").length;
    toast.success(
      `GES, şarj ve genel kalemlere %${fmtNum(markupRate * 100)} kâr uygulandı.${kept ? ` ${kept} taahhüt kalemi kendi kategori oranında kaldı.` : ""}`,
    );
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
    // asRevision: mevcut teklifin -R1, -R2… numaralı yeni taslak kopyası.
    mutationFn: async (options?: { asRevision?: boolean }) => {
      const asRevision = Boolean(options?.asRevision && offerId);
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
        finance,
        showPricePerWp,
        site,
      };
      const header = {
        title: title.trim(),
        customer_id: recipient.mode === "kayitli" ? customerId || null : null,
        offer_type: "diger",
        status: asRevision ? ("draft" as Status) : status,
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
          source: rateMeta.source,
          tcmbDate: rateMeta.source === "TCMB" ? rateMeta.tcmbDate : undefined,
        } satisfies StoredRates as unknown as Json,
        payment_plan: paymentPlan as unknown as Json,
        terms_note: terms.trim() || null,
        // Teklif gönderilince veritabanı otomatik aday açabilir; kayıtta o
        // bağlantı silinmesin.
        lead_id:
          dataQuery.data?.lead?.id ?? dataQuery.data?.offer?.lead_id ?? null,
      };
      let id = asRevision ? undefined : offerId;
      let savedOfferNo = asRevision
        ? null
        : (dataQuery.data?.offer?.offer_no ?? null);
      let revisionNo: string | null = null;
      if (asRevision) {
        const current = dataQuery.data?.offer?.offer_no;
        if (!current) throw new Error("Teklif numarası bulunamadı.");
        const { data: siblings, error: siblingError } = await supabase
          .from("offers")
          .select("offer_no")
          .like("offer_no", `${baseOfferNo(current)}%`);
        if (siblingError) throw siblingError;
        revisionNo = nextRevisionNo(
          current,
          (siblings ?? []).map((row) => row.offer_no as string),
        );
      }
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
          .insert({
            ...header,
            created_by: user.id,
            ...(revisionNo ? { offer_no: revisionNo } : {}),
          })
          .select("id, offer_no")
          .single();
        if (error) throw error;
        id = data.id as string;
        savedOfferNo = (data.offer_no as string) ?? null;
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
      // Müşteri dosyası da saklanır: Teklifler listesinden hazırlayıcıya
      // girmeden açılıp PDF olarak yazdırılabilsin. Belge üretilemezse kayıt
      // yine de başarılı sayılır.
      try {
        const { error: documentError } = await supabase
          .from("offer_documents")
          .upsert({
            offer_id: id as string,
            html: customerHtml(savedOfferNo ?? undefined),
            updated_by: user.id,
            updated_at: new Date().toISOString(),
          });
        if (documentError) throw documentError;
      } catch (documentError) {
        console.error("Teklif dosyası saklanamadı", documentError);
      }
      // Fırsat henüz teklif aşamasına gelmediyse ilerlet ve geçmişe yaz.
      const lead = dataQuery.data?.lead;
      if (lead && !offerId && !asRevision) {
        if (["yeni", "gorusuldu", "kesif"].includes(lead.stage)) {
          await supabase
            .from("sales_leads")
            .update({ stage: "teklif" })
            .eq("id", lead.id);
        }
        await supabase.from("sales_activities").insert({
          lead_id: lead.id,
          customer_id: lead.customer_id,
          kind: "teklif",
          summary: `Teklif hazırlandı: ${title.trim()} (${formatMoney(totals.sale, currency)} + KDV)`,
        });
        await queryClient.invalidateQueries({ queryKey: ["sales-page"] });
      }
      return id as string;
    },
    onSuccess: async (id, options) => {
      await queryClient.invalidateQueries({ queryKey: ["offers-page"] });
      toast.success(
        options?.asRevision
          ? "Revizyon taslak olarak oluşturuldu."
          : "Teklif kaydedildi.",
      );
      if (
        !options?.asRevision &&
        status !== "draft" &&
        belowMarginFloor(totals.sale, totals.margin)
      ) {
        toast.warning(
          `Brüt marj %${fmtNum(totals.margin * 100, 1)}: NES alt sınırı %${fmtNum(MIN_GROSS_MARGIN * 100)}'un altında.`,
        );
      }
      if (id !== offerId) {
        setLoadedOfferId(id);
        await navigate({ to: "/energy-offer", search: { offerId: id } });
      } else {
        await queryClient.invalidateQueries({ queryKey: ["energy-offer", id] });
      }
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  function documentInput(offerNoOverride?: string) {
    return {
      offerNo: offerNoOverride ?? dataQuery.data?.offer?.offer_no ?? "TASLAK",
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
      production:
        kwp > 0 ? productionEstimate(kwp, specificYield, monthlyPerKwp) : null,
      finance: financeResult,
      showPricePerWp,
      salePerWp,
      rateSource: rateMeta.source,
      tcmbDate: rateMeta.tcmbDate,
      layout:
        siteLayout.total > 0
          ? {
              svg: layoutSvg(site, ges.panelCount),
              faces: site.faces.map((face, index) => ({
                name: face.name,
                panels: Math.min(
                  siteLayout.faces[index]?.count ?? 0,
                  Math.max(
                    0,
                    ges.panelCount -
                      siteLayout.faces
                        .slice(0, index)
                        .reduce((sum, f) => sum + f.count, 0),
                  ),
                ),
                tilt: face.tilt,
                direction: azimuthLabel(face.azimuth),
                areaM2: siteLayout.faces[index]?.areaM2 ?? 0,
              })),
            }
          : null,
      productionSource: site.pvgis
        ? `PVGIS (${site.pvgis.db}), ${site.pvgis.lat.toFixed(4)}, ${site.pvgis.lon.toFixed(4)}`
        : "",
    };
  }

  /** Müşteri dosyasının HTML'i (yazdır düğmesi dahil). */
  function customerHtml(offerNoOverride?: string) {
    const input = documentInput(offerNoOverride);
    const offerHtml =
      layout === "teknik"
        ? buildTechnicalOffer(input, technical)
        : buildOfferDocument(input);
    return offerHtml.replace(
      "</body>",
      `<div class="noprint" style="position:fixed;top:12px;right:12px;display:flex;gap:8px"><button onclick="window.print()" style="padding:10px 16px;border:0;border-radius:8px;background:#0B4EA2;color:#fff;font-weight:700;cursor:pointer">PDF olarak kaydet / Yazdır</button></div><style>@media print{.noprint{display:none!important}}</style></body>`,
    );
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
    win.document.open();
    win.document.write(customerHtml());
    win.document.close();
  }

  /** Link için: önce kaydet, sonra müşteri dosyasını üret. */
  async function prepareShare() {
    if (errors.length > 0) {
      toast.error(`Önce kırmızı kontrolleri düzeltin: ${errors[0].message}`);
      return null;
    }
    await save.mutateAsync(undefined);
    return customerHtml();
  }

  /** NES maliyet tablolarındaki başlık biçimi, ör. "22,5 kWp DC - 20 kWe AC -
   * 20 kWh batarya kapasiteli GES (DEYE + BYD)". */
  function excelModuleTitles() {
    const brandOf = (id: string) =>
      catalog.find((item) => item.id === id)?.brand?.toLocaleUpperCase("tr-TR");
    const brands = [brandOf(ges.inverterId), brandOf(ges.batteryId)]
      .filter(Boolean)
      .join(" + ");
    const station = catalog.find((item) => item.id === sarj.stationId);
    return {
      ges: `${formatKwp(kwp)} kWp DC - ${formatKwp(acKw)} kWe AC${batteryKwh > 0 ? ` - ${formatKwp(batteryKwh)} kWh batarya kapasiteli` : ""} GES${brands ? ` (${brands})` : ""}`,
      sarj: station
        ? `${sarj.stationCount} adet ${station.brand ?? ""} ${formatKwp(Number(station.power_kw ?? 0))} kW şarj istasyonu`
        : "Şarj",
      taahhut: `${title.trim() || "Taahhüt"} - elektrik taahhüt`,
      genel: "Genel giderler",
    };
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
        moduleTitles: excelModuleTitles(),
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
            {offerId && dataQuery.data?.offer?.offer_no ? (
              <Button
                variant="outline"
                className="h-11"
                onClick={() => save.mutate({ asRevision: true })}
                disabled={save.isPending}
                title="Bu teklifin ekrandaki haliyle -R1, -R2… numaralı yeni bir taslak oluşturur; eski teklif olduğu gibi kalır."
              >
                <CopyPlus className="mr-2 h-4 w-4" /> Revizyon oluştur
              </Button>
            ) : null}
            <Button
              className="h-11 font-bold"
              onClick={() => save.mutate(undefined)}
              disabled={save.isPending}
            >
              <Save className="mr-2 h-4 w-4" />
              {save.isPending ? "Kaydediliyor..." : "Kaydet"}
            </Button>
          </div>
        }
      />

      {dataQuery.data?.lead ? (
        <p className="-mt-3 mb-4 text-xs text-muted-foreground">
          Satış fırsatı:{" "}
          <Link
            to="/sales"
            search={{ leadId: dataQuery.data.lead.id }}
            className="font-semibold text-primary underline-offset-2 hover:underline"
          >
            {dataQuery.data.lead.title}
          </Link>
        </p>
      ) : null}
      {ges.enabled ? (
        <div className="mb-4">
          <OfferStepper
            steps={[
              {
                id: "cati",
                label: "Çatı",
                done: site.faces.length > 0 || ges.panelCount > 0,
                detail:
                  site.faces.length > 0
                    ? `${site.faces.length} yüzey çizildi`
                    : ges.panelCount > 0
                      ? "Paket / elle güç"
                      : "Haritada çiz ya da paket seç",
                target: "bolum-ges",
              },
              {
                id: "tasarim",
                label: "Tasarım",
                done: Boolean(ges.panelId) && ges.panelCount > 0,
                detail:
                  ges.panelCount > 0
                    ? `${ges.panelCount} panel · ${formatKwp(kwp)} kWp`
                    : "Panel ve adet seçin",
                target: "bolum-ges",
              },
              {
                id: "sistem",
                label: "Sistem",
                done:
                  Boolean(ges.inverterId) &&
                  (ges.systemType !== "hibrit" || Boolean(ges.batteryId)),
                detail: ges.inverterId
                  ? `${formatKwp(acKw)} kW inverter${batteryKwh > 0 ? ` · ${formatKwp(batteryKwh)} kWh` : ""}`
                  : "İnverter seçin",
                target: "bolum-ges",
              },
              {
                id: "teklif",
                label: "Teklif",
                done: lines.length > 0 && Boolean(dataQuery.data?.offer),
                detail:
                  lines.length > 0
                    ? `${lines.length} kalem${dataQuery.data?.offer ? "" : " · kaydedilmedi"}`
                    : "Kalemleri oluşturun",
                target: "bolum-kalemler",
              },
            ]}
            kpis={[
              { label: "Güç", value: kwp > 0 ? `${formatKwp(kwp)} kWp` : "-" },
              {
                label: "Yıllık üretim",
                value:
                  kwp > 0 && financeResult
                    ? `${fmtNum(financeResult.annualProductionKwh)} kWh`
                    : "-",
              },
              {
                label: "Geri dönüş",
                value:
                  financeResult?.paybackYears != null && investmentTl
                    ? `${financeResult.paybackYears.toLocaleString("tr-TR")} yıl`
                    : "-",
              },
              {
                label: "Satış",
                value: salePerWp !== null ? formatUsdPerWp(salePerWp) : "-",
              },
            ]}
          />
        </div>
      ) : null}
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
            <Field
              label="USD kuru (TL)"
              hint={
                rateMeta.source === "TCMB" && rateMeta.tcmbDate
                  ? `TCMB döviz satış, ${rateMeta.tcmbDate.split("-").reverse().join(".")}`
                  : "Elle girildi"
              }
            >
              <NumField
                value={rates.USD}
                onChange={(USD) => {
                  setRates((r) => ({ ...r, USD }));
                  setRateMeta({ source: "manual" });
                }}
                placeholder="Örn. 41,85"
              />
            </Field>
            <Field label="EUR kuru (TL)" hint="1 EUR kaç TL">
              <div className="flex gap-1.5">
                <NumField
                  value={rates.EUR}
                  onChange={(EUR) => {
                    setRates((r) => ({ ...r, EUR }));
                    setRateMeta({ source: "manual" });
                  }}
                  placeholder="Örn. 48,60"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 shrink-0 px-2.5"
                  onClick={() => void fetchTcmbRates()}
                  disabled={fetchingRates}
                  title="TCMB döviz satış kurunu al (kayıtlı teklifin kuru siz basmadıkça değişmez)"
                >
                  <Landmark className="mr-1 h-4 w-4" />
                  {fetchingRates ? "..." : "TCMB"}
                </Button>
              </div>
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
                onChange={(e) => {
                  setValidUntil(e.target.value);
                  setValidityTouched(true);
                }}
              />
              {priced.length > 0 ? (
                <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                  Kural: {validity.days} gün ({validity.reason})
                  {validUntil !== suggestedValidUntil ? (
                    <>
                      {" · "}
                      <button
                        type="button"
                        className="font-semibold text-primary hover:underline"
                        onClick={() => {
                          setValidUntil(suggestedValidUntil);
                          setValidityTouched(true);
                        }}
                      >
                        Uygula
                      </button>
                    </>
                  ) : null}
                </p>
              ) : null}
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
              <>
                <div className="mb-4">
                  <ProjectTypePicker
                    value={ges.projectType}
                    onSelect={(type) => {
                      setGes((g) => ({
                        ...g,
                        projectType: type.id,
                        systemType: type.systemType,
                        roofType: type.roofType,
                        inverterId:
                          type.systemType === g.systemType ? g.inverterId : "",
                      }));
                      toast.success(
                        `${type.title}: ${type.systemType === "hibrit" ? "hibrit" : "on-grid"} sistem, ${type.roofType === "arazi" ? "arazi sehpası" : type.roofType === "trapez" ? "trapez çatı" : "kiremit çatı"} seçildi.`,
                      );
                    }}
                  />
                </div>
                <PackagePicker
                  ges={ges}
                  catalog={catalog}
                  rates={rates}
                  onApply={(next, target) => {
                    setGes(next);
                    setTargetKwp(target);
                  }}
                />
                <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
                        <SelectItem value="hibrit">
                          Hibrit (bataryalı)
                        </SelectItem>
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
                  <Field
                    label="DC kablo (m)"
                    hint="NES tablolarında 9–22,5 kWp için 100–120 m"
                  >
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
                    hint={
                      site.pvgis
                        ? `PVGIS: ${fmtNum(site.pvgis.kwhPerKwp, 0)} (eğim ${site.pvgis.tilt}°, ${azimuthLabel(site.pvgis.azimuth)})`
                        : "Muğla için tipik 1.450–1.550; PVGIS ile hesaplatın"
                    }
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
                        {fmtNum(
                          productionEstimate(kwp, specificYield).annual,
                          0,
                        )}{" "}
                        kWh
                      </Badge>
                    ) : null}
                    <Badge variant="secondary">AC: {formatKwp(acKw)} kW</Badge>
                    {acKw > 0 && kwp > 0 ? (
                      <Badge variant="outline">
                        DC/AC {fmtNum(kwp / acKw)}
                      </Badge>
                    ) : null}
                    {batteryKwh > 0 ? (
                      <Badge variant="secondary">
                        Batarya: {formatKwp(batteryKwh)} kWh
                      </Badge>
                    ) : null}
                    {salePerWp !== null ? (
                      <Badge variant="outline">
                        Satış {formatUsdPerWp(salePerWp)}
                      </Badge>
                    ) : null}
                  </div>
                </div>
                {showDesigner ? (
                  <SiteDesigner
                    site={site}
                    onChange={setSite}
                    panelW={panelW}
                    currentPanelCount={ges.panelCount}
                    defaultMount={ges.roofType === "arazi" ? "sehpa" : "cati"}
                    onApplyPanelCount={(count) => {
                      setGes((g) => ({
                        ...g,
                        panelCount: count,
                        dcCableM: defaultDcCable((count * panelW) / 1000),
                      }));
                      setTargetKwp(0);
                      toast.success(
                        `${count} panel teklife aktarıldı. İnverteri kontrol edip "Kalemleri oluştur"a basın.`,
                      );
                    }}
                    onPvgis={(result) => setSpecificYield(result.kwhPerKwp)}
                    onLocationLabel={(label) => {
                      if (!projectLocation.trim()) setProjectLocation(label);
                    }}
                  />
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-4 w-full"
                    onClick={() => setShowDesigner(true)}
                  >
                    Haritada çatı çiz ve PVGIS üretimi al
                  </Button>
                )}
                <FinancePanel
                  finance={finance}
                  onChange={setFinance}
                  kwp={kwp}
                  monthlyPerKwp={monthlyPerKwp}
                  specificYield={specificYield}
                  investmentTl={investmentTl}
                  ges={ges}
                  catalog={catalog}
                  onTargetKwp={(target) => {
                    setTargetKwp(target);
                    if (panelW > 0) {
                      const count = panelsForTarget(target, panelW);
                      setGes((g) => ({
                        ...g,
                        panelCount: count,
                        dcCableM: defaultDcCable((count * panelW) / 1000),
                      }));
                      toast.success(
                        `${count} panel ayarlandı. "Kalemleri oluştur"a basın.`,
                      );
                    } else {
                      toast.message("Önce panel seçin; hedef güç yazıldı.");
                    }
                  }}
                  onBattery={(batteryId, count) => {
                    const wasOngrid = ges.systemType !== "hibrit";
                    setGes((g) => ({
                      ...g,
                      systemType: "hibrit",
                      batteryId,
                      batteryCount: count,
                      inverterId: wasOngrid ? "" : g.inverterId,
                    }));
                    toast.success(
                      wasOngrid
                        ? 'Sistem hibrite çevrildi ve batarya eklendi. Hibrit inverter seçin ("Uygun olanı seç"), sonra "Kalemleri oluştur".'
                        : 'Batarya eklendi. Kontrolleri ve inverter uyumunu gözden geçirip "Kalemleri oluştur"a basın.',
                    );
                  }}
                />
              </>
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
                  ve yardımcı kalemleri NES maliyet tablolarına göre üretir
                  (işçilik, nakliye ve GES panosu kWp kademeli götürü); elle
                  eklenen kalemler korunur. "Tümüne uygula" GES, şarj ve genel
                  kalemlere tek kâr oranı verir; taahhüt kalemleri kütüphanedeki
                  kategori oranında kalır. Hedef satış tutarını yazıp "Dağıt"a
                  basarsanız tüm kalemlere aynı oran dağıtılır.
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
                      {/* Sayı kutuları sabit genişlikte: tablo dar ekranda
                          sütunları sıkıştırıp kutuları 25-40 px'e
                          düşürüyor, değer (ör. kâr %30) görünmüyordu. */}
                      <TableHead className="min-w-[240px]">Açıklama</TableHead>
                      <TableHead>Modül</TableHead>
                      <TableHead className="min-w-[96px]">Miktar</TableHead>
                      <TableHead className="min-w-[150px]">
                        Alış (birim)
                      </TableHead>
                      <TableHead className="min-w-[96px]">Kâr %</TableHead>
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
                        className={`${line.visibleToCustomer ? "" : "opacity-50"} ${line.sourceUnitCost > 0 ? "" : "bg-red-50 dark:bg-red-950/40"}`}
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
                          {line.sourceUnitCost > 0 ? null : (
                            <p className="mt-1 text-[11px] font-bold text-red-600">
                              Alış fiyatı 0 — neden 0? Maliyet yazın ya da
                              bilerek 0 ise (NES kendi yapıyor vb.) bırakın.
                            </p>
                          )}
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
                            className="h-9 w-20 text-right"
                            value={line.quantity}
                            onChange={(quantity) =>
                              updateLine(line.key, { quantity })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <NumField
                              className="h-9 w-28 text-right"
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
                            className="h-9 w-20 text-right"
                            value={round2(line.markupRate * 100)}
                            onChange={(v) =>
                              updateLine(line.key, {
                                markupRate: Math.max(0, v) / 100,
                              })
                            }
                          />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right text-xs">
                          {formatMoney(line.totalCost, currency)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-bold">
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
              <div
                className={`flex justify-between ${marginTooLow ? "font-bold text-destructive" : ""}`}
              >
                <span>Kâr marjı (satış üzerinden)</span>
                <span>%{fmtNum(totals.margin * 100, 1)}</span>
              </div>
              {marginTooLow ? (
                <p className="mt-1 rounded bg-destructive/10 p-2 text-destructive">
                  Brüt marj NES alt sınırı %{fmtNum(MIN_GROSS_MARGIN * 100)}
                  &apos;un altında. Bu fiyatla göndermek bilinçli karar
                  gerektirir.
                </p>
              ) : null}
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
              {kwp > 0 && gesSale > 0 ? (
                <div className="flex justify-between">
                  <span>GES kWp başı satış</span>
                  <span>{formatMoney(gesSale / kwp, currency)}</span>
                </div>
              ) : null}
              {salePerWp !== null ? (
                <div className="flex justify-between">
                  <span>GES satış / maliyet</span>
                  <span>
                    {formatUsdPerWp(salePerWp)} / {formatUsdPerWp(costPerWp)}
                  </span>
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
              <span>Watt başı fiyatı göster ($/Wp)</span>
              <Switch
                checked={showPricePerWp}
                onCheckedChange={setShowPricePerWp}
              />
            </label>
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

          <ShareLinkPanel offerId={offerId} prepare={prepareShare} />

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

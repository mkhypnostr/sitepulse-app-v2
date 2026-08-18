import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ExternalLink,
  FileSpreadsheet,
  FolderOpen,
  Pencil,
  Plus,
  Trash2,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { errorMessage } from "@/lib/domain";
import {
  AccessDenied,
  EmptyState,
  LoadingState,
  PageHeader,
} from "@/components/page-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/offers")({
  component: OffersPage,
});

const offerTypes = {
  hizli_teklif: "Hızlı Teklif",
  siva_alti: "Sıva Altı",
  montaj: "Montaj",
  diger: "Diğer",
} as const;

type OfferType = keyof typeof offerTypes;

const lineItemCategories = {
  malzeme: "Malzeme",
  iscilik: "İşçilik",
  nakliye_sarf: "Nakliye/Sarf",
  diger: "Diğer",
} as const;

type LineItemCategory = keyof typeof lineItemCategories;

const statuses = {
  draft: "Taslak",
  internal_review: "İç Onay",
  sent: "Müşteriye Gönderildi",
  revision_pending: "Revizyon Bekliyor",
  approved: "Onaylandı",
  lost: "Kaybedildi",
  cancelled: "İptal",
} as const;

function statusVariant(status: keyof typeof statuses) {
  if (status === "approved") return "default";
  if (status === "lost" || status === "cancelled") return "destructive";
  if (status === "sent" || status === "revision_pending") return "secondary";
  return "outline";
}

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDecimalInput(value: number) {
  return String(Math.round(value * 100) / 100).replace(".", ",");
}

type OfferLineItemDraft = {
  clientId: string;
  category: LineItemCategory;
  description: string;
  brand: string;
  unit: string;
  quantity: string;
  unitCost: string;
  laborCost: string;
  subcontractorCost: string;
  logisticsCost: string;
  riskCost: string;
  markupPercent: string;
  manualSaleAmount: string;
  visibleToCustomer: boolean;
};

function emptyLineItem(
  overrides: Partial<OfferLineItemDraft> = {},
): OfferLineItemDraft {
  return {
    clientId: crypto.randomUUID(),
    category: "malzeme",
    description: "",
    brand: "",
    unit: "adet",
    quantity: "1",
    unitCost: "0",
    laborCost: "0",
    subcontractorCost: "0",
    logisticsCost: "0",
    riskCost: "0",
    markupPercent: "0",
    manualSaleAmount: "",
    visibleToCustomer: true,
    ...overrides,
  };
}

const offerTypeTemplates: Record<OfferType, Array<Partial<OfferLineItemDraft>>> =
  {
    hizli_teklif: [],
    siva_alti: [
      {
        category: "iscilik",
        description: "Borulama, kasa ve buat uygulaması",
        unit: "takım",
      },
      {
        category: "iscilik",
        description: "Kablo çekimi ve hat etiketleme",
        unit: "takım",
      },
      {
        category: "iscilik",
        description: "Topraklama uygulaması",
        unit: "takım",
      },
      {
        category: "nakliye_sarf",
        description: "Nakliye ve sarf malzemeleri",
        unit: "götürü",
      },
    ],
    montaj: [
      {
        category: "malzeme",
        description: "Pano sigortaları ve pano içi bağlantılar",
        unit: "takım",
      },
      {
        category: "iscilik",
        description: "Anahtar, priz ve mekanizma montajı",
        unit: "takım",
      },
      {
        category: "iscilik",
        description: "Aydınlatma armatürü montajı",
        unit: "takım",
      },
      {
        category: "iscilik",
        description: "Test ve devreye alma",
        unit: "götürü",
      },
    ],
    diger: [],
  };

function safeParseNumber(value: string) {
  const normalized = value.trim().replace(/\./g, "").replace(",", ".");
  const result = Number(normalized === "" ? "0" : normalized);
  return Number.isFinite(result) ? result : 0;
}

function previewLineTotals(item: OfferLineItemDraft) {
  const quantity = safeParseNumber(item.quantity);
  const unitCost = safeParseNumber(item.unitCost);
  const laborCost = safeParseNumber(item.laborCost);
  const subcontractorCost = safeParseNumber(item.subcontractorCost);
  const logisticsCost = safeParseNumber(item.logisticsCost);
  const riskCost = safeParseNumber(item.riskCost);
  const markupRate = safeParseNumber(item.markupPercent) / 100;
  const manualSale =
    item.manualSaleAmount.trim() === ""
      ? null
      : safeParseNumber(item.manualSaleAmount);
  const materialCost = quantity * unitCost;
  const totalCost =
    materialCost + laborCost + subcontractorCost + logisticsCost + riskCost;
  const computedSale = totalCost * (1 + markupRate);
  const appliedSale = manualSale ?? computedSale;
  return { materialCost, totalCost, computedSale, appliedSale };
}

function requireNumber(
  value: string,
  label: string,
  min: number,
  max: number = Infinity,
): number {
  const normalized = value.trim().replace(/\./g, "").replace(",", ".");
  const result = Number(normalized === "" ? "0" : normalized);
  if (!Number.isFinite(result)) {
    throw new Error(`${label} geçerli bir sayı olmalı.`);
  }
  if (result < min) {
    throw new Error(
      min > 0 ? `${label} 0'dan büyük olmalı.` : `${label} negatif olamaz.`,
    );
  }
  if (result > max) {
    throw new Error(`${label} en fazla ${max} olabilir.`);
  }
  return result;
}

function buildLineItemPayload(
  item: OfferLineItemDraft,
  index: number,
  offerId: string,
) {
  const label = item.description.trim() || `Kalem ${index + 1}`;
  if (item.description.trim().length < 1) {
    throw new Error(`${label}: açıklama boş olamaz.`);
  }
  const quantity = requireNumber(item.quantity, `${label}: miktar`, 0.0001);
  const unitCost = requireNumber(item.unitCost, `${label}: alış birim fiyatı`, 0);
  const laborCost = requireNumber(item.laborCost, `${label}: işçilik maliyeti`, 0);
  const subcontractorCost = requireNumber(
    item.subcontractorCost,
    `${label}: taşeron maliyeti`,
    0,
  );
  const logisticsCost = requireNumber(
    item.logisticsCost,
    `${label}: nakliye/sarf maliyeti`,
    0,
  );
  const riskCost = requireNumber(
    item.riskCost,
    `${label}: diğer/risk maliyeti`,
    0,
  );
  const markupPercent = requireNumber(
    item.markupPercent,
    `${label}: kâr oranı`,
    0,
  );
  const manualSale =
    item.manualSaleAmount.trim() === ""
      ? null
      : requireNumber(item.manualSaleAmount, `${label}: elle satış tutarı`, 0);
  return {
    offer_id: offerId,
    sort_order: index,
    category: item.category,
    description: item.description.trim(),
    brand: item.brand.trim() || null,
    unit: item.unit.trim() || "adet",
    quantity,
    unit_cost: unitCost,
    labor_cost: laborCost,
    subcontractor_cost: subcontractorCost,
    logistics_cost: logisticsCost,
    risk_cost: riskCost,
    markup_rate: markupPercent / 100,
    manual_sale_amount: manualSale,
    visible_to_customer: item.visibleToCustomer,
  };
}

function toDraftFromRow(row: {
  id: string;
  category: string;
  description: string;
  brand: string | null;
  unit: string;
  quantity: number;
  unit_cost: number;
  labor_cost: number;
  subcontractor_cost: number;
  logistics_cost: number;
  risk_cost: number;
  markup_rate: number;
  manual_sale_amount: number | null;
  visible_to_customer: boolean;
}): OfferLineItemDraft {
  return {
    clientId: row.id,
    category: (row.category as LineItemCategory) ?? "malzeme",
    description: row.description,
    brand: row.brand ?? "",
    unit: row.unit,
    quantity: formatDecimalInput(row.quantity),
    unitCost: formatDecimalInput(row.unit_cost),
    laborCost: formatDecimalInput(row.labor_cost),
    subcontractorCost: formatDecimalInput(row.subcontractor_cost),
    logisticsCost: formatDecimalInput(row.logistics_cost),
    riskCost: formatDecimalInput(row.risk_cost),
    markupPercent: formatDecimalInput(row.markup_rate * 100),
    manualSaleAmount:
      row.manual_sale_amount == null
        ? ""
        : formatDecimalInput(row.manual_sale_amount),
    visibleToCustomer: row.visible_to_customer,
  };
}

function normalizeOptionalUrl(value: string, label: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error(`${label} http:// veya https:// ile başlamalı.`);
  }
  return trimmed;
}

const initialForm = {
  customerId: "",
  title: "",
  offerType: "hizli_teklif" as OfferType,
  currency: "TRY",
  validUntil: "",
  sourceSummary: "",
  notes: "",
  totalAmountMode: "computed" as "computed" | "manual",
  manualTotalAmount: "",
  vatRatePercent: "20",
  driveExcelUrl: "",
  driveFolderUrl: "",
};

function OffersPage() {
  const { role, user } = useAuth();
  const canManageOffers = role === "admin";
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editingOfferId, setEditingOfferId] = useState<string | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [lineItems, setLineItems] = useState<OfferLineItemDraft[]>([]);
  const [statusFilter, setStatusFilter] = useState<
    "all" | keyof typeof statuses
  >("all");

  const pageQuery = useQuery({
    queryKey: ["offers-page"],
    enabled: canManageOffers,
    queryFn: async () => {
      const [offersResult, customersResult] = await Promise.all([
        supabase
          .from("offers")
          .select(
            "id, offer_no, title, offer_type, status, currency, total_amount, total_amount_mode, vat_rate, drive_excel_url, drive_folder_url, valid_until, source_summary, notes, customer_id, created_at, customers(name)",
          )
          .order("created_at", { ascending: false }),
        supabase.from("customers").select("id, name").order("name"),
      ]);
      if (offersResult.error) throw offersResult.error;
      if (customersResult.error) throw customersResult.error;
      return {
        offers: offersResult.data ?? [],
        customers: customersResult.data ?? [],
      };
    },
  });

  const summary = useMemo(() => {
    let totalCost = 0;
    let computedNetSale = 0;
    for (const item of lineItems) {
      const totals = previewLineTotals(item);
      totalCost += totals.totalCost;
      if (item.visibleToCustomer) computedNetSale += totals.appliedSale;
    }
    const vatRate = safeParseNumber(form.vatRatePercent) / 100;
    const manualTotal =
      form.manualTotalAmount.trim() === ""
        ? null
        : safeParseNumber(form.manualTotalAmount);
    const useManual = form.totalAmountMode === "manual";
    const finalTotal =
      useManual && manualTotal !== null ? manualTotal : computedNetSale;
    const difference =
      useManual && manualTotal !== null ? manualTotal - computedNetSale : 0;
    const hasDifference = useManual && Math.abs(difference) > 0.005;
    const profit = finalTotal - totalCost;
    const marginPct = finalTotal > 0 ? (profit / finalTotal) * 100 : 0;
    const vatAmount = finalTotal * vatRate;
    const grandTotal = finalTotal + vatAmount;
    return {
      totalCost,
      computedNetSale,
      finalTotal,
      difference,
      hasDifference,
      profit,
      marginPct,
      vatRate,
      vatAmount,
      grandTotal,
    };
  }, [
    lineItems,
    form.totalAmountMode,
    form.manualTotalAmount,
    form.vatRatePercent,
  ]);

  function closeDialog() {
    setOpen(false);
    setEditingOfferId(null);
    setEditLoading(false);
    setForm(initialForm);
    setLineItems([]);
  }

  function startCreate() {
    setEditingOfferId(null);
    setForm(initialForm);
    setLineItems([]);
    setOpen(true);
  }

  async function startEdit(offer: {
    id: string;
    customer_id: string | null;
    title: string;
    offer_type: string;
    currency: string;
    valid_until: string | null;
    source_summary: string | null;
    notes: string | null;
    total_amount: number;
    total_amount_mode: string | null;
    vat_rate: number | null;
    drive_excel_url: string | null;
    drive_folder_url: string | null;
  }) {
    setEditingOfferId(offer.id);
    setForm({
      customerId: offer.customer_id ?? "",
      title: offer.title,
      offerType: (offer.offer_type as OfferType) ?? "diger",
      currency: offer.currency,
      validUntil: offer.valid_until ?? "",
      sourceSummary: offer.source_summary ?? "",
      notes: offer.notes ?? "",
      totalAmountMode:
        offer.total_amount_mode === "manual" ? "manual" : "computed",
      manualTotalAmount: formatDecimalInput(Number(offer.total_amount ?? 0)),
      vatRatePercent: formatDecimalInput(Number(offer.vat_rate ?? 0.2) * 100),
      driveExcelUrl: offer.drive_excel_url ?? "",
      driveFolderUrl: offer.drive_folder_url ?? "",
    });
    setLineItems([]);
    setOpen(true);
    setEditLoading(true);
    try {
      const { data, error } = await supabase
        .from("offer_line_items")
        .select(
          "id, category, description, brand, unit, quantity, unit_cost, labor_cost, subcontractor_cost, logistics_cost, risk_cost, markup_rate, manual_sale_amount, visible_to_customer",
        )
        .eq("offer_id", offer.id)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      setLineItems((data ?? []).map(toDraftFromRow));
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setEditLoading(false);
    }
  }

  function addTemplateItems() {
    const template = offerTypeTemplates[form.offerType] ?? [];
    if (template.length === 0) return;
    setLineItems((current) => [
      ...current,
      ...template.map((partial) => emptyLineItem(partial)),
    ]);
  }

  function addBlankItem() {
    setLineItems((current) => [...current, emptyLineItem()]);
  }

  function removeItem(clientId: string) {
    setLineItems((current) => current.filter((item) => item.clientId !== clientId));
  }

  function updateItem(clientId: string, patch: Partial<OfferLineItemDraft>) {
    setLineItems((current) =>
      current.map((item) =>
        item.clientId === clientId ? { ...item, ...patch } : item,
      ),
    );
  }

  const saveOffer = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Oturum bulunamadı.");
      if (!form.customerId) throw new Error("Müşteri seçin.");
      if (form.title.trim().length < 3) {
        throw new Error("Teklif başlığı en az 3 karakter olmalıdır.");
      }
      if (form.totalAmountMode === "manual" && form.manualTotalAmount.trim() === "") {
        throw new Error("Elle nihai teklif bedeli girin.");
      }

      const vatRate =
        requireNumber(form.vatRatePercent, "KDV oranı (%)", 0, 100) / 100;
      const driveExcelUrl = normalizeOptionalUrl(
        form.driveExcelUrl,
        "Drive Excel bağlantısı",
      );
      const driveFolderUrl = normalizeOptionalUrl(
        form.driveFolderUrl,
        "Drive klasörü bağlantısı",
      );

      const headerPayload: {
        customer_id: string;
        title: string;
        offer_type: OfferType;
        currency: string;
        valid_until: string | null;
        source_summary: string | null;
        notes: string | null;
        total_amount_mode: "computed" | "manual";
        vat_rate: number;
        drive_excel_url: string | null;
        drive_folder_url: string | null;
        total_amount?: number;
      } = {
        customer_id: form.customerId,
        title: form.title.trim(),
        offer_type: form.offerType,
        currency: form.currency,
        valid_until: form.validUntil || null,
        source_summary: form.sourceSummary.trim() || null,
        notes: form.notes.trim() || null,
        total_amount_mode: form.totalAmountMode,
        vat_rate: vatRate,
        drive_excel_url: driveExcelUrl,
        drive_folder_url: driveFolderUrl,
      };

      if (form.totalAmountMode === "manual") {
        headerPayload.total_amount = requireNumber(
          form.manualTotalAmount,
          "Elle nihai teklif bedeli",
          0,
        );
      }

      let offerId = editingOfferId;

      if (editingOfferId) {
        const { error: updateError } = await supabase
          .from("offers")
          .update(headerPayload)
          .eq("id", editingOfferId);
        if (updateError) throw updateError;

        const { error: deleteError } = await supabase
          .from("offer_line_items")
          .delete()
          .eq("offer_id", editingOfferId);
        if (deleteError) throw deleteError;
      } else {
        const { data: inserted, error: insertError } = await supabase
          .from("offers")
          .insert({ ...headerPayload, created_by: user.id })
          .select("id")
          .single();
        if (insertError) throw insertError;
        offerId = inserted.id;
      }

      if (!offerId) throw new Error("Teklif kimliği alınamadı.");

      if (lineItems.length > 0) {
        const rows = lineItems.map((item, index) =>
          buildLineItemPayload(item, index, offerId as string),
        );
        const { error: itemsError } = await supabase
          .from("offer_line_items")
          .insert(rows);
        if (itemsError) throw itemsError;
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["offers-page"] });
      const wasEditing = Boolean(editingOfferId);
      closeDialog();
      toast.success(wasEditing ? "Teklif güncellendi." : "Teklif taslağı kaydedildi.");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const offers = useMemo(() => {
    const all = pageQuery.data?.offers ?? [];
    return statusFilter === "all"
      ? all
      : all.filter((offer) => offer.status === statusFilter);
  }, [pageQuery.data?.offers, statusFilter]);

  if (!canManageOffers) return <AccessDenied />;
  if (pageQuery.isLoading)
    return <LoadingState label="Teklifler yükleniyor..." />;

  const template = offerTypeTemplates[form.offerType] ?? [];

  const createButton = (
    <Button className="h-12 font-bold" onClick={startCreate}>
      <Plus className="mr-2 h-4 w-4" /> Yeni Teklif
    </Button>
  );

  const dialog = (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) closeDialog();
        else setOpen(true);
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>
            {editingOfferId ? "Teklifi düzenle" : "Teklif taslağı oluştur"}
          </DialogTitle>
          <DialogDescription>
            {editingOfferId
              ? "Kalemleri güncelledikten sonra kaydedin. Nihai teklif toplamını kalemlerden hesaplatabilir veya elle girebilirsiniz."
              : "TKF numarası kaydedildiğinde otomatik atanır. Nihai teklif toplamını kalemlerden hesaplatabilir veya elle girebilirsiniz."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">
            Müşteri
            <Select
              value={form.customerId}
              onValueChange={(customerId) =>
                setForm((current) => ({ ...current, customerId }))
              }
            >
              <SelectTrigger className="h-11">
                <SelectValue placeholder="Müşteri seçin" />
              </SelectTrigger>
              <SelectContent>
                {(pageQuery.data?.customers ?? []).map((customer) => (
                  <SelectItem key={customer.id} value={customer.id}>
                    {customer.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">
            Teklif başlığı
            <Input
              value={form.title}
              maxLength={180}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
              placeholder="Örn. Kazan dairesi elektrik tesisatı"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Teklif türü
            <Select
              value={form.offerType}
              onValueChange={(offerType) =>
                setForm((current) => ({
                  ...current,
                  offerType: offerType as OfferType,
                }))
              }
            >
              <SelectTrigger className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(offerTypes).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Para birimi
            <Select
              value={form.currency}
              onValueChange={(currency) =>
                setForm((current) => ({ ...current, currency }))
              }
            >
              <SelectTrigger className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TRY">TRY · Türk Lirası</SelectItem>
                <SelectItem value="EUR">EUR · Euro</SelectItem>
                <SelectItem value="USD">USD · ABD Doları</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Geçerlilik tarihi
            <Input
              type="date"
              value={form.validUntil}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  validUntil: event.target.value,
                }))
              }
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">
            Sohbet / talep özeti
            <Textarea
              value={form.sourceSummary}
              maxLength={5000}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  sourceSummary: event.target.value,
                }))
              }
              placeholder="Buraya gelen talebin kısa özeti; sonraki aşamada sohbet eylemi bu alanı otomatik dolduracak."
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">
            İç not
            <Textarea
              value={form.notes}
              maxLength={5000}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  notes: event.target.value,
                }))
              }
              placeholder="Yalnız yönetim için notlar"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Drive Excel bağlantısı
            <Input
              type="url"
              value={form.driveExcelUrl}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  driveExcelUrl: event.target.value,
                }))
              }
              placeholder="https://docs.google.com/spreadsheets/..."
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Drive klasörü bağlantısı
            <Input
              type="url"
              value={form.driveFolderUrl}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  driveFolderUrl: event.target.value,
                }))
              }
              placeholder="https://drive.google.com/drive/folders/..."
            />
          </label>
        </div>

        <div className="mt-6 flex flex-col gap-3 border-t border-border pt-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-black">Teklif kalemleri</h3>
              <p className="text-xs text-muted-foreground">
                Kalemleri düzenleyin, silin veya yeni kalem ekleyin. Toplam
                maliyet üzeri kâr oranı girilmezse elle satış tutarı
                kullanılır.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={template.length === 0}
                onClick={addTemplateItems}
              >
                <Wand2 className="mr-2 h-3.5 w-3.5" />
                Şablon Kalemlerini Ekle
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={addBlankItem}>
                <Plus className="mr-2 h-3.5 w-3.5" />
                Satır Ekle
              </Button>
            </div>
          </div>

          {editLoading ? (
            <LoadingState label="Kalemler yükleniyor..." />
          ) : lineItems.length === 0 ? (
            <p className="rounded-[14px] border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              Henüz kalem eklenmedi. Şablon kullanabilir veya "Satır Ekle" ile
              boş bir kalem oluşturabilirsiniz.
            </p>
          ) : (
            <Table className="min-w-[1500px] text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-32">Kategori</TableHead>
                  <TableHead className="min-w-48">Açıklama</TableHead>
                  <TableHead className="min-w-28">Marka</TableHead>
                  <TableHead className="min-w-20">Birim</TableHead>
                  <TableHead className="min-w-20">Miktar</TableHead>
                  <TableHead className="min-w-24">Alış B.F.</TableHead>
                  <TableHead className="min-w-24">İşçilik</TableHead>
                  <TableHead className="min-w-24">Taşeron</TableHead>
                  <TableHead className="min-w-24">Nakliye/Sarf</TableHead>
                  <TableHead className="min-w-24">Diğer/Risk</TableHead>
                  <TableHead className="min-w-20">Kâr %</TableHead>
                  <TableHead className="min-w-24">Elle Satış</TableHead>
                  <TableHead className="min-w-24 text-right">Satış</TableHead>
                  <TableHead className="min-w-24 text-center">
                    Müşteride Göster
                  </TableHead>
                  <TableHead className="min-w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lineItems.map((item) => {
                  const totals = previewLineTotals(item);
                  return (
                    <TableRow key={item.clientId}>
                      <TableCell>
                        <Select
                          value={item.category}
                          onValueChange={(category) =>
                            updateItem(item.clientId, {
                              category: category as LineItemCategory,
                            })
                          }
                        >
                          <SelectTrigger className="h-9 w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(lineItemCategories).map(
                              ([value, label]) => (
                                <SelectItem key={value} value={value}>
                                  {label}
                                </SelectItem>
                              ),
                            )}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-9"
                          value={item.description}
                          maxLength={500}
                          onChange={(event) =>
                            updateItem(item.clientId, {
                              description: event.target.value,
                            })
                          }
                          placeholder="Kalem açıklaması"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-9"
                          value={item.brand}
                          onChange={(event) =>
                            updateItem(item.clientId, {
                              brand: event.target.value,
                            })
                          }
                          placeholder="Opsiyonel"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-9"
                          value={item.unit}
                          onChange={(event) =>
                            updateItem(item.clientId, {
                              unit: event.target.value,
                            })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-9"
                          inputMode="decimal"
                          value={item.quantity}
                          onChange={(event) =>
                            updateItem(item.clientId, {
                              quantity: event.target.value,
                            })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-9"
                          inputMode="decimal"
                          value={item.unitCost}
                          onChange={(event) =>
                            updateItem(item.clientId, {
                              unitCost: event.target.value,
                            })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-9"
                          inputMode="decimal"
                          value={item.laborCost}
                          onChange={(event) =>
                            updateItem(item.clientId, {
                              laborCost: event.target.value,
                            })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-9"
                          inputMode="decimal"
                          value={item.subcontractorCost}
                          onChange={(event) =>
                            updateItem(item.clientId, {
                              subcontractorCost: event.target.value,
                            })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-9"
                          inputMode="decimal"
                          value={item.logisticsCost}
                          onChange={(event) =>
                            updateItem(item.clientId, {
                              logisticsCost: event.target.value,
                            })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-9"
                          inputMode="decimal"
                          value={item.riskCost}
                          onChange={(event) =>
                            updateItem(item.clientId, {
                              riskCost: event.target.value,
                            })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-9"
                          inputMode="decimal"
                          value={item.markupPercent}
                          onChange={(event) =>
                            updateItem(item.clientId, {
                              markupPercent: event.target.value,
                            })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-9"
                          inputMode="decimal"
                          value={item.manualSaleAmount}
                          onChange={(event) =>
                            updateItem(item.clientId, {
                              manualSaleAmount: event.target.value,
                            })
                          }
                          placeholder={formatDecimalInput(totals.computedSale)}
                        />
                      </TableCell>
                      <TableCell className="text-right font-bold">
                        {formatMoney(totals.appliedSale, form.currency)}
                      </TableCell>
                      <TableCell className="text-center">
                        <Checkbox
                          checked={item.visibleToCustomer}
                          onCheckedChange={(checked) =>
                            updateItem(item.clientId, {
                              visibleToCustomer: checked === true,
                            })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          onClick={() => removeItem(item.clientId)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          <div className="rounded-[14px] border border-border bg-card/60 p-3">
            <p className="text-xs text-muted-foreground">
              Hesaplanan Teklif Toplamı (kalemlerden, KDV hariç)
            </p>
            <p className="mt-1 font-black">
              {formatMoney(summary.computedNetSale, form.currency)}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium">
              Nihai teklif toplamı
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={
                    form.totalAmountMode === "computed" ? "default" : "outline"
                  }
                  className="flex-1"
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      totalAmountMode: "computed",
                    }))
                  }
                >
                  Kalemlerden hesapla
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={
                    form.totalAmountMode === "manual" ? "default" : "outline"
                  }
                  className="flex-1"
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      totalAmountMode: "manual",
                    }))
                  }
                >
                  Elle nihai teklif bedeli gir
                </Button>
              </div>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              KDV oranı (%)
              <Input
                inputMode="decimal"
                value={form.vatRatePercent}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    vatRatePercent: event.target.value,
                  }))
                }
              />
            </label>
          </div>

          {form.totalAmountMode === "manual" ? (
            <label className="grid gap-1.5 text-sm font-medium">
              Elle nihai teklif bedeli
              <Input
                inputMode="decimal"
                value={form.manualTotalAmount}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    manualTotalAmount: event.target.value,
                  }))
                }
                placeholder={formatDecimalInput(summary.computedNetSale)}
              />
            </label>
          ) : null}

          {summary.hasDifference ? (
            <div className="flex items-start gap-2 rounded-[14px] border border-amber-500/50 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                Elle girilen nihai toplam, kalemlerden hesaplanan toplamdan{" "}
                <strong>
                  {formatMoney(Math.abs(summary.difference), form.currency)}
                </strong>{" "}
                {summary.difference > 0 ? "fazla" : "az"}.
              </p>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <div className="rounded-[14px] border border-border bg-card/60 p-3">
              <p className="text-xs text-muted-foreground">Toplam Maliyet</p>
              <p className="mt-1 font-black">
                {formatMoney(summary.totalCost, form.currency)}
              </p>
            </div>
            <div className="rounded-[14px] border border-border bg-card/60 p-3">
              <p className="text-xs text-muted-foreground">
                Nihai Teklif Toplamı (KDV Hariç)
              </p>
              <p className="mt-1 font-black">
                {formatMoney(summary.finalTotal, form.currency)}
              </p>
            </div>
            <div className="rounded-[14px] border border-border bg-card/60 p-3">
              <p className="text-xs text-muted-foreground">Tahmini Kâr</p>
              <p className="mt-1 font-black">
                {formatMoney(summary.profit, form.currency)}
              </p>
            </div>
            <div className="rounded-[14px] border border-border bg-card/60 p-3">
              <p className="text-xs text-muted-foreground">Brüt Marj</p>
              <p className="mt-1 font-black">
                %{summary.marginPct.toFixed(1)}
              </p>
            </div>
            <div className="rounded-[14px] border border-border bg-card/60 p-3">
              <p className="text-xs text-muted-foreground">
                KDV Tutarı (%{formatDecimalInput(summary.vatRate * 100)})
              </p>
              <p className="mt-1 font-black">
                {formatMoney(summary.vatAmount, form.currency)}
              </p>
            </div>
            <div className="rounded-[14px] border border-border bg-card/60 p-3">
              <p className="text-xs text-muted-foreground">
                Genel Toplam (KDV Dahil)
              </p>
              <p className="mt-1 font-black">
                {formatMoney(summary.grandTotal, form.currency)}
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={() => saveOffer.mutate()}
            disabled={saveOffer.isPending || editLoading}
          >
            {saveOffer.isPending
              ? "Kaydediliyor..."
              : editingOfferId
                ? "Değişiklikleri Kaydet"
                : "Taslağı Kaydet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return (
    <>
      <PageHeader
        title="Teklifler"
        description="TKF taslaklarını, kalemlerini ve müşteri onayına gidiş sürecini buradan yönetin."
        actions={createButton}
      />
      {dialog}
      <section className="surface-panel overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-black">Teklif kayıtları</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Müşteriye gönderilmeden önce tüm teklifler taslak olarak burada
              tutulur.
            </p>
          </div>
          <Select
            value={statusFilter}
            onValueChange={(value) =>
              setStatusFilter(value as typeof statusFilter)
            }
          >
            <SelectTrigger className="w-full sm:w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tüm durumlar</SelectItem>
              {Object.entries(statuses).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {offers.length === 0 ? (
          <EmptyState
            title="Henüz teklif yok"
            description="Sohbette ürettiğiniz teklifi veya yeni bir taslağı buradan kaydedin."
            action={createButton}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>TKF No</TableHead>
                <TableHead>Müşteri / İş</TableHead>
                <TableHead>Tür</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead>Geçerlilik</TableHead>
                <TableHead className="text-right">Bedel</TableHead>
                <TableHead className="text-right">İşlem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {offers.map((offer) => (
                <TableRow key={offer.id}>
                  <TableCell className="font-mono text-xs font-bold">
                    {offer.offer_no}
                  </TableCell>
                  <TableCell>
                    <p className="font-bold">{offer.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {offer.customers?.name ?? "Müşteri belirtilmedi"}
                    </p>
                  </TableCell>
                  <TableCell>
                    {offerTypes[offer.offer_type as OfferType] ?? "Diğer"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={statusVariant(
                        offer.status as keyof typeof statuses,
                      )}
                    >
                      {statuses[offer.status as keyof typeof statuses] ??
                        offer.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {offer.valid_until
                      ? new Intl.DateTimeFormat("tr-TR").format(
                          new Date(`${offer.valid_until}T00:00:00`),
                        )
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right font-bold">
                    {formatMoney(Number(offer.total_amount), offer.currency)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {offer.drive_excel_url ? (
                        <Button asChild type="button" variant="outline" size="sm">
                          <a
                            href={offer.drive_excel_url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />
                            Excel&apos;i Aç
                          </a>
                        </Button>
                      ) : null}
                      {offer.drive_folder_url ? (
                        <Button asChild type="button" variant="outline" size="sm">
                          <a
                            href={offer.drive_folder_url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                            Drive Klasörünü Aç
                          </a>
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => startEdit(offer)}
                      >
                        <Pencil className="mr-1.5 h-3.5 w-3.5" />
                        Düzenle
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </>
  );
}

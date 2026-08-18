import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FilePlus2,
  FileSpreadsheet,
  FolderOpen,
  Pencil,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { errorMessage } from "@/lib/domain";
import { createOfferDriveWorkspace } from "@/lib/google-workspace";
import {
  AccessDenied,
  EmptyState,
  LoadingState,
  PageHeader,
} from "@/components/page-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

const offerTypeLabels = {
  hizli_teklif: "Hızlı Teklif",
  siva_alti: "Sıva Altı Teklifi",
  montaj: "Montaj Teklifi",
  tkf_proje_taahhut: "TKF Proje/Taahhüt Teklifi",
  ek_is: "Taahhüt Dışı Malzemeli İş / Ek İş",
  // Eski kayıtlarla uyumluluk için: yeni teklif oluşturma listesinde
  // seçilemez (disabledOfferTypes'ta), yalnız mevcut 'diger' kayıtları
  // görüntülenirken/düzenlenirken kullanılır.
  diger: "Diğer",
} as const;

type OfferType = keyof typeof offerTypeLabels;

const creatableOfferTypes: OfferType[] = [
  "hizli_teklif",
  "siva_alti",
  "montaj",
  "tkf_proje_taahhut",
  "ek_is",
];

// Excel şablonu henüz hazırlanmadığı için görünür ama seçilemez/kullanılamaz
// tutulan teklif türleri. Aynı liste, liste/düzenleme ekranında "Excel
// Dosyası Oluştur" butonunun gizlenmesi için de kullanılır.
const disabledOfferTypes = new Set<OfferType>(["ek_is"]);
const disabledOfferTypeSelectLabels: Partial<Record<OfferType, string>> = {
  ek_is: "Taahhüt Dışı Malzemeli İş / Ek İş (Şablon hazırlanıyor)",
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

function statusVariant(status: keyof typeof statuses) {
  if (status === "approved") return "default";
  if (status === "lost" || status === "cancelled") return "destructive";
  if (status === "sent" || status === "revision_pending") return "secondary";
  return "outline";
}

function formatQuantity(value: number) {
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded)
    ? String(rounded)
    : String(rounded).replace(".", ",");
}

function requireNumber(value: string, label: string, min: number): number {
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
  return result;
}

type OfferFormState = {
  customerId: string;
  title: string;
  offerType: OfferType;
  status: keyof typeof statuses;
  primaryItemDescription: string;
  primaryItemQuantity: string;
  primaryItemUnit: string;
};

const initialForm: OfferFormState = {
  customerId: "",
  title: "",
  offerType: "hizli_teklif",
  status: "draft",
  primaryItemDescription: "",
  primaryItemQuantity: "1",
  primaryItemUnit: "adet",
};

type OfferRow = {
  id: string;
  offer_no: string;
  title: string;
  offer_type: string;
  status: string;
  customer_id: string | null;
  primary_item_description: string | null;
  primary_item_quantity: number;
  primary_item_unit: string;
  drive_excel_url: string | null;
  drive_folder_url: string | null;
  created_at: string;
  customers: { name: string } | null;
};

function OffersPage() {
  const { role, user } = useAuth();
  const canManageOffers = role === "admin";
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editingOfferId, setEditingOfferId] = useState<string | null>(null);
  const [form, setForm] = useState(initialForm);
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
            "id, offer_no, title, offer_type, status, customer_id, primary_item_description, primary_item_quantity, primary_item_unit, drive_excel_url, drive_folder_url, created_at, customers(name)",
          )
          .order("created_at", { ascending: false }),
        supabase.from("customers").select("id, name").order("name"),
      ]);
      if (offersResult.error) throw offersResult.error;
      if (customersResult.error) throw customersResult.error;
      return {
        offers: (offersResult.data ?? []) as unknown as OfferRow[],
        customers: customersResult.data ?? [],
      };
    },
  });

  function closeDialog() {
    setOpen(false);
    setEditingOfferId(null);
    setForm(initialForm);
  }

  function startCreate() {
    setEditingOfferId(null);
    setForm(initialForm);
    setOpen(true);
  }

  function startEdit(offer: OfferRow) {
    setEditingOfferId(offer.id);
    setForm({
      customerId: offer.customer_id ?? "",
      title: offer.title,
      offerType: (offer.offer_type as OfferType) ?? "diger",
      status: (offer.status as keyof typeof statuses) ?? "draft",
      primaryItemDescription: offer.primary_item_description ?? "",
      primaryItemQuantity: String(offer.primary_item_quantity ?? 1).replace(
        ".",
        ",",
      ),
      primaryItemUnit: offer.primary_item_unit || "adet",
    });
    setOpen(true);
  }

  const provisionWorkspace = useMutation({
    mutationFn: (offerId: string) => createOfferDriveWorkspace(offerId),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["offers-page"] });
      if (result.created && result.drive_excel_url) {
        toast.success("Excel dosyası oluşturuldu.");
        window.open(result.drive_excel_url, "_blank", "noopener,noreferrer");
      }
    },
    onError: (error) => {
      toast.error(
        errorMessage(error) ||
          "Excel dosyası oluşturulamadı. Tekrar deneyebilirsiniz.",
      );
    },
  });

  const saveOffer = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Oturum bulunamadı.");
      if (form.title.trim().length < 3) {
        throw new Error("Teklif başlığı en az 3 karakter olmalıdır.");
      }
      if (form.primaryItemDescription.trim().length < 1) {
        throw new Error("Ana teklif kalemi açıklaması gerekli.");
      }
      const quantity = requireNumber(
        form.primaryItemQuantity,
        "Miktar",
        0.001,
      );
      const unit = form.primaryItemUnit.trim() || "adet";

      const headerPayload = {
        customer_id: form.customerId || null,
        title: form.title.trim(),
        offer_type: form.offerType,
        status: form.status,
        primary_item_description: form.primaryItemDescription.trim(),
        primary_item_quantity: quantity,
        primary_item_unit: unit,
      };

      if (editingOfferId) {
        const { error } = await supabase
          .from("offers")
          .update(headerPayload)
          .eq("id", editingOfferId);
        if (error) throw error;
        return editingOfferId;
      }

      const { data, error } = await supabase
        .from("offers")
        .insert({ ...headerPayload, created_by: user.id })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: async (offerId) => {
      await queryClient.invalidateQueries({ queryKey: ["offers-page"] });
      const wasEditing = Boolean(editingOfferId);
      const canProvision = !disabledOfferTypes.has(form.offerType);
      closeDialog();
      toast.success(wasEditing ? "Teklif güncellendi." : "Teklif kaydedildi.");
      if (canProvision) provisionWorkspace.mutate(offerId);
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
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {editingOfferId ? "Teklifi düzenle" : "Teklif oluştur"}
          </DialogTitle>
          <DialogDescription>
            {editingOfferId
              ? "Teklif kaydını güncelleyin. Drive'daki Excel dosyası ve klasörü buradan değişmez."
              : "TKF numarası kaydedildiğinde otomatik atanır. Kaydettikten sonra uygulama Drive'da teklif klasörünü ve Excel dosyasını otomatik oluşturur."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
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
                <SelectValue>{offerTypeLabels[form.offerType]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {creatableOfferTypes.map((value) => (
                  <SelectItem
                    key={value}
                    value={value}
                    disabled={disabledOfferTypes.has(value)}
                  >
                    {disabledOfferTypeSelectLabels[value] ??
                      offerTypeLabels[value]}
                  </SelectItem>
                ))}
                {!creatableOfferTypes.includes(form.offerType) ? (
                  <SelectItem value={form.offerType}>
                    {offerTypeLabels[form.offerType]} (eski kayıt)
                  </SelectItem>
                ) : null}
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Durum
            <Select
              value={form.status}
              onValueChange={(status) =>
                setForm((current) => ({
                  ...current,
                  status: status as keyof typeof statuses,
                }))
              }
            >
              <SelectTrigger className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(statuses).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
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
          <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">
            Müşteri (opsiyonel)
            <Select
              value={form.customerId || "none"}
              onValueChange={(value) =>
                setForm((current) => ({
                  ...current,
                  customerId: value === "none" ? "" : value,
                }))
              }
            >
              <SelectTrigger className="h-11">
                <SelectValue placeholder="Müşteri seçin" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Müşteri seçilmedi</SelectItem>
                {(pageQuery.data?.customers ?? []).map((customer) => (
                  <SelectItem key={customer.id} value={customer.id}>
                    {customer.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">
            Ana teklif kalemi / kısa kapsam açıklaması
            <Textarea
              value={form.primaryItemDescription}
              maxLength={500}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  primaryItemDescription: event.target.value,
                }))
              }
              placeholder="Örn. Kazan dairesi elektrik tesisatı sıva altı uygulaması"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Miktar
            <Input
              inputMode="decimal"
              value={form.primaryItemQuantity}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  primaryItemQuantity: event.target.value,
                }))
              }
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Birim
            <Input
              value={form.primaryItemUnit}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  primaryItemUnit: event.target.value,
                }))
              }
              placeholder="adet"
            />
          </label>
        </div>

        <DialogFooter>
          <Button
            onClick={() => saveOffer.mutate()}
            disabled={saveOffer.isPending}
          >
            {saveOffer.isPending
              ? "Kaydediliyor..."
              : editingOfferId
                ? "Değişiklikleri Kaydet"
                : "Teklifi Kaydet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return (
    <>
      <PageHeader
        title="Teklifler"
        description="TKF kayıtlarını ve Drive'daki teklif Excel dosyalarına erişimi buradan yönetin."
        actions={createButton}
      />
      {dialog}
      <section className="surface-panel overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-black">Teklif kayıtları</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Fiyatlandırma Drive'daki Excel dosyasında yapılır; burada yalnız
              kayıt ve durum takibi tutulur.
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
            description="Yeni bir teklif kaydedin; Drive'daki Excel dosyası otomatik oluşturulur."
            action={createButton}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>TKF No</TableHead>
                <TableHead>Başlık</TableHead>
                <TableHead>Tür</TableHead>
                <TableHead>Ana kalem</TableHead>
                <TableHead>Müşteri</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead className="text-right">İşlem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {offers.map((offer) => {
                const isProvisioning =
                  provisionWorkspace.isPending &&
                  provisionWorkspace.variables === offer.id;
                return (
                  <TableRow key={offer.id}>
                    <TableCell className="font-mono text-xs font-bold">
                      {offer.offer_no}
                    </TableCell>
                    <TableCell className="font-bold">{offer.title}</TableCell>
                    <TableCell>
                      {offerTypeLabels[offer.offer_type as OfferType] ??
                        "Diğer"}
                    </TableCell>
                    <TableCell>
                      {offer.primary_item_description ? (
                        <>
                          <p>{offer.primary_item_description}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatQuantity(Number(offer.primary_item_quantity))}{" "}
                            {offer.primary_item_unit}
                          </p>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {offer.customers?.name ?? "Müşteri henüz seçilmedi"}
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
                    <TableCell className="text-right">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {offer.drive_excel_url ? (
                          <Button
                            asChild
                            type="button"
                            variant="outline"
                            size="sm"
                          >
                            <a
                              href={offer.drive_excel_url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />
                              Excel&apos;i Aç
                            </a>
                          </Button>
                        ) : disabledOfferTypes.has(
                            offer.offer_type as OfferType,
                          ) ? null : (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={isProvisioning}
                            onClick={() => provisionWorkspace.mutate(offer.id)}
                          >
                            <FilePlus2 className="mr-1.5 h-3.5 w-3.5" />
                            {isProvisioning
                              ? "Oluşturuluyor..."
                              : "Excel Dosyası Oluştur"}
                          </Button>
                        )}
                        {offer.drive_folder_url ? (
                          <Button
                            asChild
                            type="button"
                            variant="outline"
                            size="sm"
                          >
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
                );
              })}
            </TableBody>
          </Table>
        )}
      </section>
    </>
  );
}

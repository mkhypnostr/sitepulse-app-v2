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

type OfferFormState = {
  customerId: string;
  title: string;
  offerType: OfferType;
};

const initialForm: OfferFormState = {
  customerId: "",
  title: "",
  offerType: "hizli_teklif",
};

type OfferRow = {
  id: string;
  offer_no: string;
  title: string;
  offer_type: string;
  status: string;
  customer_id: string | null;
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
            "id, offer_no, title, offer_type, status, customer_id, drive_excel_url, drive_folder_url, created_at, customers(name)",
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
      const headerPayload = {
        customer_id: form.customerId || null,
        title: form.title.trim(),
        offer_type: form.offerType,
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
.insert({ ...headerPayload, status: "draft", created_by: user.id })
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
      if (!wasEditing && canProvision) provisionWorkspace.mutate(offerId);
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
      <DialogContent className="max-h-[92vh] overflow-y-auto border-slate-700 bg-slate-950 text-slate-100 shadow-2xl sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-slate-50">
            {editingOfferId ? "Teklifi düzenle" : "Teklif oluştur"}
          </DialogTitle>
          <DialogDescription className="text-slate-300">
            {editingOfferId
              ? "Başlık, tür veya müşteri bilgisini güncelleyin. Drive'daki Excel dosyası değişmez."
              : "TKF numarası otomatik atanır. Kaydedildiğinde Drive'da doğru Excel şablonu oluşturulur ve açılır."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-semibold text-slate-100 sm:col-span-2">
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
              <SelectTrigger className="h-11 border-slate-600 bg-slate-900 text-slate-50 hover:border-blue-400 focus:ring-blue-400/30">
                <SelectValue>{offerTypeLabels[form.offerType]}</SelectValue>
              </SelectTrigger>
              <SelectContent className="border-slate-600 bg-slate-900 text-slate-50">
                {creatableOfferTypes.map((value) => (
                  <SelectItem
                    className="text-slate-100 focus:bg-slate-800 focus:text-white"
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
          <label className="grid gap-1.5 text-sm font-semibold text-slate-100 sm:col-span-2">
            Teklif başlığı
            <Input
              className="border-slate-600 bg-slate-900 text-slate-50 placeholder:text-slate-400 focus-visible:border-blue-400 focus-visible:ring-blue-400/30"
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
          <label className="grid gap-1.5 text-sm font-semibold text-slate-100 sm:col-span-2">
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
              <SelectTrigger className="h-11 border-slate-600 bg-slate-900 text-slate-50 hover:border-blue-400 focus:ring-blue-400/30">
                <SelectValue placeholder="Müşteri seçin" />
              </SelectTrigger>
              <SelectContent className="border-slate-600 bg-slate-900 text-slate-50">
                <SelectItem value="none">Müşteri seçilmedi</SelectItem>
                {(pageQuery.data?.customers ?? []).map((customer) => (
                  <SelectItem key={customer.id} value={customer.id}>
                    {customer.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <div className="rounded-md border border-blue-400/40 bg-blue-500/10 px-4 py-3 text-sm leading-6 text-blue-100 sm:col-span-2">
            Malzeme, miktar, fiyat ve KDV Excel dosyasında doldurulur.
          </div>
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
                : "Teklifi Oluştur ve Excel'i Aç"}
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
            <SelectContent className="border-slate-600 bg-slate-900 text-slate-50">
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

import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet, Plus } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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

const initialForm = {
  customerId: "",
  title: "",
  offerType: "diger",
  currency: "TRY",
  totalAmount: "",
  validUntil: "",
  sourceSummary: "",
  notes: "",
};

const offerTypes = {
  siva_alti: "Sıva Altı",
  montaj: "Montaj",
  diger: "Diğer",
} as const;

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

function parseMoney(value: string) {
  const normalized = value.trim().replace(/\./g, "").replace(",", ".");
  const result = Number(normalized || "0");
  if (!Number.isFinite(result) || result < 0) {
    throw new Error("Teklif bedelini geçerli bir sayı olarak girin.");
  }
  return result;
}

function OffersPage() {
  const { role, user } = useAuth();
  const canManageOffers = role === "admin";
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
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
            "id, offer_no, title, offer_type, status, currency, total_amount, valid_until, customer_id, created_at, customers(name)",
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

  const createOffer = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Oturum bulunamadı.");
      if (!form.customerId) throw new Error("Müşteri seçin.");
      if (form.title.trim().length < 3) {
        throw new Error("Teklif başlığı en az 3 karakter olmalıdır.");
      }
      const { error } = await supabase.from("offers").insert({
        customer_id: form.customerId,
        title: form.title.trim(),
        offer_type: form.offerType,
        currency: form.currency,
        total_amount: parseMoney(form.totalAmount),
        valid_until: form.validUntil || null,
        source_summary: form.sourceSummary.trim() || null,
        notes: form.notes.trim() || null,
        created_by: user.id,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["offers-page"] });
      setForm(initialForm);
      setOpen(false);
      toast.success("Teklif taslağı kaydedildi.");
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
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setForm(initialForm);
      }}
    >
      <DialogTrigger asChild>
        <Button className="h-12 font-bold">
          <Plus className="mr-2 h-4 w-4" /> Yeni Teklif
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Teklif taslağı oluştur</DialogTitle>
          <DialogDescription>
            TKF numarası kaydedildiğinde otomatik atanır. Kalem, revizyon ve
            müşteri onayı sonraki aşamalarda bu kayda bağlanır.
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
            İş paketi
            <Select
              value={form.offerType}
              onValueChange={(offerType) =>
                setForm((current) => ({ ...current, offerType }))
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
            Toplam teklif bedeli
            <Input
              inputMode="decimal"
              value={form.totalAmount}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  totalAmount: event.target.value,
                }))
              }
              placeholder="0,00"
            />
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
        </div>
        <DialogFooter>
          <Button
            onClick={() => createOffer.mutate()}
            disabled={createOffer.isPending}
          >
            {createOffer.isPending ? "Kaydediliyor..." : "Taslağı Kaydet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return (
    <>
      <PageHeader
        title="Teklifler"
        description="TKF taslaklarını, müşteri onayını ve projeye dönüşüm sürecini buradan yönetin."
        actions={createButton}
      />
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
                    {offerTypes[offer.offer_type as keyof typeof offerTypes] ??
                      "Diğer"}
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
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </>
  );
}

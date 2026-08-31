import { useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Camera,
  ExternalLink,
  FileImage,
  Images,
  MapPin,
  Paperclip,
  Pencil,
  Plus,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { errorMessage } from "@/lib/domain";
import { formatDate } from "@/lib/format";
import { safeHttpsMapUrl } from "@/lib/map-location";
import { isOperationalManager } from "@/lib/permissions";
import {
  technicalServiceEquipmentLabels,
  technicalServiceRequestLabel,
  technicalServiceStatusLabels,
  technicalServiceUrgencyLabels,
  type TechnicalServiceEquipmentType,
  type TechnicalServiceStatus,
  type TechnicalServiceUrgency,
} from "@/lib/technical-service";
import {
  AccessDenied,
  EmptyState,
  LoadingState,
  PageHeader,
} from "@/components/page-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/service-requests")({
  component: ServiceRequestsPage,
});

const SERVICE_BUCKET = "technical-service-requests";
const MAX_MEDIA_FILES = 5;
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/quicktime",
]);

type RequestMedia = {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  signedUrl: string | null;
};

type ServiceRequest = {
  id: string;
  request_no: number;
  customer_id: string;
  title: string;
  equipment_type: string;
  equipment_details: string | null;
  description: string;
  location: string;
  location_url: string | null;
  urgency: string;
  contact_name: string;
  contact_phone: string;
  status: string;
  admin_note: string | null;
  converted_work_order_id: string | null;
  created_at: string;
  updated_at: string;
  customers: { name: string } | null;
  technical_service_request_media: RequestMedia[];
};

const statusBadgeVariant: Record<
  TechnicalServiceStatus,
  "default" | "secondary" | "destructive" | "success" | "warning" | "outline"
> = {
  new: "warning",
  reviewing: "default",
  planned: "secondary",
  on_site: "default",
  resolved: "success",
  closed: "outline",
  cancelled: "destructive",
};

function safeMediaExtension(file: File) {
  const byMime: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
  };
  return byMime[file.type] ?? "bin";
}

function mediaSizeLabel(bytes: number) {
  const megabytes = bytes / (1024 * 1024);
  return megabytes >= 1
    ? megabytes.toFixed(1) + " MB"
    : Math.max(1, Math.ceil(bytes / 1024)) + " KB";
}

function ServiceRequestsPage() {
  const { role, user } = useAuth();
  const manager = isOperationalManager(role);
  const customer = role === "customer";
  const canView = manager || customer;
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingRequest, setEditingRequest] = useState<ServiceRequest | null>(
    null,
  );
  const [managerStatus, setManagerStatus] =
    useState<TechnicalServiceStatus>("reviewing");
  const [managerNote, setManagerNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    title: "",
    equipmentType: "other" as TechnicalServiceEquipmentType,
    equipmentDetails: "",
    description: "",
    location: "",
    locationUrl: "",
    urgency: "normal" as TechnicalServiceUrgency,
    contactName: "",
    contactPhone: "",
  });

  const customerQuery = useQuery({
    queryKey: ["service-request-customer", user?.id],
    enabled: customer && Boolean(user?.id),
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase
        .from("customers")
        .select("id, name")
        .eq("contact_user_id", user.id)
        .order("created_at")
        .limit(1);
      if (error) throw error;
      return data[0] ?? null;
    },
  });

  const profileQuery = useQuery({
    queryKey: ["service-request-profile", user?.id],
    enabled: customer && Boolean(user?.id),
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("full_name, phone")
        .eq("id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const requestsQuery = useQuery({
    queryKey: ["technical-service-requests", role, user?.id],
    enabled: canView && Boolean(user?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("technical_service_requests")
        .select(
          "*, customers(name), technical_service_request_media(id, file_name, mime_type, size_bytes, storage_path)",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;

      return Promise.all(
        (data ?? []).map(async (request) => {
          const media = await Promise.all(
            (request.technical_service_request_media ?? []).map(
              async (item) => {
                const signed = await supabase.storage
                  .from(SERVICE_BUCKET)
                  .createSignedUrl(item.storage_path, 900);
                return {
                  ...item,
                  signedUrl: signed.error ? null : signed.data.signedUrl,
                };
              },
            ),
          );
          return {
            ...request,
            technical_service_request_media: media,
          } as ServiceRequest;
        }),
      );
    },
  });

  function resetCreateForm() {
    setFiles([]);
    if (cameraInputRef.current) cameraInputRef.current.value = "";
    if (galleryInputRef.current) galleryInputRef.current.value = "";
    setForm({
      title: "",
      equipmentType: "other",
      equipmentDetails: "",
      description: "",
      location: "",
      locationUrl: "",
      urgency: "normal",
      contactName: profileQuery.data?.full_name?.trim() ?? "",
      contactPhone: profileQuery.data?.phone?.trim() ?? "",
    });
  }

  function openCreateDialog() {
    resetCreateForm();
    setCreateOpen(true);
  }

  function addSelectedFiles(selectedFiles: FileList | null) {
    const incoming = Array.from(selectedFiles ?? []);
    if (incoming.length === 0) return;

    const unsupported = incoming.find(
      (file) => !ALLOWED_MEDIA_TYPES.has(file.type),
    );
    if (unsupported) {
      toast.error(
        unsupported.name + " desteklenen bir fotoğraf/video türü değil.",
      );
    }

    const oversized = incoming.find((file) => file.size > MAX_MEDIA_BYTES);
    if (oversized) {
      toast.error(oversized.name + " 50 MB sınırını aşıyor.");
    }

    const validFiles = incoming.filter(
      (file) =>
        ALLOWED_MEDIA_TYPES.has(file.type) && file.size <= MAX_MEDIA_BYTES,
    );
    const nextFiles = [...files];
    let limitReached = false;

    for (const file of validFiles) {
      const duplicate = nextFiles.some(
        (current) =>
          current.name === file.name &&
          current.size === file.size &&
          current.lastModified === file.lastModified,
      );
      if (duplicate) continue;
      if (nextFiles.length >= MAX_MEDIA_FILES) {
        limitReached = true;
        break;
      }
      nextFiles.push(file);
    }

    setFiles(nextFiles);
    if (limitReached) {
      toast.warning("En fazla 5 fotoğraf veya video eklenebilir.");
    }
  }

  function removeSelectedFile(index: number) {
    setFiles((current) =>
      current.filter((_, itemIndex) => itemIndex !== index),
    );
  }

  const createRequest = useMutation({
    mutationFn: async () => {
      if (!user || !customerQuery.data) {
        throw new Error(
          "Müşteri hesabınız bir firma kartıyla eşleştirilmemiş. Yöneticinizden eşleştirme yapmasını isteyin.",
        );
      }
      if (form.title.trim().length < 3) {
        throw new Error("Talep başlığı en az 3 karakter olmalıdır.");
      }
      if (form.description.trim().length < 10) {
        throw new Error("Arıza açıklaması en az 10 karakter olmalıdır.");
      }
      if (form.location.trim().length < 3) {
        throw new Error("Tesis veya arıza konumunu yazın.");
      }
      if (form.contactName.trim().length < 2) {
        throw new Error("İletişim kurulacak kişinin adını yazın.");
      }
      if (form.contactPhone.trim().length < 8) {
        throw new Error("Geçerli bir iletişim telefonu yazın.");
      }
      const locationUrl = form.locationUrl.trim()
        ? safeHttpsMapUrl(form.locationUrl)
        : null;
      if (form.locationUrl.trim() && !locationUrl) {
        throw new Error("Google Maps bağlantısı geçersiz görünüyor.");
      }
      if (files.length > MAX_MEDIA_FILES) {
        throw new Error(
          `En fazla ${MAX_MEDIA_FILES} fotoğraf veya video eklenebilir.`,
        );
      }
      for (const file of files) {
        if (!ALLOWED_MEDIA_TYPES.has(file.type)) {
          throw new Error(
            `${file.name} desteklenen bir fotoğraf/video türü değil.`,
          );
        }
        if (file.size > MAX_MEDIA_BYTES) {
          throw new Error(`${file.name} 50 MB sınırını aşıyor.`);
        }
      }

      const { data: request, error: requestError } = await supabase
        .from("technical_service_requests")
        .insert({
          customer_id: customerQuery.data.id,
          created_by: user.id,
          title: form.title.trim(),
          equipment_type: form.equipmentType,
          equipment_details: form.equipmentDetails.trim() || null,
          description: form.description.trim(),
          location: form.location.trim(),
          location_url: locationUrl,
          urgency: form.urgency,
          contact_name: form.contactName.trim(),
          contact_phone: form.contactPhone.trim(),
        })
        .select("id")
        .single();
      if (requestError) throw requestError;

      let failedUploads = 0;
      for (const file of files) {
        const storagePath = `${user.id}/${request.id}/${crypto.randomUUID()}.${safeMediaExtension(file)}`;
        const upload = await supabase.storage
          .from(SERVICE_BUCKET)
          .upload(storagePath, file, {
            cacheControl: "3600",
            contentType: file.type,
            upsert: false,
          });
        if (upload.error) {
          failedUploads += 1;
          continue;
        }

        const mediaInsert = await supabase
          .from("technical_service_request_media")
          .insert({
            request_id: request.id,
            storage_path: storagePath,
            file_name: file.name,
            mime_type: file.type,
            size_bytes: file.size,
            uploaded_by: user.id,
          });
        if (mediaInsert.error) {
          failedUploads += 1;
          await supabase.storage.from(SERVICE_BUCKET).remove([storagePath]);
        }
      }

      return { failedUploads };
    },
    onSuccess: async ({ failedUploads }) => {
      await queryClient.invalidateQueries({
        queryKey: ["technical-service-requests"],
      });
      setCreateOpen(false);
      resetCreateForm();
      if (failedUploads > 0) {
        toast.warning(
          `Talep oluşturuldu; ${failedUploads} dosya yüklenemedi. Talep kaydı kaybolmadı.`,
        );
      } else {
        toast.success("Teknik servis talebiniz oluşturuldu.");
      }
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const updateRequest = useMutation({
    mutationFn: async () => {
      if (!editingRequest) throw new Error("Güncellenecek talep bulunamadı.");
      const { error } = await supabase
        .from("technical_service_requests")
        .update({
          status: managerStatus,
          admin_note: managerNote.trim() || null,
        })
        .eq("id", editingRequest.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["technical-service-requests"],
      });
      setEditingRequest(null);
      toast.success("Talep durumu güncellendi.");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  function openManagerEdit(request: ServiceRequest) {
    setEditingRequest(request);
    setManagerStatus(request.status as TechnicalServiceStatus);
    setManagerNote(request.admin_note ?? "");
  }

  if (!canView) return <AccessDenied />;
  if (
    requestsQuery.isLoading ||
    (customer && (customerQuery.isLoading || profileQuery.isLoading))
  ) {
    return <LoadingState label="Teknik servis talepleri yükleniyor..." />;
  }
  if (requestsQuery.error) {
    return (
      <p className="surface-panel p-5 text-destructive">
        {errorMessage(requestsQuery.error)}
      </p>
    );
  }
  if (customer && customerQuery.error) {
    return (
      <p className="surface-panel p-5 text-destructive">
        {errorMessage(customerQuery.error)}
      </p>
    );
  }

  const requests = requestsQuery.data ?? [];
  const createButton = customer ? (
    <Button
      type="button"
      className="h-11 font-bold"
      onClick={openCreateDialog}
      disabled={!customerQuery.data}
    >
      <Plus className="mr-2 h-4 w-4" /> Yeni Talep
    </Button>
  ) : null;

  return (
    <>
      <PageHeader
        title={
          customer ? "Teknik Servis Taleplerim" : "Teknik Servis Talepleri"
        }
        description={
          customer
            ? "Arıza ve servis ihtiyacınızı fotoğraf veya videoyla bildirin, süreci buradan takip edin."
            : "Müşteri bildirimlerini inceleyin, durumunu yönetin ve saha iş emrine dönüştürün."
        }
        actions={createButton}
      />

      {customer && !customerQuery.data ? (
        <div className="mb-5 flex gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
          <AlertTriangle className="h-5 w-5 shrink-0 text-warning" />
          <p>
            Hesabınız henüz bir müşteri/firma kartıyla eşleştirilmemiş. Talep
            açabilmek için yöneticinizin Müşteriler ekranından portal hesabınızı
            firmanızla eşleştirmesi gerekir.
          </p>
        </div>
      ) : null}

      {requests.length === 0 ? (
        <EmptyState
          title="Teknik servis talebi bulunmuyor"
          description={
            customer
              ? "Yeni Talep düğmesinden ilk arıza veya servis kaydınızı oluşturabilirsiniz."
              : "Müşteriler tarafından açılan talepler burada görünecek."
          }
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {requests.map((request) => {
            const status = request.status as TechnicalServiceStatus;
            const urgency = request.urgency as TechnicalServiceUrgency;
            const equipment =
              request.equipment_type as TechnicalServiceEquipmentType;
            const mapUrl = safeHttpsMapUrl(request.location_url);
            return (
              <Card key={request.id} className="overflow-hidden">
                <CardHeader className="gap-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardDescription className="font-bold text-highlight">
                        {technicalServiceRequestLabel(request.request_no)}
                        {manager && request.customers?.name
                          ? ` · ${request.customers.name}`
                          : ""}
                      </CardDescription>
                      <CardTitle className="mt-1">{request.title}</CardTitle>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={statusBadgeVariant[status]}>
                        {technicalServiceStatusLabels[status]}
                      </Badge>
                      <Badge
                        variant={
                          urgency === "critical"
                            ? "destructive"
                            : urgency === "high"
                              ? "warning"
                              : "outline"
                        }
                      >
                        {technicalServiceUrgencyLabels[urgency]}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-bold text-muted-foreground">
                        Ekipman
                      </p>
                      <p>{technicalServiceEquipmentLabels[equipment]}</p>
                      {request.equipment_details ? (
                        <p className="text-xs text-muted-foreground">
                          {request.equipment_details}
                        </p>
                      ) : null}
                    </div>
                    <div>
                      <p className="text-xs font-bold text-muted-foreground">
                        İletişim
                      </p>
                      <p>{request.contact_name}</p>
                      <a
                        className="text-highlight hover:underline"
                        href={`tel:${request.contact_phone}`}
                      >
                        {request.contact_phone}
                      </a>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-bold text-muted-foreground">
                      Arıza açıklaması
                    </p>
                    <p className="whitespace-pre-wrap leading-6">
                      {request.description}
                    </p>
                  </div>

                  <div className="rounded-lg border border-border bg-muted/30 p-3">
                    <p className="flex items-center gap-1.5 font-semibold">
                      <MapPin className="h-4 w-4 text-highlight" />
                      {request.location}
                    </p>
                    {mapUrl ? (
                      <a
                        href={mapUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-flex items-center text-xs font-bold text-highlight hover:underline"
                      >
                        Haritada aç{" "}
                        <ExternalLink className="ml-1 h-3.5 w-3.5" />
                      </a>
                    ) : null}
                  </div>

                  {request.technical_service_request_media.length > 0 ? (
                    <div>
                      <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
                        <Paperclip className="h-3.5 w-3.5" /> Ekler
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {request.technical_service_request_media.map((item) =>
                          item.signedUrl ? (
                            <a
                              key={item.id}
                              href={item.signedUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-semibold hover:bg-muted"
                            >
                              <FileImage className="h-4 w-4 shrink-0" />
                              <span className="truncate">{item.file_name}</span>
                            </a>
                          ) : (
                            <span
                              key={item.id}
                              className="text-xs text-muted-foreground"
                            >
                              {item.file_name} açılamadı
                            </span>
                          ),
                        )}
                      </div>
                    </div>
                  ) : null}

                  {request.admin_note ? (
                    <div className="rounded-lg border border-highlight/30 bg-highlight/10 p-3">
                      <p className="text-xs font-bold text-highlight">
                        NES teknik ekip notu
                      </p>
                      <p className="mt-1 whitespace-pre-wrap">
                        {request.admin_note}
                      </p>
                    </div>
                  ) : null}

                  <p className="text-xs text-muted-foreground">
                    Oluşturulma: {formatDate(request.created_at)}
                  </p>
                </CardContent>
                {manager ? (
                  <CardFooter className="flex flex-wrap gap-2 border-t border-border pt-4">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => openManagerEdit(request)}
                    >
                      <Pencil className="mr-2 h-4 w-4" /> Durumu Güncelle
                    </Button>
                    {request.converted_work_order_id ? (
                      <Button asChild variant="outline">
                        <Link
                          to="/jobs/$jobId"
                          params={{ jobId: request.converted_work_order_id }}
                        >
                          <Wrench className="mr-2 h-4 w-4" /> İş Emrini Aç
                        </Link>
                      </Button>
                    ) : (
                      <Button asChild>
                        <Link
                          to="/work-orders"
                          search={{
                            create: true,
                            serviceRequestId: request.id,
                          }}
                        >
                          <Wrench className="mr-2 h-4 w-4" /> İş Emrine Dönüştür
                        </Link>
                      </Button>
                    )}
                  </CardFooter>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Yeni Teknik Servis Talebi</DialogTitle>
            <DialogDescription>
              Arızayı mümkün olduğunca açık anlatın. Fotoğraf veya kısa video,
              teknik ekibin doğru hazırlıkla gelmesini sağlar.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">
              Talep başlığı
              <Input
                value={form.title}
                maxLength={180}
                placeholder="Örn. Ana dağıtım panosunda enerji kesintisi"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Ekipman / sistem
              <Select
                value={form.equipmentType}
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    equipmentType: value as TechnicalServiceEquipmentType,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(technicalServiceEquipmentLabels).map(
                    ([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Aciliyet
              <Select
                value={form.urgency}
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    urgency: value as TechnicalServiceUrgency,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(technicalServiceUrgencyLabels).map(
                    ([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">
              Marka, model, seri no veya ekipman bilgisi (opsiyonel)
              <Input
                value={form.equipmentDetails}
                maxLength={500}
                placeholder="Örn. ABB ACS580, seri no..."
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    equipmentDetails: event.target.value,
                  }))
                }
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">
              Arıza / servis açıklaması
              <Textarea
                value={form.description}
                maxLength={4000}
                rows={5}
                placeholder="Arıza ne zaman başladı, hangi belirtiler var, sistem şu anda çalışıyor mu?"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Tesis / arıza konumu
              <Input
                value={form.location}
                maxLength={500}
                placeholder="Tesis, bölüm veya açık adres"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    location: event.target.value,
                  }))
                }
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Google Maps bağlantısı (opsiyonel)
              <Input
                type="url"
                value={form.locationUrl}
                maxLength={2000}
                placeholder="https://maps.app.goo.gl/..."
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    locationUrl: event.target.value,
                  }))
                }
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              İletişim kurulacak kişi
              <Input
                value={form.contactName}
                maxLength={180}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    contactName: event.target.value,
                  }))
                }
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Telefon
              <Input
                type="tel"
                value={form.contactPhone}
                maxLength={32}
                placeholder="+90 5xx xxx xx xx"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    contactPhone: event.target.value,
                  }))
                }
              />
            </label>
            <div className="grid gap-2 sm:col-span-2">
              <span className="text-sm font-medium">
                Fotoğraf veya video (en fazla 5 dosya, dosya başına 50 MB)
              </span>
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                className="hidden"
                onChange={(event) => addSelectedFiles(event.target.files)}
              />
              <input
                ref={galleryInputRef}
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                className="hidden"
                onChange={(event) => addSelectedFiles(event.target.files)}
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    if (!cameraInputRef.current) return;
                    cameraInputRef.current.value = "";
                    cameraInputRef.current.click();
                  }}
                  disabled={createRequest.isPending}
                >
                  <Camera className="mr-2 h-4 w-4" /> Kameradan Çek
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    if (!galleryInputRef.current) return;
                    galleryInputRef.current.value = "";
                    galleryInputRef.current.click();
                  }}
                  disabled={createRequest.isPending}
                >
                  <Images className="mr-2 h-4 w-4" /> Galeriden Seç
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Kameradan fotoğraf çekebilir veya galeriden birden fazla
                fotoğraf/video seçebilirsiniz.
              </p>
              {files.length > 0 ? (
                <div className="grid gap-2">
                  {files.map((file, index) => (
                    <div
                      key={`${file.name}-${file.size}-${file.lastModified}`}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {file.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {mediaSizeLabel(file.size)}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeSelectedFile(index)}
                        disabled={createRequest.isPending}
                        aria-label={file.name + " seçimini kaldır"}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  <span className="text-xs font-semibold text-highlight">
                    {files.length} / {MAX_MEDIA_FILES} dosya seçildi
                  </span>
                </div>
              ) : null}
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              onClick={() => createRequest.mutate()}
              disabled={createRequest.isPending}
            >
              {createRequest.isPending ? "Gönderiliyor..." : "Talebi Gönder"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(editingRequest)}
        onOpenChange={(open) => !open && setEditingRequest(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Teknik Servis Talebini Güncelle</DialogTitle>
            <DialogDescription>
              Müşteri bu durum ve teknik ekip notunu kendi panelinde görecek.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <label className="grid gap-1.5 text-sm font-medium">
              Durum
              <Select
                value={managerStatus}
                onValueChange={(value) =>
                  setManagerStatus(value as TechnicalServiceStatus)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(technicalServiceStatusLabels).map(
                    ([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Müşteriye gösterilecek teknik ekip notu
              <Textarea
                value={managerNote}
                maxLength={2000}
                rows={5}
                placeholder="İnceleme sonucu, planlama veya çözüm bilgisi..."
                onChange={(event) => setManagerNote(event.target.value)}
              />
            </label>
          </div>
          <DialogFooter>
            <Button
              type="button"
              onClick={() => updateRequest.mutate()}
              disabled={updateRequest.isPending}
            >
              {updateRequest.isPending ? "Kaydediliyor..." : "Güncelle"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

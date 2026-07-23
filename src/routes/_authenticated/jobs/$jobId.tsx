import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  FileDown,
  Images,
  MapPin,
  PackageMinus,
  Plus,
  UploadCloud,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { errorMessage, photoTypeLabels, statusLabels, type PhotoType } from "@/lib/domain";
import { formatDate, formatTRY } from "@/lib/format";
import { formatProjectDateTime } from "@/lib/projects";
import { compressImage } from "@/lib/image-compress";
import { EmptyState, LoadingState, PageHeader } from "@/components/page-states";
import { MapPreview } from "@/components/map-preview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/jobs/$jobId")({
  component: JobDetailPage,
});

function JobDetailPage() {
  const { jobId } = Route.useParams();
  const { role, user } = useAuth();
  const queryClient = useQueryClient();
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const progressCameraInput = useRef<HTMLInputElement>(null);
  const progressGalleryInput = useRef<HTMLInputElement>(null);
  const [progressPct, setProgressPct] = useState("0");
  const [progressNote, setProgressNote] = useState("");
  const [progressEvidence, setProgressEvidence] = useState<File | null>(null);
  const [progressReviewNote, setProgressReviewNote] = useState("");
  const [completionNote, setCompletionNote] = useState("");
  const [completionPhotoIds, setCompletionPhotoIds] = useState<string[]>([]);
  const [reviewNote, setReviewNote] = useState("");
  const [photoType, setPhotoType] = useState<PhotoType>("saha");
  const [photoCaption, setPhotoCaption] = useState("");
  const [uploading, setUploading] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<{
    url: string;
    label: string;
  } | null>(null);
  const [stockItemId, setStockItemId] = useState("");
  const [stockQuantity, setStockQuantity] = useState("");
  const [stockNote, setStockNote] = useState("");
  const [customName, setCustomName] = useState("");
  const [customQuantity, setCustomQuantity] = useState("");
  const [customUnit, setCustomUnit] = useState("adet");
  const [customSource, setCustomSource] = useState("contractor");
  const [commercialForm, setCommercialForm] = useState({
    customerAmount: "0",
    contractorLaborAmount: "0",
    estimatedMaterialCost: "0",
    workScopeType: "labor_only",
    materialSource: "none",
  });

  const detailQuery = useQuery({
    queryKey: ["job-detail", jobId, role],
    enabled: Boolean(role),
    queryFn: async () => {
      const [orderResult, photosResult, progressResult, completionResult] = await Promise.all([
        supabase
          .from("work_orders")
          .select(
            "*, customers(name, contact), work_order_financials(total_amount, customer_amount, contractor_labor_amount, estimated_material_cost, approved_progress_pct)",
          )
          .eq("id", jobId)
          .single(),
        supabase
          .from("photos")
          .select("*")
          .eq("work_order_id", jobId)
          .order("created_at", { ascending: false }),
        supabase
          .from("progress_updates")
          .select("*")
          .eq("work_order_id", jobId)
          .order("created_at", { ascending: false }),
        supabase
          .from("work_completion_submissions")
          .select("*")
          .eq("work_order_id", jobId)
          .order("submitted_at", { ascending: false }),
      ]);
      if (orderResult.error) throw orderResult.error;
      if (photosResult.error) throw photosResult.error;
      if (progressResult.error && role !== "customer") throw progressResult.error;
      if (completionResult.error && role !== "customer") throw completionResult.error;

      const photos = await Promise.all(
        photosResult.data.map(async (photo) => {
          const { data, error } = await supabase.storage
            .from("work-photos")
            .createSignedUrl(photo.storage_path, 3600);
          return { ...photo, signedUrl: error ? null : data.signedUrl };
        }),
      );

      let materials: Array<{
        id: string;
        custom_material_name: string | null;
        quantity: number;
        unit: string;
        is_nes_stock: boolean;
        material_source: string;
        created_at: string;
        stock_items: { name: string; code: string | null } | null;
      }> = [];
      let stockItems: Array<{
        id: string;
        code: string | null;
        name: string;
        quantity: number;
        unit: "adet" | "metre";
      }> = [];

      if (role !== "customer") {
        const [materialsResult, stockResult] = await Promise.all([
          supabase
            .from("work_order_materials")
            .select(
              "id, custom_material_name, quantity, unit, is_nes_stock, material_source, created_at, stock_items(name, code)",
            )
            .eq("work_order_id", jobId)
            .order("created_at", { ascending: false }),
          supabase
            .from("stock_items")
            .select("id, code, name, quantity, unit")
            .gt("quantity", 0)
            .order("name"),
        ]);
        if (materialsResult.error) throw materialsResult.error;
        if (stockResult.error) throw stockResult.error;
        materials = materialsResult.data;
        stockItems = stockResult.data;
      }

      const progressUserIds = [
        ...new Set(
          (progressResult.data ?? []).flatMap(
            (item) => [item.contractor_id, item.reviewed_by].filter(Boolean) as string[],
          ),
        ),
      ];
      const progressProfilesResult = progressUserIds.length
        ? await supabase.from("profiles").select("id, full_name").in("id", progressUserIds)
        : { data: [], error: null };
      if (progressProfilesResult.error) throw progressProfilesResult.error;

      const completionSubmissions = completionResult.data ?? [];
      const completionUserIds = [
        ...new Set(
          completionSubmissions.flatMap(
            (item) => [item.submitted_by, item.reviewed_by].filter(Boolean) as string[],
          ),
        ),
      ];
      const completionProfilesResult = completionUserIds.length
        ? await supabase.from("profiles").select("id, full_name").in("id", completionUserIds)
        : { data: [], error: null };
      if (completionProfilesResult.error) throw completionProfilesResult.error;

      const completionIds = completionSubmissions.map((item) => item.id);
      const completionEvidenceResult = completionIds.length
        ? await supabase
            .from("work_completion_evidence")
            .select("submission_id, photo_id")
            .in("submission_id", completionIds)
        : { data: [], error: null };
      if (completionEvidenceResult.error) throw completionEvidenceResult.error;

      return {
        order: orderResult.data,
        photos,
        progress: progressResult.data ?? [],
        progressProfiles: progressProfilesResult.data ?? [],
        completionSubmissions,
        completionProfiles: completionProfilesResult.data ?? [],
        completionEvidence: completionEvidenceResult.data ?? [],
        materials,
        stockItems,
      };
    },
  });

  useEffect(() => {
    const order = detailQuery.data?.order;
    const financials = order?.work_order_financials;
    if (!order || !financials || role !== "admin") return;
    setCommercialForm({
      customerAmount: String(financials.customer_amount ?? 0),
      contractorLaborAmount: String(financials.contractor_labor_amount ?? 0),
      estimatedMaterialCost: String(financials.estimated_material_cost ?? 0),
      workScopeType: order.work_scope_type,
      materialSource: order.default_material_source,
    });
  }, [detailQuery.data?.order, role]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["job-detail", jobId] });
    await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    await queryClient.invalidateQueries({ queryKey: ["my-jobs"] });
    await queryClient.invalidateQueries({ queryKey: ["my-projects"] });
    await queryClient.invalidateQueries({ queryKey: ["admin-work-orders"] });
  };

  const progressMutation = useMutation({
    mutationFn: async () => {
      const pct = Number(progressPct);
      const approvedPct = detailQuery.data?.order.progress_pct ?? 0;
      const normalizedNote = progressNote.trim();
      if (role !== "contractor") {
        throw new Error("İlerleme bildirimini yalnızca atanmış taşeron gönderebilir");
      }
      if (!Number.isInteger(pct) || pct <= approvedPct || pct > 100 || pct % 5 !== 0) {
        throw new Error(
          `İlerleme mevcut onaylı %${approvedPct} değerinden yüksek ve 5'in katı olmalıdır`,
        );
      }
      if (normalizedNote.length < 10) {
        throw new Error("Yapılan iş açıklaması en az 10 karakter olmalıdır");
      }
      if (!progressEvidence) throw new Error("Yeni bir kanıt fotoğrafı ekleyin");
      if (!user) throw new Error("Oturum bulunamadı");

      const compressed = await compressImage(progressEvidence);
      const storagePath = `${user.id}/${jobId}/${crypto.randomUUID()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from("work-photos")
        .upload(storagePath, compressed, { contentType: "image/jpeg", upsert: false });
      if (uploadError) throw uploadError;

      const { error } = await supabase.rpc("submit_progress_update", {
        target_work_order_id: jobId,
        new_pct: pct,
        progress_note: normalizedNote,
        evidence_storage_path: storagePath,
        evidence_photo_type: "saha",
      });
      if (error) {
        await supabase.storage.from("work-photos").remove([storagePath]);
        throw error;
      }
    },
    onSuccess: async () => {
      await refresh();
      setProgressNote("");
      setProgressEvidence(null);
      if (progressCameraInput.current) progressCameraInput.current.value = "";
      if (progressGalleryInput.current) progressGalleryInput.current.value = "";
      toast.success(
        `%${progressPct} ilerleme talebiniz yönetici onayına gönderildi. Onaylandıktan sonra iş ilerlemesine eklenecektir.`,
      );
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const reviewProgressMutation = useMutation({
    mutationFn: async (approve: boolean) => {
      const pending = detailQuery.data?.progress.find((item) => item.status === "pending");
      if (!pending) throw new Error("Onay bekleyen ilerleme bulunamadı");
      if (!approve && !progressReviewNote.trim()) throw new Error("Reddetme açıklaması zorunludur");
      const { error } = await supabase.rpc("review_progress_update", {
        target_progress_update_id: pending.id,
        approve_update: approve,
        manager_review_note: progressReviewNote.trim() || undefined,
      });
      if (error) throw error;
    },
    onSuccess: async (_data, approved) => {
      await refresh();
      setProgressReviewNote("");
      toast.success(
        approved ? "İlerleme onaylandı ve işe yansıtıldı" : "İlerleme talebi reddedildi",
      );
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const submitForReviewMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("submit_work_for_review", {
        target_work_order_id: jobId,
        submitted_completion_note: completionNote,
        completion_photo_ids: completionPhotoIds,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await refresh();
      setCompletionNote("");
      setCompletionPhotoIds([]);
      toast.success("İş yönetici kontrolüne gönderildi");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const reviewCompletionMutation = useMutation({
    mutationFn: async (approve: boolean) => {
      const { error } = await supabase.rpc("review_work_completion", {
        target_work_order_id: jobId,
        approve_completion: approve,
        manager_review_note: reviewNote,
      });
      if (error) throw error;
    },
    onSuccess: async (_data, approved) => {
      await refresh();
      setReviewNote("");
      toast.success(approved ? "İş tamamlandı olarak onaylandı" : "İş revizyona gönderildi");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const stockMutation = useMutation({
    mutationFn: async () => {
      const quantity = Number(stockQuantity.replace(",", "."));
      if (!stockItemId || !Number.isFinite(quantity) || quantity <= 0) {
        throw new Error("Malzeme ve miktar seçin");
      }
      const { error } = await supabase.rpc("consume_stock_item", {
        target_stock_item_id: stockItemId,
        target_work_order_id: jobId,
        consumed_quantity: quantity,
        movement_note: stockNote,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await refresh();
      await queryClient.invalidateQueries({ queryKey: ["stock-items"] });
      setStockQuantity("");
      setStockNote("");
      toast.success("Malzeme NES stoğundan düşüldü");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const commercialMutation = useMutation({
    mutationFn: async () => {
      const customerAmount = Number(commercialForm.customerAmount.replace(",", "."));
      const contractorLaborAmount = Number(commercialForm.contractorLaborAmount.replace(",", "."));
      const estimatedMaterialCost = Number(commercialForm.estimatedMaterialCost.replace(",", "."));
      if (
        ![customerAmount, contractorLaborAmount, estimatedMaterialCost].every(
          (value) => Number.isFinite(value) && value >= 0,
        )
      ) {
        throw new Error("Ticari tutarları kontrol edin");
      }
      const { error } = await supabase.rpc("update_work_order_commercials", {
        target_work_order_id: jobId,
        new_customer_amount: customerAmount,
        new_contractor_labor_amount: contractorLaborAmount,
        new_estimated_material_cost: estimatedMaterialCost,
        new_work_scope_type: commercialForm.workScopeType,
        new_default_material_source:
          commercialForm.workScopeType === "labor_only" ? "none" : commercialForm.materialSource,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await refresh();
      toast.success("Ticari bilgiler ve iş kapsamı güncellendi");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const customMaterialMutation = useMutation({
    mutationFn: async () => {
      const quantity = Number(customQuantity.replace(",", "."));
      if (!customName.trim() || !Number.isFinite(quantity) || quantity <= 0) {
        throw new Error("Malzeme adı ve miktar zorunludur");
      }
      if (!user) throw new Error("Oturum bulunamadı");
      const { error } = await supabase.from("work_order_materials").insert({
        work_order_id: jobId,
        custom_material_name: customName.trim(),
        quantity,
        unit: customUnit,
        is_nes_stock: false,
        material_source: customSource,
        added_by: user.id,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await refresh();
      setCustomName("");
      setCustomQuantity("");
      toast.success("Taşerona ait malzeme kaydedildi");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const photoVisibilityMutation = useMutation({
    mutationFn: async ({ photoId, visible }: { photoId: string; visible: boolean }) => {
      const { error } = await supabase
        .from("photos")
        .update({ show_to_customer: visible })
        .eq("id", photoId);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (error) => toast.error(errorMessage(error)),
  });

  async function uploadPhotos(files: FileList | null) {
    if (!files?.length || !user) return;
    setUploading(true);
    let uploaded = 0;
    try {
      for (const file of Array.from(files)) {
        const compressed = await compressImage(file);
        const storagePath = `${user.id}/${jobId}/${crypto.randomUUID()}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from("work-photos")
          .upload(storagePath, compressed, { contentType: "image/jpeg", upsert: false });
        if (uploadError) throw uploadError;

        const { error: recordError } = await supabase.from("photos").insert({
          work_order_id: jobId,
          uploaded_by: user.id,
          storage_path: storagePath,
          caption: photoCaption.trim() || null,
          photo_type: photoType,
          show_to_customer: false,
        });
        if (recordError) {
          await supabase.storage.from("work-photos").remove([storagePath]);
          throw recordError;
        }
        uploaded += 1;
      }
      await refresh();
      setPhotoCaption("");
      toast.success(`${uploaded} fotoğraf yüklendi`);
    } catch (error) {
      toast.error(`${uploaded} fotoğraf yüklendi; işlem durdu: ${errorMessage(error)}`);
    } finally {
      setUploading(false);
      if (cameraInput.current) cameraInput.current.value = "";
      if (galleryInput.current) galleryInput.current.value = "";
    }
  }

  if (detailQuery.isLoading) return <LoadingState />;
  if (detailQuery.error || !detailQuery.data) {
    return (
      <EmptyState
        title="İş emri açılamadı"
        description="Kayıt bulunmuyor veya bu iş emrini görme yetkiniz yok."
        action={
          <Button asChild variant="outline">
            <Link to="/dashboard">Panele dön</Link>
          </Button>
        }
      />
    );
  }

  const {
    order,
    photos,
    progress,
    progressProfiles,
    completionSubmissions,
    completionProfiles,
    completionEvidence,
    materials,
    stockItems,
  } = detailQuery.data;
  const canOperate = role === "admin" || role === "contractor";
  const isReviewPending = order.status === "review_pending";
  const isFinalized = order.status === "completed" || order.status === "cancelled";
  const pendingProgress = progress.find((item) => item.status === "pending");
  const pendingEvidence = pendingProgress
    ? photos.find((photo) => photo.id === pendingProgress.evidence_photo_id)
    : undefined;
  const progressProfileById = new Map(
    progressProfiles.map((profile) => [profile.id, profile.full_name]),
  );
  const completionProfileById = new Map(
    completionProfiles.map((profile) => [profile.id, profile.full_name]),
  );
  const pendingCompletion = completionSubmissions.find((item) => item.status === "pending");
  const pendingCompletionPhotoIds = new Set(
    completionEvidence
      .filter((item) => item.submission_id === pendingCompletion?.id)
      .map((item) => item.photo_id),
  );
  const pendingCompletionPhotos = photos.filter((photo) => pendingCompletionPhotoIds.has(photo.id));
  const completionCandidatePhotos = photos.filter(
    (photo) => photo.uploaded_by === user?.id && Boolean(photo.signedUrl),
  );
  const canSubmitForReview =
    role === "contractor" &&
    order.progress_pct === 100 &&
    !pendingProgress &&
    !isReviewPending &&
    !isFinalized;
  const financials = order.work_order_financials;
  const materialSourceLabels: Record<string, string> = {
    none: "Malzeme kullanılmıyor",
    nes_stock: "NES deposu",
    contractor: "Taşeron malzemesi",
    customer_site: "Müşteri / şantiye malzemesi",
  };
  const payableAmount =
    (financials?.contractor_labor_amount ?? 0) * ((financials?.approved_progress_pct ?? 0) / 100);
  const estimatedGrossMargin =
    (financials?.customer_amount ?? 0) -
    (financials?.contractor_labor_amount ?? 0) -
    (financials?.estimated_material_cost ?? 0);

  return (
    <>
      <Button asChild variant="ghost" className="mb-3 px-0 text-muted-foreground">
        <Link to="/dashboard">
          <ArrowLeft className="mr-2 h-4 w-4" /> Panele dön
        </Link>
      </Button>
      <PageHeader
        title={`#${order.work_order_no} · ${order.title}`}
        description={`${order.customers?.name} · ${formatDate(order.scheduled_at)}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="px-3 py-2">
              {statusLabels[order.status]}
            </Badge>
            {order.status === "completed" ? (
              <Button asChild variant="outline">
                <Link to="/job-report/$jobId" params={{ jobId }}>
                  <FileDown className="mr-2 h-4 w-4" /> Fotoğraflı Rapor
                </Link>
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>İş Bilgileri</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {order.description || "Açıklama girilmemiş."}
            </p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">
                {order.work_scope_type === "labor_only" ? "Yalnızca işçilik" : "İşçilik + malzeme"}
              </Badge>
              <Badge variant="outline">
                {materialSourceLabels[order.default_material_source] ||
                  order.default_material_source}
              </Badge>
            </div>
            {order.location_url ? (
              <MapPreview mapUrl={order.location_url} />
            ) : order.location ? (
              <p className="flex items-center gap-2 text-sm">
                <MapPin className="h-4 w-4 text-primary" /> {order.location}
              </p>
            ) : null}
            <div>
              <div className="mb-2 flex justify-between">
                <span className="font-semibold">Genel İlerleme</span>
                <strong className="text-primary">%{order.progress_pct}</strong>
              </div>
              <Progress value={order.progress_pct} className="h-4" />
            </div>
          </CardContent>
        </Card>
        {role === "admin" ? (
          <Card>
            <CardHeader>
              <CardTitle>Hakediş</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-xs text-muted-foreground">Müşteriye Satış Bedeli</p>
                <p className="text-xl font-black">{formatTRY(financials?.customer_amount)}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Taşeron İşçilik</p>
                  <p className="font-black">{formatTRY(financials?.contractor_labor_amount)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Tahmini Malzeme/Diğer</p>
                  <p className="font-black">{formatTRY(financials?.estimated_material_cost)}</p>
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Onaylı İlerleme</p>
                <p className="text-xl font-black">%{financials?.approved_progress_pct ?? 0}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Onaylı Hakediş</p>
                <p className="text-xl font-black text-primary">{formatTRY(payableAmount)}</p>
              </div>
              <div className="rounded-md border bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">Tahmini Brüt Fark</p>
                <p
                  className={`text-xl font-black ${estimatedGrossMargin < 0 ? "text-red-400" : "text-emerald-400"}`}
                >
                  {formatTRY(estimatedGrossMargin)}
                </p>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>

      {role === "admin" ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Yönetici Ticari Bilgileri</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Bu tutarlar yalnızca yöneticilere görünür. Müşteri ve taşeron ekranlarında
              paylaşılmaz.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1 text-sm">
                Müşteri Satış Bedeli (₺)
                <Input
                  inputMode="decimal"
                  value={commercialForm.customerAmount}
                  onChange={(event) =>
                    setCommercialForm({ ...commercialForm, customerAmount: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-sm">
                Taşeron İşçilik Bedeli (₺)
                <Input
                  inputMode="decimal"
                  value={commercialForm.contractorLaborAmount}
                  onChange={(event) =>
                    setCommercialForm({
                      ...commercialForm,
                      contractorLaborAmount: event.target.value,
                    })
                  }
                />
              </label>
              <label className="grid gap-1 text-sm">
                Tahmini Malzeme/Diğer (₺)
                <Input
                  inputMode="decimal"
                  value={commercialForm.estimatedMaterialCost}
                  onChange={(event) =>
                    setCommercialForm({
                      ...commercialForm,
                      estimatedMaterialCost: event.target.value,
                    })
                  }
                />
              </label>
              <label className="grid gap-1 text-sm">
                İş Kapsamı
                <Select
                  value={commercialForm.workScopeType}
                  onValueChange={(workScopeType) =>
                    setCommercialForm({
                      ...commercialForm,
                      workScopeType,
                      materialSource:
                        workScopeType === "labor_only"
                          ? "none"
                          : commercialForm.materialSource === "none"
                            ? "nes_stock"
                            : commercialForm.materialSource,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="labor_only">Yalnızca işçilik</SelectItem>
                    <SelectItem value="labor_and_material">İşçilik + malzeme</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="grid gap-1 text-sm">
                Varsayılan Malzeme Kaynağı
                <Select
                  value={commercialForm.materialSource}
                  disabled={commercialForm.workScopeType === "labor_only"}
                  onValueChange={(materialSource) =>
                    setCommercialForm({ ...commercialForm, materialSource })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Malzeme kullanılmayacak</SelectItem>
                    <SelectItem value="nes_stock">NES deposu</SelectItem>
                    <SelectItem value="contractor">Taşeron malzemesi</SelectItem>
                    <SelectItem value="customer_site">Müşteri / şantiye malzemesi</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <div className="flex items-end">
                <Button
                  className="w-full"
                  onClick={() => commercialMutation.mutate()}
                  disabled={
                    commercialMutation.isPending ||
                    (commercialForm.workScopeType === "labor_and_material" &&
                      commercialForm.materialSource === "none")
                  }
                >
                  {commercialMutation.isPending ? "Kaydediliyor..." : "Ticari Bilgileri Kaydet"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {canOperate ? (
        <div className="mt-6 grid gap-4 xl:grid-cols-2">
          {role === "contractor" ? (
            <Card>
              <CardHeader>
                <CardTitle>İlerleme Bildir</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {pendingProgress ? (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                    <p className="font-black text-amber-300">
                      %{pendingProgress.pct} YÖNETİCİ ONAYI BEKLİYOR
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      İlerleme onaylandıktan sonra mevcut %{order.progress_pct} değerine
                      yansıtılacaktır.
                    </p>
                  </div>
                ) : null}
                <label className="grid gap-1 text-sm">
                  İlerleme Yüzdesi
                  <Input
                    type="number"
                    min={Math.min(100, order.progress_pct + 5)}
                    max="100"
                    step="5"
                    value={progressPct}
                    onChange={(event) => setProgressPct(event.target.value)}
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  Yapılan İş / Açıklama
                  <Textarea
                    value={progressNote}
                    onChange={(event) => setProgressNote(event.target.value)}
                    placeholder="Yapılan işi en az 10 karakterle açıklayın"
                    minLength={10}
                  />
                </label>
                <input
                  ref={progressCameraInput}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(event) => setProgressEvidence(event.target.files?.[0] ?? null)}
                />
                <input
                  ref={progressGalleryInput}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => setProgressEvidence(event.target.files?.[0] ?? null)}
                />
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => progressCameraInput.current?.click()}
                  >
                    <Camera className="mr-2 h-4 w-4" /> Kanıt Fotoğrafı Çek
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => progressGalleryInput.current?.click()}
                  >
                    <Images className="mr-2 h-4 w-4" /> Galeriden Kanıt Seç
                  </Button>
                </div>
                {progressEvidence ? (
                  <p className="text-xs font-semibold text-primary">{progressEvidence.name}</p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  İlerleme talebi için yeni fotoğraf ve en az 10 karakter açıklama zorunludur.
                  Yönetici onaylamadan yüzde değişmez.
                </p>
                <Button
                  className="w-full h-12"
                  onClick={() => progressMutation.mutate()}
                  disabled={
                    progressMutation.isPending ||
                    Boolean(pendingProgress) ||
                    isReviewPending ||
                    isFinalized
                  }
                >
                  {progressMutation.isPending ? "Gönderiliyor..." : "Yönetici Onayına Gönder"}
                </Button>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Fotoğraf Ekle</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-sm">
                  Fotoğraf Türü
                  <Select
                    value={photoType}
                    onValueChange={(value: PhotoType) => setPhotoType(value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(photoTypeLabels) as PhotoType[]).map((type) => (
                        <SelectItem key={type} value={type}>
                          {photoTypeLabels[type]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="grid gap-1 text-sm">
                  Açıklama
                  <Input
                    value={photoCaption}
                    onChange={(event) => setPhotoCaption(event.target.value)}
                    placeholder="Fotoğrafta ne görülüyor?"
                  />
                </label>
              </div>
              <input
                ref={cameraInput}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(event) => uploadPhotos(event.target.files)}
              />
              <input
                ref={galleryInput}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => uploadPhotos(event.target.files)}
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <Button
                  variant="outline"
                  className="h-14"
                  onClick={() => cameraInput.current?.click()}
                  disabled={uploading}
                >
                  <Camera className="mr-2 h-5 w-5" /> Kameradan Çek
                </Button>
                <Button
                  variant="outline"
                  className="h-14"
                  onClick={() => galleryInput.current?.click()}
                  disabled={uploading}
                >
                  <Images className="mr-2 h-5 w-5" /> Galeriden Seç
                </Button>
              </div>
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <UploadCloud className="h-4 w-4" /> Fotoğraflar yüklemeden önce yaklaşık 300 KB
                altına sıkıştırılır.
              </p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {role === "admin" && pendingProgress ? (
        <Card id="progress-approval" className="mt-6 scroll-mt-6 border-red-500/40 bg-red-500/5">
          <CardHeader>
            <CardTitle className="text-red-200">
              İlerleme Onayı Bekliyor · %{pendingProgress.pct}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-[minmax(0,320px)_1fr]">
              {pendingEvidence?.signedUrl ? (
                <button
                  type="button"
                  onClick={() =>
                    setSelectedPhoto({
                      url: pendingEvidence.signedUrl!,
                      label: "İlerleme kanıtı",
                    })
                  }
                  className="overflow-hidden rounded-lg border"
                >
                  <img
                    src={pendingEvidence.signedUrl}
                    alt="İlerleme kanıtı"
                    className="aspect-video w-full object-cover"
                  />
                </button>
              ) : (
                <div className="flex aspect-video items-center justify-center rounded-lg border bg-muted text-sm text-muted-foreground">
                  Kanıt fotoğrafı açılamadı
                </div>
              )}
              <div>
                <p className="font-semibold">Taşeron açıklaması</p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                  {pendingProgress.note}
                </p>
                <p className="mt-3 text-xs text-muted-foreground">
                  {progressProfileById.get(pendingProgress.contractor_id) || "Taşeron"} ·{" "}
                  {formatProjectDateTime(pendingProgress.created_at)}
                </p>
              </div>
            </div>
            <Textarea
              value={progressReviewNote}
              onChange={(event) => setProgressReviewNote(event.target.value)}
              placeholder="Onay notu veya reddetme gerekçesi"
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                variant="outline"
                onClick={() => reviewProgressMutation.mutate(false)}
                disabled={reviewProgressMutation.isPending}
              >
                Reddet
              </Button>
              <Button
                onClick={() => reviewProgressMutation.mutate(true)}
                disabled={reviewProgressMutation.isPending}
              >
                <CheckCircle2 className="mr-2 h-4 w-4" /> %{pendingProgress.pct} İlerlemeyi Onayla
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Reddetme işleminde açıklama zorunludur.</p>
          </CardContent>
        </Card>
      ) : null}

      {canSubmitForReview ? (
        <Card className="mt-6 border-primary/30">
          <CardHeader>
            <CardTitle>İşi Yönetici Kontrolüne Gönder</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Göndermek için onaylı ilerleme %100 olmalı; aşağıdan kategori verilmiş en az 1, en
              fazla 5 fotoğraf seçilmeli ve en az 10 karakter açıklama yazılmalıdır.
            </p>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {completionCandidatePhotos.map((photo) => {
                const selected = completionPhotoIds.includes(photo.id);
                return (
                  <button
                    type="button"
                    key={photo.id}
                    onClick={() =>
                      setCompletionPhotoIds((current) =>
                        selected
                          ? current.filter((id) => id !== photo.id)
                          : current.length < 5
                            ? [...current, photo.id]
                            : current,
                      )
                    }
                    className={`overflow-hidden rounded-lg border text-left transition-colors ${
                      selected ? "border-primary ring-2 ring-primary/30" : "border-border"
                    }`}
                  >
                    <img
                      src={photo.signedUrl ?? ""}
                      alt={photo.caption || photoTypeLabels[photo.photo_type]}
                      className="aspect-video w-full object-cover"
                    />
                    <span className="block p-2 text-xs font-bold">
                      {selected ? "✓ " : ""}
                      {photoTypeLabels[photo.photo_type]}
                    </span>
                  </button>
                );
              })}
            </div>
            {completionCandidatePhotos.length === 0 ? (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200">
                Önce “Fotoğraf Ekle” alanından en az bir fotoğraf yükleyin.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {completionPhotoIds.length}/5 fotoğraf seçildi.
              </p>
            )}
            <Textarea
              value={completionNote}
              onChange={(event) => setCompletionNote(event.target.value)}
              placeholder="İşin nasıl tamamlandığını, varsa önemli notları yazın"
              minLength={10}
            />
            <Button
              className="w-full"
              onClick={() => submitForReviewMutation.mutate()}
              disabled={
                submitForReviewMutation.isPending ||
                completionPhotoIds.length < 1 ||
                completionPhotoIds.length > 5 ||
                completionNote.trim().length < 10
              }
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              {submitForReviewMutation.isPending ? "Gönderiliyor..." : "Kontrole Gönder"}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {role === "admin" && isReviewPending ? (
        <Card id="completion-approval" className="mt-6 scroll-mt-6 border-red-500/40 bg-red-500/5">
          <CardHeader>
            <CardTitle className="text-red-200">İş Bitirme Onayı Bekliyor</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-md bg-muted/60 p-3 text-sm">
              <p className="font-semibold">
                Gönderen:{" "}
                {completionProfileById.get(pendingCompletion?.submitted_by ?? "") || "Taşeron"}
              </p>
              <p className="text-xs text-muted-foreground">
                {pendingCompletion
                  ? formatProjectDateTime(pendingCompletion.submitted_at)
                  : "Gönderim zamanı bulunamadı"}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                {pendingCompletion?.note || order.completion_note || "Açıklama bulunamadı."}
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {pendingCompletionPhotos.map((photo) => (
                <button
                  type="button"
                  key={photo.id}
                  onClick={() =>
                    photo.signedUrl &&
                    setSelectedPhoto({
                      url: photo.signedUrl,
                      label: photo.caption || photoTypeLabels[photo.photo_type],
                    })
                  }
                  className="overflow-hidden rounded-lg border border-border text-left"
                >
                  <img
                    src={photo.signedUrl ?? ""}
                    alt={photo.caption || photoTypeLabels[photo.photo_type]}
                    className="aspect-video w-full object-cover"
                  />
                  <span className="block p-2 text-xs font-bold">
                    {photoTypeLabels[photo.photo_type]}
                  </span>
                </button>
              ))}
            </div>
            <Textarea
              value={reviewNote}
              onChange={(event) => setReviewNote(event.target.value)}
              placeholder="Onay notu veya revizyon talebinizi yazın"
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                variant="outline"
                onClick={() => reviewCompletionMutation.mutate(false)}
                disabled={reviewCompletionMutation.isPending}
              >
                Revizyona Gönder
              </Button>
              <Button
                onClick={() => reviewCompletionMutation.mutate(true)}
                disabled={reviewCompletionMutation.isPending}
                className="bg-emerald-600 text-white hover:bg-emerald-500"
              >
                <CheckCircle2 className="mr-2 h-4 w-4" /> Tamamlandı Olarak Onayla
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Revizyona gönderirken açıklama zorunludur. Onaydan sonra iş müşteriye açıksa müşteri
              panelinde görünür.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {canOperate ? (
        <section className="mt-6">
          <h2 className="mb-3 text-xl font-black">Kullanılan Malzemeler</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            İş kapsamı:{" "}
            <strong>
              {order.work_scope_type === "labor_only" ? "Yalnızca işçilik" : "İşçilik + malzeme"}
            </strong>
            {order.work_scope_type === "labor_and_material"
              ? ` · Varsayılan kaynak: ${materialSourceLabels[order.default_material_source]}`
              : " · Malzeme kaydı yöneticinin kapsamı değiştirmesinden sonra açılır."}
          </p>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>NES Stoğundan Kullan</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Select value={stockItemId} onValueChange={setStockItemId}>
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder="Stok malzemesi seçin" />
                  </SelectTrigger>
                  <SelectContent>
                    {stockItems.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.code ? `${item.code} · ` : ""}
                        {item.name} ({item.quantity} {item.unit})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    inputMode="decimal"
                    value={stockQuantity}
                    onChange={(event) => setStockQuantity(event.target.value)}
                    placeholder="Miktar"
                  />
                  <Input
                    value={stockNote}
                    onChange={(event) => setStockNote(event.target.value)}
                    placeholder="Not"
                  />
                </div>
                <Button
                  className="w-full"
                  onClick={() => stockMutation.mutate()}
                  disabled={stockMutation.isPending || order.work_scope_type === "labor_only"}
                >
                  <PackageMinus className="mr-2 h-4 w-4" /> Stoktan Düş
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Harici / Saha Malzemesi</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Select value={customSource} onValueChange={setCustomSource}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="contractor">Taşeron malzemesi</SelectItem>
                    <SelectItem value="customer_site">Müşteri / şantiye malzemesi</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={customName}
                  onChange={(event) => setCustomName(event.target.value)}
                  placeholder="Malzeme adı"
                />
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    inputMode="decimal"
                    value={customQuantity}
                    onChange={(event) => setCustomQuantity(event.target.value)}
                    placeholder="Miktar"
                  />
                  <Select value={customUnit} onValueChange={setCustomUnit}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="adet">Adet</SelectItem>
                      <SelectItem value="metre">Metre</SelectItem>
                      <SelectItem value="kg">kg</SelectItem>
                      <SelectItem value="litre">Litre</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => customMaterialMutation.mutate()}
                  disabled={
                    customMaterialMutation.isPending || order.work_scope_type === "labor_only"
                  }
                >
                  <Plus className="mr-2 h-4 w-4" /> Malzeme Kaydet
                </Button>
              </CardContent>
            </Card>
          </div>
          <div className="mt-4 grid gap-2">
            {materials.map((material) => (
              <div
                key={material.id}
                className="surface-panel flex items-center justify-between gap-4 p-3"
              >
                <div>
                  <p className="font-semibold">
                    {material.is_nes_stock
                      ? material.stock_items?.name
                      : material.custom_material_name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {materialSourceLabels[material.material_source] || material.material_source} ·{" "}
                    {formatDate(material.created_at)}
                  </p>
                </div>
                <strong>
                  {material.quantity} {material.unit}
                </strong>
              </div>
            ))}
            {materials.length === 0 ? (
              <p className="surface-panel p-5 text-center text-sm text-muted-foreground">
                Henüz malzeme kaydı yok.
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="mt-7">
        <h2 className="mb-3 text-xl font-black">Saha Fotoğrafları</h2>
        {photos.length === 0 ? (
          <EmptyState
            title="Henüz fotoğraf yok"
            description="Fotoğraflar eklendiğinde burada görünecek."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {photos.map((photo) => (
              <Card key={photo.id} className="overflow-hidden">
                {photo.signedUrl ? (
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedPhoto({
                        url: photo.signedUrl!,
                        label: photo.caption || photoTypeLabels[photo.photo_type],
                      })
                    }
                    className="block w-full cursor-zoom-in"
                  >
                    <img
                      src={photo.signedUrl}
                      alt={photo.caption || photoTypeLabels[photo.photo_type]}
                      className="aspect-video w-full bg-muted object-cover transition-transform hover:scale-[1.02]"
                    />
                  </button>
                ) : (
                  <div className="flex aspect-video items-center justify-center bg-muted text-sm text-muted-foreground">
                    Fotoğraf açılamadı
                  </div>
                )}
                <CardContent className="space-y-2 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="outline">{photoTypeLabels[photo.photo_type]}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(photo.created_at)}
                    </span>
                  </div>
                  <p className="text-sm">{photo.caption || "Açıklama eklenmemiş"}</p>
                  {role === "admin" ? (
                    <label className="flex items-center justify-between rounded-md border p-2 text-xs">
                      Müşteriye Göster
                      <Switch
                        checked={photo.show_to_customer}
                        onCheckedChange={(visible) =>
                          photoVisibilityMutation.mutate({ photoId: photo.id, visible })
                        }
                      />
                    </label>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {role !== "customer" && progress.length > 0 ? (
        <section className="mt-7">
          <h2 className="mb-3 text-xl font-black">İlerleme Geçmişi</h2>
          <div className="grid gap-2">
            {progress.map((item) => (
              <div
                key={item.id}
                className="surface-panel flex items-start justify-between gap-4 p-4"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <strong>%{item.pct}</strong>
                    <Badge
                      variant="outline"
                      className={
                        item.status === "pending"
                          ? "border-amber-500/50 text-amber-300"
                          : item.status === "approved"
                            ? "border-emerald-500/50 text-emerald-300"
                            : "border-red-500/50 text-red-300"
                      }
                    >
                      {item.status === "pending"
                        ? "Onay Bekliyor"
                        : item.status === "approved"
                          ? "Onaylandı"
                          : "Reddedildi"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {item.note || "Not girilmedi"}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Gönderen: {progressProfileById.get(item.contractor_id) || "Kullanıcı"}
                    {item.reviewed_at
                      ? ` · ${progressProfileById.get(item.reviewed_by ?? "") || "Yönetici"} · ${formatProjectDateTime(item.reviewed_at)}`
                      : ""}
                  </p>
                  {item.review_note ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Yönetici notu: {item.review_note}
                    </p>
                  ) : null}
                </div>
                <span className="text-xs text-muted-foreground">
                  {formatProjectDateTime(item.created_at)}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {role !== "customer" && completionSubmissions.length > 0 ? (
        <section className="mt-7">
          <h2 className="mb-3 text-xl font-black">İş Bitirme Onay Geçmişi</h2>
          <div className="grid gap-2">
            {completionSubmissions.map((submission) => (
              <div key={submission.id} className="surface-panel p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge
                    variant="outline"
                    className={
                      submission.status === "pending"
                        ? "border-amber-500/50 text-amber-300"
                        : submission.status === "approved"
                          ? "border-emerald-500/50 text-emerald-300"
                          : "border-red-500/50 text-red-300"
                    }
                  >
                    {submission.status === "pending"
                      ? "Onay Bekliyor"
                      : submission.status === "approved"
                        ? "Onaylandı"
                        : "Revizyon İstendi"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatProjectDateTime(submission.submitted_at)}
                  </span>
                </div>
                <p className="mt-3 text-sm">{submission.note}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Gönderen: {completionProfileById.get(submission.submitted_by) || "Taşeron"}
                  {submission.reviewed_at
                    ? ` · Onaylayan: ${completionProfileById.get(submission.reviewed_by ?? "") || "Yönetici"} · ${formatProjectDateTime(submission.reviewed_at)}`
                    : ""}
                </p>
                {submission.review_note ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Yönetici notu: {submission.review_note}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <Dialog
        open={Boolean(selectedPhoto)}
        onOpenChange={(open) => {
          if (!open) setSelectedPhoto(null);
        }}
      >
        <DialogContent className="max-w-5xl">
          <DialogTitle>{selectedPhoto?.label || "Saha fotoğrafı"}</DialogTitle>
          {selectedPhoto ? (
            <img
              src={selectedPhoto.url}
              alt={selectedPhoto.label}
              className="max-h-[78vh] w-full rounded-lg bg-muted object-contain"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

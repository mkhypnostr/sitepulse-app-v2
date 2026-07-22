import { useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
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
import { compressImage } from "@/lib/image-compress";
import { EmptyState, LoadingState, PageHeader } from "@/components/page-states";
import { MapPreview } from "@/components/map-preview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  const [progressPct, setProgressPct] = useState("0");
  const [progressNote, setProgressNote] = useState("");
  const [photoType, setPhotoType] = useState<PhotoType>("saha");
  const [photoCaption, setPhotoCaption] = useState("");
  const [uploading, setUploading] = useState(false);
  const [stockItemId, setStockItemId] = useState("");
  const [stockQuantity, setStockQuantity] = useState("");
  const [stockNote, setStockNote] = useState("");
  const [customName, setCustomName] = useState("");
  const [customQuantity, setCustomQuantity] = useState("");
  const [customUnit, setCustomUnit] = useState("adet");

  const detailQuery = useQuery({
    queryKey: ["job-detail", jobId, role],
    enabled: Boolean(role),
    queryFn: async () => {
      const [orderResult, photosResult, progressResult] = await Promise.all([
        supabase
          .from("work_orders")
          .select(
            "*, customers(name, contact), work_order_financials(total_amount, approved_progress_pct)",
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
      ]);
      if (orderResult.error) throw orderResult.error;
      if (photosResult.error) throw photosResult.error;
      if (progressResult.error && role !== "customer") throw progressResult.error;

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
              "id, custom_material_name, quantity, unit, is_nes_stock, created_at, stock_items(name, code)",
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

      return {
        order: orderResult.data,
        photos,
        progress: progressResult.data ?? [],
        materials,
        stockItems,
      };
    },
  });

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
      if (!Number.isInteger(pct) || pct < 0 || pct > 100) {
        throw new Error("İlerleme 0–100 arasında tam sayı olmalıdır");
      }
      const { error } = await supabase.rpc("submit_progress_update", {
        target_work_order_id: jobId,
        new_pct: pct,
        progress_note: progressNote,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await refresh();
      setProgressNote("");
      toast.success("İlerleme kaydedildi");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const approvalMutation = useMutation({
    mutationFn: async () => {
      const pct = detailQuery.data?.order.progress_pct ?? 0;
      const { error } = await supabase.rpc("approve_progress", {
        target_work_order_id: jobId,
        approved_pct_value: pct,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await refresh();
      toast.success("Hakediş ilerlemesi onaylandı");
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

  const { order, photos, progress, materials, stockItems } = detailQuery.data;
  const canOperate = role === "admin" || role === "contractor";
  const financials = order.work_order_financials;
  const payableAmount =
    (financials?.total_amount ?? 0) * ((financials?.approved_progress_pct ?? 0) / 100);

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
          <Badge variant="outline" className="px-3 py-2">
            {statusLabels[order.status]}
          </Badge>
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
                <p className="text-xs text-muted-foreground">Toplam İş Bedeli</p>
                <p className="text-xl font-black">{formatTRY(financials?.total_amount)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Onaylı İlerleme</p>
                <p className="text-xl font-black">%{financials?.approved_progress_pct ?? 0}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Onaylı Hakediş</p>
                <p className="text-xl font-black text-primary">{formatTRY(payableAmount)}</p>
              </div>
              <Button
                className="w-full"
                onClick={() => approvalMutation.mutate()}
                disabled={
                  (financials?.approved_progress_pct ?? 0) === order.progress_pct ||
                  approvalMutation.isPending
                }
              >
                <CheckCircle2 className="mr-2 h-4 w-4" /> Mevcut %{order.progress_pct} İlerlemeyi
                Onayla
              </Button>
            </CardContent>
          </Card>
        ) : null}
      </div>

      {canOperate ? (
        <div className="mt-6 grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>İlerleme Bildir</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="grid gap-1 text-sm">
                İlerleme Yüzdesi
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={progressPct}
                  onChange={(event) => setProgressPct(event.target.value)}
                />
              </label>
              <label className="grid gap-1 text-sm">
                Yapılan İş / Açıklama
                <Textarea
                  value={progressNote}
                  onChange={(event) => setProgressNote(event.target.value)}
                  placeholder="Bugün tamamlanan işleri yazın"
                />
              </label>
              <Button
                className="w-full h-12"
                onClick={() => progressMutation.mutate()}
                disabled={progressMutation.isPending}
              >
                {progressMutation.isPending ? "Kaydediliyor..." : "İlerlemeyi Kaydet"}
              </Button>
            </CardContent>
          </Card>

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

      {canOperate ? (
        <section className="mt-6">
          <h2 className="mb-3 text-xl font-black">Kullanılan Malzemeler</h2>
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
                  disabled={stockMutation.isPending}
                >
                  <PackageMinus className="mr-2 h-4 w-4" /> Stoktan Düş
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Taşerona Ait Malzeme</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
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
                  disabled={customMaterialMutation.isPending}
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
                    {material.is_nes_stock ? "NES stoğu" : "Taşeron malzemesi"} ·{" "}
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
                  <img
                    src={photo.signedUrl}
                    alt={photo.caption || photoTypeLabels[photo.photo_type]}
                    className="aspect-video w-full bg-muted object-cover"
                  />
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
                  <strong>%{item.pct}</strong>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {item.note || "Not girilmedi"}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">{formatDate(item.created_at)}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

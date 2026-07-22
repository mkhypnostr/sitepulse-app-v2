import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  CirclePause,
  Pencil,
  Play,
  RotateCcw,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/domain";
import { safeHttpsMapUrl } from "@/lib/map-location";
import { projectStatusLabel, type ProjectStatus } from "@/lib/projects";
import { MapPreview } from "@/components/map-preview";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

type Project = Database["public"]["Tables"]["projects"]["Row"];
type Manager = Pick<Database["public"]["Tables"]["profiles"]["Row"], "id" | "full_name">;

type Transition = {
  status: ProjectStatus;
  label: string;
  description: string;
  requiresReason?: boolean;
  tone?: "default" | "destructive";
};

function editForm(project: Project) {
  return {
    name: project.name,
    externalReference: project.external_reference_no ?? "",
    locationUrl: project.location_url ?? "",
    province: project.province ?? "",
    district: project.district ?? "",
    neighborhood: project.neighborhood ?? "",
    blockNo: project.block_no ?? "",
    parcelNo: project.parcel_no ?? "",
    area: project.area == null ? "" : String(project.area),
    managerId: project.manager_id ?? "none",
    startDate: project.start_date ?? "",
    targetEndDate: project.target_end_date ?? "",
    showToCustomer: project.show_to_customer,
    description: project.description ?? "",
    adminNotes: project.admin_notes ?? "",
  };
}

export function ProjectLifecycleControls({
  project,
  managers,
}: {
  project: Project;
  managers: Manager[];
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [transition, setTransition] = useState<Transition | null>(null);
  const [transitionNote, setTransitionNote] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState(() => editForm(project));

  useEffect(() => setForm(editForm(project)), [project]);

  const actions = useMemo<Transition[]>(() => {
    if (project.status === "draft") {
      return [
        {
          status: "active",
          label: "Projeyi Başlat",
          description:
            "Proje aktif hale gelir. Başlangıç tarihi boşsa bugünün tarihi otomatik yazılır.",
        },
      ];
    }
    if (project.status === "active") {
      return [
        {
          status: "on_hold",
          label: "Beklet",
          description: "Proje geçici olarak beklemeye alınır.",
          requiresReason: true,
        },
        {
          status: "completed",
          label: "Tamamla",
          description: "Tüm uygulanabilir görevler bittiyse proje tamamlanır.",
        },
        {
          status: "cancelled",
          label: "İptal Et",
          description: "Proje geçmiş kayıtları korunarak iptal edilir.",
          requiresReason: true,
          tone: "destructive",
        },
      ];
    }
    if (project.status === "on_hold") {
      return [
        {
          status: "active",
          label: "Devam Ettir",
          description: "Proje yeniden aktif çalışmaya alınır.",
        },
        {
          status: "cancelled",
          label: "İptal Et",
          description: "Proje geçmiş kayıtları korunarak iptal edilir.",
          requiresReason: true,
          tone: "destructive",
        },
      ];
    }
    if (project.status === "completed") {
      return [
        {
          status: "active",
          label: "Yeniden Aç",
          description: "Tamamlanan proje yeniden aktif hale getirilir.",
          requiresReason: true,
        },
      ];
    }
    return [];
  }, [project.status]);

  const lifecycleMutation = useMutation({
    mutationFn: async () => {
      if (!transition) return;
      if (transition.requiresReason && !transitionNote.trim()) {
        throw new Error("Kısa bir açıklama yazın");
      }
      const { error } = await supabase.rpc("update_project_lifecycle", {
        target_project_id: project.id,
        new_status: transition.status,
        change_note: transitionNote.trim() || undefined,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["project-detail", project.id] }),
        queryClient.invalidateQueries({ queryKey: ["projects-page"] }),
      ]);
      setTransition(null);
      setTransitionNote("");
      toast.success("Proje durumu güncellendi");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const editMutation = useMutation({
    mutationFn: async () => {
      const parsedArea = form.area.trim() ? Number(form.area.trim().replace(",", ".")) : undefined;
      if (parsedArea !== undefined && (!Number.isFinite(parsedArea) || parsedArea <= 0)) {
        throw new Error("Alan bilgisini sıfırdan büyük bir sayı olarak girin");
      }
      if (!safeHttpsMapUrl(form.locationUrl)) {
        throw new Error("Google Maps'ten kopyaladığınız güvenli konum bağlantısını girin");
      }
      const { error } = await supabase.rpc("update_project_details", {
        target_project_id: project.id,
        project_name: form.name.trim(),
        project_external_reference_no: form.externalReference.trim() || undefined,
        project_location_url: form.locationUrl.trim(),
        project_province: form.province.trim() || undefined,
        project_district: form.district.trim() || undefined,
        project_neighborhood: form.neighborhood.trim() || undefined,
        project_block_no: form.blockNo.trim() || undefined,
        project_parcel_no: form.parcelNo.trim() || undefined,
        project_area: parsedArea,
        target_manager_id: form.managerId === "none" ? undefined : form.managerId,
        project_start_date: form.startDate || undefined,
        project_target_end_date: form.targetEndDate || undefined,
        visible_to_customer: form.showToCustomer,
        project_description: form.description.trim() || undefined,
        project_admin_notes: form.adminNotes.trim() || undefined,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["project-detail", project.id] }),
        queryClient.invalidateQueries({ queryKey: ["projects-page"] }),
      ]);
      setEditOpen(false);
      toast.success("Proje bilgileri güncellendi");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("delete_draft_project", {
        target_project_id: project.id,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["projects-page"] });
      toast.success("Taslak proje silindi");
      navigate({ to: "/projects" });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const editable =
    project.status === "draft" || project.status === "active" || project.status === "on_hold";

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {editable ? (
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil className="mr-2 h-4 w-4" /> Düzenle
          </Button>
        ) : null}
        {actions.map((action) => (
          <Button
            key={`${project.status}-${action.status}`}
            variant={action.tone === "destructive" ? "destructive" : "default"}
            onClick={() => {
              setTransitionNote("");
              setTransition(action);
            }}
          >
            {action.status === "active" && project.status === "draft" ? (
              <Play className="mr-2 h-4 w-4" />
            ) : action.status === "active" ? (
              <RotateCcw className="mr-2 h-4 w-4" />
            ) : action.status === "on_hold" ? (
              <CirclePause className="mr-2 h-4 w-4" />
            ) : action.status === "completed" ? (
              <CheckCircle2 className="mr-2 h-4 w-4" />
            ) : (
              <XCircle className="mr-2 h-4 w-4" />
            )}
            {action.label}
          </Button>
        ))}
        {project.status === "draft" ? (
          <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="mr-2 h-4 w-4" /> Taslağı Sil
          </Button>
        ) : null}
      </div>

      <Dialog
        open={Boolean(transition)}
        onOpenChange={(open) => {
          if (!open && !lifecycleMutation.isPending) setTransition(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{transition?.label}</DialogTitle>
            <DialogDescription>{transition?.description}</DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border border-border bg-muted/20 p-4 text-sm">
            <span className="text-muted-foreground">Yeni durum: </span>
            <strong>{transition ? projectStatusLabel[transition.status] : "—"}</strong>
          </div>
          <label className="grid gap-1.5 text-sm font-bold">
            Açıklama{" "}
            {transition?.requiresReason ? <span className="text-destructive">*</span> : null}
            <Textarea
              value={transitionNote}
              onChange={(event) => setTransitionNote(event.target.value)}
              maxLength={1000}
              placeholder="Durum değişikliğinin kısa açıklaması"
            />
          </label>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setTransition(null)}
              disabled={lifecycleMutation.isPending}
            >
              Vazgeç
            </Button>
            <Button
              variant={transition?.tone === "destructive" ? "destructive" : "default"}
              onClick={() => lifecycleMutation.mutate()}
              disabled={
                lifecycleMutation.isPending ||
                Boolean(transition?.requiresReason && !transitionNote.trim())
              }
            >
              {lifecycleMutation.isPending ? "Kaydediliyor..." : "Onayla"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-destructive/15 text-destructive">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <DialogTitle>Taslak proje kalıcı olarak silinsin mi?</DialogTitle>
            <DialogDescription>
              {project.project_no} numaralı taslak ve otomatik görev listeleri silinir. Üzerinde
              çalışma yapılmışsa sistem silmeye izin vermez.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={deleteMutation.isPending}
            >
              Vazgeç
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Siliniyor..." : "Taslağı Kalıcı Sil"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editOpen}
        onOpenChange={(open) => {
          if (editMutation.isPending) return;
          setEditOpen(open);
          if (open) setForm(editForm(project));
        }}
      >
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Proje bilgilerini düzenle</DialogTitle>
            <DialogDescription>
              Müşteri ve proje süreçleri korunur; proje kartındaki bilgiler güncellenir.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">
              Proje Adı <span className="text-destructive">*</span>
              <Input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                maxLength={180}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">
              Google Maps Konumu <span className="text-destructive">*</span>
              <Input
                value={form.locationUrl}
                onChange={(event) => setForm({ ...form, locationUrl: event.target.value })}
                placeholder="Google Maps > Paylaş > Bağlantıyı kopyala"
              />
            </label>
            {safeHttpsMapUrl(form.locationUrl) ? (
              <MapPreview
                mapUrl={form.locationUrl}
                fallbackQuery={[form.neighborhood, form.district, form.province]
                  .filter(Boolean)
                  .join(", ")}
                compact
                className="sm:col-span-2"
              />
            ) : null}
            <label className="grid gap-1.5 text-sm font-medium">
              Dış Referans Numarası
              <Input
                value={form.externalReference}
                onChange={(event) => setForm({ ...form, externalReference: event.target.value })}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              NES Proje Sorumlusu
              <Select
                value={form.managerId}
                onValueChange={(managerId) => setForm({ ...form, managerId })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Atanmadı</SelectItem>
                  {managers.map((manager) => (
                    <SelectItem key={manager.id} value={manager.id}>
                      {manager.full_name || "İsimsiz yönetici"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              İl
              <Input
                value={form.province}
                onChange={(event) => setForm({ ...form, province: event.target.value })}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              İlçe
              <Input
                value={form.district}
                onChange={(event) => setForm({ ...form, district: event.target.value })}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">
              Mahalle
              <Input
                value={form.neighborhood}
                onChange={(event) => setForm({ ...form, neighborhood: event.target.value })}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Ada
              <Input
                value={form.blockNo}
                onChange={(event) => setForm({ ...form, blockNo: event.target.value })}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Parsel
              <Input
                value={form.parcelNo}
                onChange={(event) => setForm({ ...form, parcelNo: event.target.value })}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Alan (m²)
              <Input
                inputMode="decimal"
                value={form.area}
                onChange={(event) => setForm({ ...form, area: event.target.value })}
              />
            </label>
            <div />
            <label className="grid gap-1.5 text-sm font-medium">
              Başlangıç Tarihi
              <Input
                type="date"
                value={form.startDate}
                onChange={(event) => setForm({ ...form, startDate: event.target.value })}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Hedef Bitiş Tarihi
              <Input
                type="date"
                value={form.targetEndDate}
                onChange={(event) => setForm({ ...form, targetEndDate: event.target.value })}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">
              Proje Açıklaması
              <Textarea
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">
              Yönetici Notu
              <Textarea
                value={form.adminNotes}
                onChange={(event) => setForm({ ...form, adminNotes: event.target.value })}
              />
            </label>
            <div className="flex items-center justify-between rounded-xl border border-border bg-muted/20 p-4 sm:col-span-2">
              <div>
                <p className="text-sm font-bold">Müşteri panelinde göster</p>
                <p className="text-xs text-muted-foreground">Müşteri erişim ayarını günceller.</p>
              </div>
              <Switch
                checked={form.showToCustomer}
                onCheckedChange={(showToCustomer) => setForm({ ...form, showToCustomer })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditOpen(false)}
              disabled={editMutation.isPending}
            >
              Vazgeç
            </Button>
            <Button
              onClick={() => editMutation.mutate()}
              disabled={
                !form.name.trim() || !safeHttpsMapUrl(form.locationUrl) || editMutation.isPending
              }
            >
              {editMutation.isPending ? "Kaydediliyor..." : "Değişiklikleri Kaydet"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

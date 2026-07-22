import { useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, ImagePlus, Loader2, Paperclip } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { errorMessage } from "@/lib/domain";
import { Button } from "@/components/ui/button";

type EvidenceType = "photo" | "document";

const maxFileSize = 20 * 1024 * 1024;
const permittedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

function safeFileName(name: string) {
  const extension = name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "file";
  return `${crypto.randomUUID()}.${extension}`;
}

export function ProjectTaskEvidence({
  taskId,
  projectId,
  requiresPhoto,
  requiresDocument,
  canUpload,
  compact = false,
}: {
  taskId: string;
  projectId: string;
  requiresPhoto: boolean;
  requiresDocument: boolean;
  canUpload: boolean;
  compact?: boolean;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const photoInput = useRef<HTMLInputElement>(null);
  const documentInput = useRef<HTMLInputElement>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const evidenceQuery = useQuery({
    queryKey: ["project-task-evidence", taskId],
    enabled: Boolean(taskId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_task_evidence")
        .select("*")
        .eq("project_task_id", taskId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const uploadEvidence = useMutation({
    mutationFn: async ({ file, evidenceType }: { file: File; evidenceType: EvidenceType }) => {
      if (!user) throw new Error("Oturum bulunamadı.");
      if (file.size > maxFileSize) throw new Error("Dosya en fazla 20 MB olabilir.");
      if (!permittedMimeTypes.has(file.type)) {
        throw new Error("Yalnızca JPG, PNG, WEBP veya PDF dosyası ekleyin.");
      }
      if (evidenceType === "photo" && !file.type.startsWith("image/")) {
        throw new Error("Fotoğraf kaydı için bir görsel seçin.");
      }
      if (evidenceType === "document" && file.type !== "application/pdf") {
        throw new Error("Belge kaydı için PDF seçin.");
      }

      const storagePath = `tasks/${taskId}/${safeFileName(file.name)}`;
      const upload = await supabase.storage.from("project-evidence").upload(storagePath, file, {
        contentType: file.type,
        upsert: false,
      });
      if (upload.error) throw upload.error;

      const { error } = await supabase.from("project_task_evidence").insert({
        project_task_id: taskId,
        storage_path: storagePath,
        file_name: file.name,
        mime_type: file.type,
        size_bytes: file.size,
        evidence_type: evidenceType,
        uploaded_by: user.id,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["project-task-evidence", taskId] });
      await queryClient.invalidateQueries({ queryKey: ["project-detail", projectId] });
      toast.success("Kanıt dosyası eklendi");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const openEvidence = async (id: string, storagePath: string) => {
    setOpeningId(id);
    try {
      const { data, error } = await supabase.storage
        .from("project-evidence")
        .createSignedUrl(storagePath, 60);
      if (error) throw error;
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setOpeningId(null);
    }
  };

  const startUpload = (event: ChangeEvent<HTMLInputElement>, evidenceType: EvidenceType) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) uploadEvidence.mutate({ file, evidenceType });
  };

  const evidence = evidenceQuery.data ?? [];
  const shouldShow = requiresPhoto || requiresDocument || evidence.length > 0 || canUpload;
  if (!shouldShow) return null;

  return (
    <div className={compact ? "mt-3" : "mt-4 rounded-xl border border-dashed border-primary/30 bg-primary/5 p-3"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-primary">
          <Paperclip className="h-3.5 w-3.5" /> Kanıt Dosyaları
        </p>
        {canUpload ? (
          <div className="flex flex-wrap gap-2">
            {requiresPhoto || !requiresDocument ? (
              <>
                <input
                  ref={photoInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(event) => startUpload(event, "photo")}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => photoInput.current?.click()}
                  disabled={uploadEvidence.isPending}
                >
                  {uploadEvidence.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="mr-1.5 h-3.5 w-3.5" />}
                  Fotoğraf Ekle
                </Button>
              </>
            ) : null}
            {requiresDocument || !requiresPhoto ? (
              <>
                <input
                  ref={documentInput}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(event) => startUpload(event, "document")}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => documentInput.current?.click()}
                  disabled={uploadEvidence.isPending}
                >
                  {uploadEvidence.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileText className="mr-1.5 h-3.5 w-3.5" />}
                  Belge Ekle
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
      {evidence.length ? (
        <div className="mt-2 space-y-1.5">
          {evidence.map((item) => (
            <button
              type="button"
              key={item.id}
              className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-background/70 px-3 py-2 text-left text-xs transition-colors hover:border-primary/50"
              onClick={() => openEvidence(item.id, item.storage_path)}
              disabled={openingId === item.id}
            >
              <span className="flex min-w-0 items-center gap-2">
                {item.evidence_type === "photo" ? <ImagePlus className="h-3.5 w-3.5 shrink-0 text-primary" /> : <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />}
                <span className="truncate font-semibold">{item.file_name}</span>
              </span>
              {openingId === item.id ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <Download className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          {requiresPhoto || requiresDocument ? "Bu görev için henüz kanıt dosyası eklenmedi." : "İsteğe bağlı kanıt dosyası ekleyebilirsiniz."}
        </p>
      )}
    </div>
  );
}

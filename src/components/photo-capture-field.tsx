import { useEffect, useRef, useState } from "react";
import { Camera, Images, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/**
 * Fotoğraf seç/çek -> önizleme + açıklama -> onay ile yükleme akışı.
 * Yükleme yalnızca `confirmLabel` butonuna basıldığında `onConfirm` üzerinden başlar.
 */
export function PhotoCaptureField({
  accept = "image/jpeg,image/png,image/webp",
  cameraLabel = "Kameradan Çek",
  galleryLabel = "Galeriden Seç",
  captionPlaceholder = "Fotoğraf hakkında açıklama ekleyin (opsiyonel)",
  confirmLabel = "Fotoğraf Ekle",
  disabled = false,
  onConfirm,
}: {
  accept?: string;
  cameraLabel?: string;
  galleryLabel?: string;
  captionPlaceholder?: string;
  confirmLabel?: string;
  disabled?: boolean;
  onConfirm: (file: File, caption: string) => Promise<void>;
}) {
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const reset = () => {
    setFile(null);
    setCaption("");
    if (cameraInput.current) cameraInput.current.value = "";
    if (galleryInput.current) galleryInput.current.value = "";
  };

  const confirm = async () => {
    if (!file) return;
    setSubmitting(true);
    try {
      await onConfirm(file, caption.trim());
      reset();
    } catch {
      // Yükleme hatası çağıran taraftaki bildirimle gösterilir; önizleme korunur.
    } finally {
      setSubmitting(false);
    }
  };

  if (file) {
    return (
      <div className="space-y-3 rounded-xl border border-border bg-background/40 p-3">
        <div className="overflow-hidden rounded-lg border border-border bg-black/20">
          <img
            src={previewUrl ?? undefined}
            alt="Fotoğraf önizleme"
            className="max-h-72 w-full object-contain"
          />
        </div>
        <label className="grid gap-1 text-sm">
          Açıklama
          <Textarea
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            placeholder={captionPlaceholder}
            rows={2}
            disabled={submitting}
          />
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button
            type="button"
            variant="outline"
            onClick={reset}
            disabled={submitting}
          >
            <X className="mr-2 h-4 w-4" /> Vazgeç
          </Button>
          <Button
            type="button"
            onClick={confirm}
            disabled={submitting || disabled}
          >
            {submitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Camera className="mr-2 h-4 w-4" />
            )}
            {confirmLabel}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <input
        ref={cameraInput}
        type="file"
        accept={accept}
        capture="environment"
        className="hidden"
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
      />
      <input
        ref={galleryInput}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
      />
      <div className="grid gap-2 sm:grid-cols-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => cameraInput.current?.click()}
          disabled={disabled}
        >
          <Camera className="mr-2 h-4 w-4" /> {cameraLabel}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => galleryInput.current?.click()}
          disabled={disabled}
        >
          <Images className="mr-2 h-4 w-4" /> {galleryLabel}
        </Button>
      </div>
    </>
  );
}

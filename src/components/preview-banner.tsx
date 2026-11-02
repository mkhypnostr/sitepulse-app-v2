import { useEffect, useState } from "react";
import { Eye, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  isPreviewTab,
  PREVIEW_PATH,
  previewInfo,
  type PreviewInfo,
} from "@/lib/preview-mode";
import { roleLabels } from "@/lib/domain";

// Önizleme sekmesinde ekranın kenarına renkli çerçeve ve altta kimin
// gözünden bakıldığını gösteren şerit. Süre dolunca ya da "Kapat" ile
// yalnız bu sekmenin oturumu kapanır.

async function endPreview() {
  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  window.location.replace(PREVIEW_PATH);
}

export function PreviewBanner() {
  const [info, setInfo] = useState<PreviewInfo | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isPreviewTab()) return;
    setInfo(previewInfo());
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (info && now > info.expiresAt) void endPreview();
  }, [info, now]);

  if (!info) return null;
  const minutes = Math.max(0, Math.ceil((info.expiresAt - now) / 60_000));

  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[90] border-4 border-amber-500"
      />
      <div
        role="status"
        className="fixed bottom-24 left-1/2 z-[95] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-full bg-amber-500 py-2 pr-2 pl-4 text-sm font-semibold text-amber-950 shadow-lg lg:bottom-6"
      >
        <Eye className="h-4 w-4 shrink-0" />
        <span className="min-w-0 truncate">
          {info.name} · {roleLabels[info.role]}
          <span className="hidden sm:inline"> gözünden önizleme</span> · salt
          okunur · {minutes} dk
        </span>
        <button
          type="button"
          onClick={() => void endPreview()}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-amber-950/10 px-3 hover:bg-amber-950/20"
        >
          <X className="h-4 w-4" /> Kapat
        </button>
      </div>
    </>
  );
}

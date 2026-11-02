import { useState } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { Eye, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PREVIEW_PATH } from "@/lib/preview-mode";
import { Button } from "@/components/ui/button";

// Yönetici ekranındaki "Panelini gör" düğmesi: kişinin panelini yeni bir
// sekmede, onun gözünden ve salt okunur açar (bkz. src/lib/preview-mode.ts).

export function PreviewUserButton({
  userId,
  label = "Panelini gör",
}: {
  userId: string;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function open() {
    // Açılır pencere engelleyicisine takılmamak için sekme hemen açılır,
    // adres anahtar gelince verilir.
    const tab = window.open("about:blank", "_blank");
    if (!tab) {
      toast.error(
        "Tarayıcı yeni sekmeyi engelledi; açılır pencerelere izin verin.",
      );
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke<{
        token_hash: string;
        name: string;
        role: string;
      }>("nes-view-as", { body: { user_id: userId } });
      if (error) {
        if (error instanceof FunctionsHttpError) {
          const body = await error.context.json().catch(() => ({}));
          throw new Error(body.error ?? "Önizleme açılamadı.");
        }
        throw error;
      }
      if (!data?.token_hash) throw new Error("Önizleme açılamadı.");
      const hash = new URLSearchParams({
        t: data.token_hash,
        n: data.name,
        r: data.role,
      });
      tab.opener = null;
      tab.location.replace(
        `${window.location.origin}${PREVIEW_PATH}#${hash.toString()}`,
      );
    } catch (e) {
      tab.close();
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={() => void open()}
    >
      {busy ? (
        <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Eye className="mr-2 h-4 w-4" />
      )}
      {label}
    </Button>
  );
}

import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Eye, LoaderCircle, ShieldAlert } from "lucide-react";
import {
  supabase,
  supabaseUsesPreviewStorage,
} from "@/integrations/supabase/client";
import { previewSupported, startPreview } from "@/lib/preview-mode";
import { Button } from "@/components/ui/button";

// Panel önizleme sekmesinin giriş sayfası. Yönetici ekranı bu sekmeyi
// /onizleme#t=<anahtar>&n=<ad>&r=<rol> ile açar. Anahtar adres çubuğunun
// "#" kısmında taşınır (sunucuya ve kayıtlara gitmez), okunur okunmaz
// adresten silinir ve tek kullanımlıktır.

export const Route = createFileRoute("/onizleme")({
  component: PreviewEntryPage,
});

type State =
  | { kind: "working" }
  | { kind: "ended" }
  | { kind: "error"; message: string };

function PreviewEntryPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ kind: "working" });

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const token = params.get("t");
    const name = (params.get("n") ?? "").slice(0, 120);
    const role = params.get("r");
    window.history.replaceState(null, "", window.location.pathname);

    if (!token) {
      setState({ kind: "ended" });
      return;
    }
    if (role !== "customer" && role !== "contractor") {
      setState({ kind: "error", message: "Önizleme bağlantısı geçersiz." });
      return;
    }
    // Oturum bu sekmeye özel tutulamıyorsa yöneticinin kendi oturumu
    // ezilebilirdi; bu durumda önizleme hiç açılmaz.
    if (!previewSupported() || !supabaseUsesPreviewStorage()) {
      setState({
        kind: "error",
        message:
          "Bu tarayıcıda önizleme güvenle açılamıyor (gizli sekme ya da depolama kapalı olabilir).",
      });
      return;
    }

    void (async () => {
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
      startPreview({ name: name || "Kullanıcı", role });
      const { error } = await supabase.auth.verifyOtp({
        token_hash: token,
        type: "magiclink",
      });
      if (error) {
        setState({
          kind: "error",
          message:
            "Önizleme bağlantısının süresi dolmuş veya kullanılmış. Yönetici ekranından yeniden açın.",
        });
        return;
      }
      navigate({ to: "/dashboard", replace: true });
    })();
  }, [navigate]);

  return (
    <div className="grid min-h-screen place-items-center bg-background p-6">
      <div className="surface-panel w-full max-w-md p-6 text-center">
        {state.kind === "working" ? (
          <>
            <LoaderCircle className="mx-auto h-8 w-8 animate-spin text-primary" />
            <p className="mt-3 font-semibold">Panel önizlemesi açılıyor…</p>
          </>
        ) : state.kind === "ended" ? (
          <>
            <Eye className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 font-semibold">Önizleme kapandı.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Bu sekmeyi kapatabilirsiniz. Kendi oturumunuz diğer sekmede açık.
            </p>
            <Button
              className="mt-4"
              variant="outline"
              onClick={() => window.close()}
            >
              Sekmeyi kapat
            </Button>
          </>
        ) : (
          <>
            <ShieldAlert className="mx-auto h-8 w-8 text-destructive" />
            <p className="mt-3 font-semibold">Önizleme açılamadı</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {state.message}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

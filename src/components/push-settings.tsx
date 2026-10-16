import { useEffect, useState } from "react";
import { BellRing, Share, X } from "lucide-react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/domain";
import {
  disablePush,
  enablePush,
  getPushState,
  sendTestPush,
  type PushState,
} from "@/lib/push";
import { Button } from "@/components/ui/button";

const stateText: Record<PushState, string> = {
  on: "Bu cihazda bildirimler açık. Görev ataması, onay bekleyen kayıtlar, onay kararları ve gecikmeler buraya gelir.",
  off: "Bu cihazda bildirimler kapalı. Açarsanız görev, onay ve gecikmeler uygulama kapalıyken de telefonunuza düşer.",
  denied:
    "Bildirim izni bu cihazda reddedilmiş. Telefonun ayarlarından bu uygulamaya (veya tarayıcıya) bildirim izni verip sayfayı yenileyin.",
  "ios-install":
    "iPhone'da bildirim için uygulamayı ana ekrana eklemeniz gerekir: Safari'de Paylaş düğmesine basın, \"Ana Ekrana Ekle\"yi seçin, sonra uygulamayı ana ekrandaki simgeden açıp buradan bildirimleri açın.",
  unsupported:
    "Bu tarayıcı anlık bildirimi desteklemiyor. Android'de Chrome, bilgisayarda Chrome/Edge, iPhone'da ana ekrana eklenmiş uygulama kullanın.",
};

/** Profil ekranındaki "Telefon bildirimleri" bölümü. */
export function PushSettings() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getPushState().then(setState);
  }, []);

  async function run(action: () => Promise<PushState | void>) {
    setBusy(true);
    try {
      const next = await action();
      if (next) setState(next);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (!state) return null;
  return (
    <div className="space-y-3">
      <p className="text-sm leading-6 text-muted-foreground">
        {stateText[state]}
      </p>
      <div className="flex flex-wrap gap-2">
        {state === "off" ? (
          <Button disabled={busy} onClick={() => run(enablePush)}>
            <BellRing className="mr-2 h-4 w-4" /> Bildirimleri aç
          </Button>
        ) : null}
        {state === "on" ? (
          <>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const count = await sendTestPush();
                  toast.success(
                    count > 0
                      ? "Deneme bildirimi gönderildi; birkaç saniye içinde gelmeli."
                      : "Kayıtlı cihaz bulunamadı; bildirimleri yeniden açın.",
                  );
                })
              }
            >
              Deneme bildirimi gönder
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => run(disablePush)}
            >
              Bu cihazda kapat
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}

const DISMISS_KEY = "nes-push-banner-dismissed";

/** Bildirimi açık olmayan kullanıcıya bir kez gösterilen hatırlatma. */
export function PushBanner({ onOpenProfile }: { onOpenProfile: () => void }) {
  const [state, setState] = useState<PushState | null>(null);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }
    void getPushState().then(setState);
  }, []);

  if (dismissed || !state || !["off", "ios-install"].includes(state)) {
    return null;
  }
  const close = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // yalnız bu oturum için kapanır
    }
  };
  return (
    <div className="surface-panel mb-4 flex items-start gap-3 p-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        {state === "ios-install" ? (
          <Share className="h-5 w-5" />
        ) : (
          <BellRing className="h-5 w-5" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">Telefon bildirimleri</p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {state === "ios-install"
            ? "Görev ve onay bildirimlerini telefonunuzda almak için uygulamayı Safari'den ana ekrana ekleyin."
            : "Görev, onay ve gecikmeleri uygulama kapalıyken de almak için bildirimleri açın."}
        </p>
        <div className="mt-2 flex gap-2">
          {state === "off" ? (
            <Button
              size="sm"
              onClick={async () => {
                try {
                  const next = await enablePush();
                  if (next === "on") {
                    toast.success("Bildirimler açıldı.");
                    close();
                  } else setState(next);
                } catch (error) {
                  toast.error(errorMessage(error));
                }
              }}
            >
              Bildirimleri aç
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={onOpenProfile}>
              Nasıl yapılır
            </Button>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={close}
        aria-label="Kapat"
        className="press inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/5"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

// Ortak "Gönder" penceresi: WhatsApp (hazır mesaj; son Gönder kullanıcıda)
// ve e-posta (uygulamadan, NES adına). Dosya varsa tabletin paylaşım menüsü
// ile WhatsApp'a PDF olarak da gönderilebilir.
import { useEffect, useState } from "react";
import {
  Download,
  LoaderCircle,
  Mail,
  MessageCircle,
  Share2,
} from "lucide-react";
import { toast } from "sonner";
import { sendEmail, shareFile, whatsappUrl } from "@/lib/send-channels";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type SendTarget = {
  kind: "offer" | "survey";
  offerId?: string;
  title: string;
  phone?: string;
  email?: string;
  /** Müşteri linki (teklif). */
  link?: { url: string; label: string } | null;
  /** Hazır mesaj metni (WhatsApp ve e-posta gövdesi). */
  message: string;
  subject: string;
  /** PDF üretici (keşif föyü); WhatsApp'a dosya, e-postaya ek olarak gider. */
  makeFile?: () => Promise<File>;
};

export function SendDialog({
  target,
  onClose,
  onSent,
}: {
  target: SendTarget | null;
  onClose: () => void;
  onSent?: (channel: "whatsapp" | "email") => void;
}) {
  const [tab, setTab] = useState<"whatsapp" | "email">("whatsapp");
  const [phone, setPhone] = useState("");
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"" | "file" | "email">("");
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    if (!target) return;
    setPhone(target.phone ?? "");
    setTo(target.email ?? "");
    setCc("");
    setSubject(target.subject);
    setMessage(target.message);
    setFile(null);
    setTab("whatsapp");
  }, [target]);

  if (!target) return null;

  const textWithLink = target.link
    ? `${message.trim()}\n\n${target.link.url}`
    : message.trim();

  async function getFile() {
    if (file) return file;
    if (!target?.makeFile) return null;
    setBusy("file");
    try {
      const f = await target.makeFile();
      setFile(f);
      return f;
    } finally {
      setBusy("");
    }
  }

  async function shareAsFile() {
    try {
      const f = await getFile();
      if (!f) return;
      const shared = await shareFile(f, message.trim());
      if (shared) {
        onSent?.("whatsapp");
        return;
      }
      // Paylaşım menüsü yoksa (bilgisayar): dosyayı indir.
      const url = URL.createObjectURL(f);
      const a = document.createElement("a");
      a.href = url;
      a.download = f.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast.message(
        "PDF indirildi. WhatsApp'ta sohbete ataç ile ekleyebilirsiniz.",
      );
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  async function submitEmail() {
    const list = (v: string) =>
      v
        .split(/[,;\s]+/)
        .map((x) => x.trim())
        .filter(Boolean);
    if (!navigator.onLine) {
      toast.error("E-posta için internet gerekli.");
      return;
    }
    setBusy("email");
    try {
      const pdf = target?.makeFile ? await getFile() : null;
      const attachment = pdf ? { filename: pdf.name, blob: pdf } : null;
      await sendEmail({
        kind: target!.kind,
        offerId: target!.offerId,
        to: list(to),
        cc: list(cc),
        subject,
        message,
        link: target!.link ?? null,
        attachment,
      });
      toast.success("E-posta gönderildi.");
      onSent?.("email");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Gönder · {target.title}</DialogTitle>
          <DialogDescription>
            WhatsApp mesajı hazır açılır, son &quot;Gönder&quot;e siz
            basarsınız. E-posta NES adına gider; yanıtlar size gelir.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
          <Button
            type="button"
            variant={tab === "whatsapp" ? "default" : "ghost"}
            className="h-10"
            onClick={() => setTab("whatsapp")}
          >
            <MessageCircle className="mr-2 h-4 w-4" /> WhatsApp
          </Button>
          <Button
            type="button"
            variant={tab === "email" ? "default" : "ghost"}
            className="h-10"
            onClick={() => setTab("email")}
          >
            <Mail className="mr-2 h-4 w-4" /> E-posta
          </Button>
        </div>

        {tab === "whatsapp" ? (
          <div className="grid gap-3">
            <div>
              <Label className="mb-1 block">
                Telefon (boşsa WhatsApp&apos;ta kişi seçersiniz)
              </Label>
              <Input
                value={phone}
                inputMode="tel"
                placeholder="0532 123 45 67"
                onChange={(e) => setPhone(e.target.value)}
                className="h-11"
              />
            </div>
            <div>
              <Label className="mb-1 block">Mesaj</Label>
              <Textarea
                rows={6}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
              {target.link ? (
                <p className="mt-1 break-all text-[11px] text-muted-foreground">
                  Mesajın sonuna bağlantı eklenir: {target.link.url}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild className="h-11 font-bold">
                <a
                  href={whatsappUrl(phone, textWithLink)}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => onSent?.("whatsapp")}
                >
                  <MessageCircle className="mr-2 h-4 w-4" /> WhatsApp&apos;ta aç
                </a>
              </Button>
              {target.makeFile ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  disabled={busy === "file"}
                  onClick={() => void shareAsFile()}
                >
                  {busy === "file" ? (
                    <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Share2 className="mr-2 h-4 w-4" />
                  )}
                  PDF olarak paylaş
                </Button>
              ) : null}
            </div>
            {target.makeFile ? (
              <p className="text-[11px] text-muted-foreground">
                &quot;PDF olarak paylaş&quot; tablette paylaşım menüsünü açar
                (WhatsApp, Gmail, Drive…); bilgisayarda PDF&apos;i indirir.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-3">
            <div>
              <Label className="mb-1 block">
                Alıcı e-posta (virgülle birden çok)
              </Label>
              <Input
                value={to}
                inputMode="email"
                placeholder="musteri@ornek.com"
                onChange={(e) => setTo(e.target.value)}
                className="h-11"
              />
            </div>
            <div>
              <Label className="mb-1 block">Bilgi (CC, isteğe bağlı)</Label>
              <Input
                value={cc}
                inputMode="email"
                onChange={(e) => setCc(e.target.value)}
                className="h-11"
              />
            </div>
            <div>
              <Label className="mb-1 block">Konu</Label>
              <Input
                value={subject}
                maxLength={200}
                onChange={(e) => setSubject(e.target.value)}
                className="h-11"
              />
            </div>
            <div>
              <Label className="mb-1 block">Mesaj</Label>
              <Textarea
                rows={7}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                {target.link
                  ? 'E-postada "Teklifi görüntüle" düğmesi olur.'
                  : target.makeFile
                    ? "Keşif föyü PDF olarak eklenir."
                    : ""}
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          {tab === "email" ? (
            <Button
              type="button"
              className="h-11 font-bold"
              disabled={busy !== "" || !to.trim() || !subject.trim()}
              onClick={() => void submitEmail()}
            >
              {busy === "email" || busy === "file" ? (
                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Mail className="mr-2 h-4 w-4" />
              )}
              E-postayı gönder
            </Button>
          ) : target.makeFile ? (
            <Button
              type="button"
              variant="ghost"
              className="h-11"
              disabled={busy === "file"}
              onClick={async () => {
                const f = await getFile();
                if (!f) return;
                const url = URL.createObjectURL(f);
                const a = document.createElement("a");
                a.href = url;
                a.download = f.name;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 2000);
              }}
            >
              <Download className="mr-2 h-4 w-4" /> PDF indir
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

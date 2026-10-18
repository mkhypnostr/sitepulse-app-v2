import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, LoaderCircle, Pencil, Printer, Send } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { ensureOfferShareLink, extractContact } from "@/lib/send-channels";
import { SendDialog, type SendTarget } from "@/components/send/send-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { errorMessage } from "@/lib/domain";
import { formatProjectDateTime } from "@/lib/projects";
import {
  AccessDenied,
  LoadingState,
  PageHeader,
} from "@/components/page-states";
import { Button } from "@/components/ui/button";

// Teklifin müşteri dosyası: hazırlayıcıya girmeden görüntüleme ve PDF olarak
// yazdırma. Belge teklif her kaydedildiğinde offer_documents'a yazılır.
export const Route = createFileRoute("/_authenticated/teklif-dosyasi/$offerId")(
  {
    component: OfferDocumentPage,
  },
);

/** Dar ekranda A4 sayfaları kutuya sığdırır; üstteki "PDF / Yazdır"
 * düğmesinden gelen mesajla yazdırır. Belge kum havuzunda (sandbox, ayrı
 * köken) çalışır, uygulamaya ve oturuma erişemez. */
const FRAME_SCRIPT =
  "<script>(function(){function f(){var w=window.innerWidth;document.body.style.zoom=w<820?String(w/820):'';}f();addEventListener('resize',f);addEventListener('message',function(e){if(e.data==='nes-print')window.print();});})();</script>";

function OfferDocumentPage() {
  const { offerId } = Route.useParams();
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [sendTarget, setSendTarget] = useState<SendTarget | null>(null);
  const [preparing, setPreparing] = useState(false);

  const query = useQuery({
    queryKey: ["offer-document", offerId],
    enabled: isAdmin,
    queryFn: async () => {
      const [offerResult, documentResult] = await Promise.all([
        supabase
          .from("offers")
          .select(
            "id, offer_no, title, drive_excel_url, module_config, customers(name, contact)",
          )
          .eq("id", offerId)
          .maybeSingle(),
        supabase
          .from("offer_documents")
          .select("html, updated_at")
          .eq("offer_id", offerId)
          .maybeSingle(),
      ]);
      if (offerResult.error) throw offerResult.error;
      if (documentResult.error) throw documentResult.error;
      return { offer: offerResult.data, document: documentResult.data };
    },
  });

  if (!isAdmin) return <AccessDenied />;
  if (query.isLoading)
    return <LoadingState label="Teklif dosyası açılıyor..." />;
  if (query.error) {
    return (
      <div className="surface-panel p-6 text-sm text-destructive">
        {errorMessage(query.error)}
      </div>
    );
  }
  const offer = query.data?.offer;
  const document = query.data?.document;
  if (!offer) {
    return (
      <div className="surface-panel p-6 text-sm text-muted-foreground">
        Teklif bulunamadı.
      </div>
    );
  }

  const html = document?.html.replace("</body>", `${FRAME_SCRIPT}</body>`);

  async function openSend() {
    if (!offer) return;
    setPreparing(true);
    try {
      const url = await ensureOfferShareLink(offer.id);
      const customer = offer as unknown as {
        customers: { name: string; contact: string | null } | null;
        module_config: {
          recipient?: { name?: string; phone?: string; email?: string };
        } | null;
      };
      const recipient = customer.module_config?.recipient ?? {};
      const contact = extractContact(customer.customers?.contact);
      const name = customer.customers?.name ?? recipient.name ?? "";
      setSendTarget({
        kind: "offer",
        offerId: offer.id,
        title: offer.offer_no,
        phone: recipient.phone || contact.phone,
        email: recipient.email || contact.email,
        subject: `${offer.offer_no} · ${offer.title} — NES Enerji teklifi`,
        message: `Merhaba${name ? ` ${name}` : ""},\n\n${offer.title} için hazırladığımız teklifi (${offer.offer_no}) aşağıdaki bağlantıdan inceleyebilirsiniz. Sorularınız için bize her zaman yazabilirsiniz.`,
        link: { url, label: "Teklifi görüntüle" },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setPreparing(false);
    }
  }

  return (
    <>
      <PageHeader
        title={`${offer.offer_no} · Teklif dosyası`}
        description={
          document
            ? `${offer.title} · son kayıt ${formatProjectDateTime(document.updated_at)}`
            : offer.title
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" className="h-11">
              <Link to="/offers">
                <ArrowLeft className="mr-2 h-4 w-4" /> Teklifler
              </Link>
            </Button>
            {document ? (
              <>
                <Button
                  className="h-11 font-bold"
                  onClick={() =>
                    frameRef.current?.contentWindow?.postMessage(
                      "nes-print",
                      "*",
                    )
                  }
                >
                  <Printer className="mr-2 h-4 w-4" /> PDF / Yazdır
                </Button>
              </>
            ) : null}
            {document ? (
              <Button
                variant="outline"
                className="h-11"
                disabled={preparing}
                onClick={() => void openSend()}
              >
                {preparing ? (
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                WhatsApp / E-posta
              </Button>
            ) : null}
            <Button asChild variant="outline" className="h-11">
              <Link to="/energy-offer" search={{ offerId: offer.id }}>
                <Pencil className="mr-2 h-4 w-4" /> Hazırlayıcıda düzenle
              </Link>
            </Button>
          </div>
        }
      />
      <SendDialog target={sendTarget} onClose={() => setSendTarget(null)} />
      {html ? (
        <iframe
          ref={frameRef}
          title={`${offer.offer_no} — ${offer.title}`}
          srcDoc={html}
          sandbox="allow-scripts allow-modals allow-popups"
          className="h-[calc(100vh-14rem)] min-h-[520px] w-full rounded-2xl border border-border bg-[#e6eaeb]"
        />
      ) : (
        <div className="surface-panel p-6 text-sm text-muted-foreground">
          Bu teklifin dosyası henüz saklanmadı. Dosya, teklif hazırlayıcıda bir
          kez &quot;Kaydet&quot;e basıldığında oluşur ve buradan açılır.
        </div>
      )}
    </>
  );
}

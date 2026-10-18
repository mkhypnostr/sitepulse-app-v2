// WhatsApp / e-posta ile gönderim yardımcıları. WhatsApp'ta mesaj hazır
// açılır, son "Gönder"e kullanıcı basar; e-posta uygulamadan (Resend) gider.
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/** Türkiye numarasını WhatsApp biçimine çevirir: 0532… → 90532…. */
export function normalizeTrPhone(raw: string | null | undefined) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("90") && digits.length === 12) return digits;
  if (digits.startsWith("0") && digits.length === 11) return `9${digits}`;
  if (digits.length === 10 && digits.startsWith("5")) return `90${digits}`;
  return digits;
}

export function whatsappUrl(phone: string, text: string) {
  const p = normalizeTrPhone(phone);
  const q = encodeURIComponent(text);
  return p ? `https://wa.me/${p}?text=${q}` : `https://wa.me/?text=${q}`;
}

/** Serbest metinden (ör. müşteri "iletişim" alanı) telefon ve e-posta çıkar. */
export function extractContact(text: string | null | undefined) {
  const t = String(text ?? "");
  const email =
    t.match(/[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}/)?.[0] ?? "";
  const phone =
    t.match(/(?:\+?90[\s-]?)?0?5\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/)?.[0] ??
    t.match(/(?:\+?90[\s-]?)?0?\d{3}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/)?.[0] ??
    "";
  return { email, phone };
}

export async function blobToBase64(blob: Blob) {
  const buffer = await blob.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export type EmailPayload = {
  kind: "offer" | "survey";
  offerId?: string;
  to: string[];
  cc?: string[];
  subject: string;
  message: string;
  link?: { url: string; label: string } | null;
  attachment?: { filename: string; blob: Blob } | null;
};

export async function sendEmail(payload: EmailPayload) {
  const { data, error } = await supabase.functions.invoke(
    "send-document-email",
    {
      body: {
        kind: payload.kind,
        offer_id: payload.offerId,
        to: payload.to,
        cc: payload.cc ?? [],
        subject: payload.subject,
        message: payload.message,
        link: payload.link ?? null,
        attachment: payload.attachment
          ? {
              filename: payload.attachment.filename,
              type: payload.attachment.blob.type || "application/pdf",
              content_base64: await blobToBase64(payload.attachment.blob),
            }
          : null,
      },
    },
  );
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const body = (await error.context.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new Error(body.error ?? "E-posta gönderilemedi.");
    }
    throw error;
  }
  return data;
}

/** Tabletin paylaşım menüsü (WhatsApp, Gmail, Drive…) ile dosya paylaşır. */
export async function shareFile(file: File, text: string) {
  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean;
  };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    await nav.share({ files: [file], text, title: file.name });
    return true;
  }
  return false;
}

/** Teklifin geçerli müşteri linki; yoksa saklı teklif dosyasından oluşturur. */
export async function ensureOfferShareLink(offerId: string) {
  const { data: links, error } = await supabase
    .from("offer_share_links")
    .select("token")
    .eq("offer_id", offerId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  if (links?.[0]?.token)
    return `${window.location.origin}/teklif/${links[0].token}`;
  const { data: doc, error: docError } = await supabase
    .from("offer_documents")
    .select("html")
    .eq("offer_id", offerId)
    .maybeSingle();
  if (docError) throw docError;
  if (!doc?.html)
    throw new Error(
      "Bu teklifin müşteri dosyası yok. Teklif hazırlayıcıda bir kez Kaydet'e basın.",
    );
  const { data: created, error: insertError } = await supabase
    .from("offer_share_links")
    .insert({ offer_id: offerId, html: doc.html })
    .select("token")
    .single();
  if (insertError) throw insertError;
  return `${window.location.origin}/teklif/${created.token}`;
}

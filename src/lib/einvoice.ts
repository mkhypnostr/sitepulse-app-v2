// e-Belge sağlayıcısı (GİB'e gönderim yöntemi) için istemci tarafı.
// Sunucu: supabase/functions/einvoice.
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export const providerLabels = {
  manual: "Elle (GİB portalı / entegratör ekranı)",
  parasut: "Paraşüt API (otomatik)",
} as const;
export type EinvoiceProvider = keyof typeof providerLabels;

export type EinvoiceStatus = {
  provider: EinvoiceProvider;
  ready: boolean;
  message: string;
  missing?: string[];
};

async function readError(error: unknown) {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = (await error.context.json()) as { error?: string };
      if (body.error) return new Error(body.error);
    } catch {
      // gövde okunamadı
    }
  }
  return error instanceof Error ? error : new Error(String(error));
}

export async function einvoiceStatus(): Promise<EinvoiceStatus> {
  const { data, error } = await supabase.functions.invoke<EinvoiceStatus>(
    "einvoice",
    { body: { action: "status" } },
  );
  if (error) throw await readError(error);
  if (!data) throw new Error("Durum alınamadı.");
  return data;
}

/** API bağlantılı sağlayıcıyla faturayı keser (sağlayıcı hazır değilse
 * açıklayıcı hata döner). */
export async function issueThroughProvider(invoiceId: string) {
  const { data, error } = await supabase.functions.invoke("einvoice", {
    body: { action: "issue", invoiceId },
  });
  if (error) throw await readError(error);
  return data;
}

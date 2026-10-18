import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.7";

// e-Belge köprüsü: Faturalar ekranındaki "Kes" düğmesi buraya gelir.
//
// Sağlayıcı company_profile.einvoice_provider ile seçilir:
//   manual  → GİB portalı / entegratör ekranında elle kesilir (bu fonksiyon
//             yalnız durumu söyler).
//   parasut → Paraşüt API V4 (https://apidocs.parasut.com). Anahtarlar
//             Supabase secret'larında: PARASUT_CLIENT_ID, PARASUT_CLIENT_SECRET,
//             PARASUT_USERNAME, PARASUT_PASSWORD, PARASUT_COMPANY_ID.
//
// Paraşüt akışı (API dokümanından; son aşamada etkinleşecek):
//   1. POST /oauth/token (grant_type=password) → access_token (2 saat)
//   2. GET  /{firma}/contacts?filter[tax_number]=VKN → yoksa POST contacts
//   3. POST /{firma}/sales_invoices (details: satırlar, KDV, indirim)
//   4. GET  /{firma}/e_invoice_inboxes?filter[vkn]=VKN
//        gelen kutusu var → POST /{firma}/e_invoices, yoksa POST /{firma}/e_archives
//   5. GET  /{firma}/trackable_jobs/{id} (pending/running/done/error, 15 dk)
//   6. GET  /{firma}/sales_invoices/{id}?include=active_e_document → numara, ETTN
//   7. GET  /{firma}/e_invoices|e_archives/{id}/pdf (204 iken bekle) → PDF'i
//      finance-documents'a indir; invoices: kesildi + gib_invoice_no + pdf_path
// Hız sınırı: 10 saniyede 10 istek.
//
// Yetki: giriş yapan kullanıcının oturumuyla çalışır; yalnız can_manage_finance.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const PARASUT_SECRETS = [
  "PARASUT_CLIENT_ID",
  "PARASUT_CLIENT_SECRET",
  "PARASUT_USERNAME",
  "PARASUT_PASSWORD",
  "PARASUT_COMPANY_ID",
] as const;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function missingParasutSecrets() {
  return PARASUT_SECRETS.filter((k) => !Deno.env.get(k));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Yalnız POST." }, 405);

  const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: { Authorization: req.headers.get("Authorization") ?? "" },
    },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await db.auth.getUser();
  if (userError || !userData.user)
    return json({ error: "Oturum gerekli." }, 401);
  const { data: allowed, error: roleError } = await db.rpc(
    "can_manage_finance",
    {
      target_user_id: userData.user.id,
    },
  );
  if (roleError || !allowed)
    return json({ error: "Bu işlem için finans yetkisi gerekli." }, 403);

  let body: { action?: string; invoiceId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Geçersiz istek." }, 400);
  }

  const { data: company, error: companyError } = await db
    .from("company_profile")
    .select("einvoice_provider")
    .eq("id", 1)
    .maybeSingle();
  if (companyError) return json({ error: "Firma ayarları okunamadı." }, 500);
  const provider = company?.einvoice_provider ?? "manual";

  if (body.action === "status") {
    if (provider === "manual") {
      return json({
        provider,
        ready: true,
        message:
          "Elle: faturayı GİB portalında veya entegratör ekranında kesip GİB numarasını uygulamaya girersiniz.",
      });
    }
    const missing = missingParasutSecrets();
    return json({
      provider,
      ready: false,
      missing,
      message: missing.length
        ? `Paraşüt API anahtarları eksik (${missing.join(", ")}). Paraşüt'ten CLIENT_ID/SECRET gelince Supabase → Edge Functions → Secrets bölümüne eklenecek.`
        : "Paraşüt anahtarları tanımlı. Gönderim kodu son aşamada (ilk deneme faturasıyla birlikte) etkinleştirilecek; o zamana kadar faturalar elle kesilir.",
    });
  }

  if (body.action === "issue") {
    if (!body.invoiceId) return json({ error: "Fatura seçilmedi." }, 400);
    if (provider === "manual") {
      return json(
        {
          code: "manual",
          error:
            "Yöntem 'Elle': faturayı GİB portalında kesip numarasını girin.",
        },
        400,
      );
    }
    const missing = missingParasutSecrets();
    if (missing.length) {
      return json(
        {
          code: "not_configured",
          error: `Paraşüt API anahtarları eksik: ${missing.join(", ")}.`,
          missing,
        },
        503,
      );
    }
    return json(
      {
        code: "not_enabled",
        error:
          "Paraşüt gönderimi henüz etkin değil (son aşama). Şimdilik faturayı elle kesip GİB numarasını girin.",
      },
      501,
    );
  }

  return json({ error: "Bilinmeyen işlem." }, 400);
});

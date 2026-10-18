import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";
import { createClient } from "npm:@supabase/supabase-js@2.110.7";

// Keşif notlarını (serbest yazı / dikte) malzeme ve iş kalemlerine çevirir;
// kalemleri Fiyat Kataloğu ile eşleştirir. Kayıt yazmaz, yalnız öneri döner;
// kullanıcı keşif ekranında kontrol eder.
// Yetki: yönetici + teknik ofis. Katalog yalnız yöneticiye açıksa teknik
// ofiste eşleştirme yapılmaz, kalemler serbest gelir.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = "claude-opus-5-5";

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

const workTypeLabels: Record<string, string> = {
  ges: "GES",
  sarj: "şarj istasyonu",
  taahhut: "elektrik taahhüt",
  siva_alti: "sıva altı tesisat",
  pano: "pano",
  aydinlatma: "aydınlatma",
  og_trafo: "OG / trafo",
  olcum: "ölçüm / periyodik kontrol",
  diger: "diğer",
};

const TOOL: Anthropic.Tool = {
  name: "kalemleri_kaydet",
  description:
    "Keşif notlarından çıkarılan malzeme ve iş kalemlerini kaydeder. Her zaman bu aracı bir kez çağır.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["items"],
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["description", "quantity", "unit"],
          properties: {
            description: {
              type: "string",
              description:
                "Kısa, teklif satırına uygun Türkçe ad (ör. '5x6 mm² NYY kablo', '22 kW AC şarj istasyonu montajı').",
            },
            quantity: {
              type: "number",
              description: "Miktar. Belirtilmemişse 1.",
            },
            unit: {
              type: "string",
              description:
                "Birim: adet, m, m², kg, set, boy, takım, saat, gün, kWp, iş.",
            },
            catalog_id: {
              type: "string",
              description:
                "Katalogda aynı ürün/iş varsa onun kimliği. Emin değilsen gönderme; tahmin etme.",
            },
            note: {
              type: "string",
              description:
                "Yer, kesit, güzergâh gibi ek bilgi. Yoksa gönderme.",
            },
          },
        },
      },
    },
  },
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Yalnız POST." }, 405);

  const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: { Authorization: req.headers.get("Authorization") ?? "" },
    },
    auth: { persistSession: false },
  });
  const { data: auth, error: authError } = await db.auth.getUser();
  if (authError || !auth.user) return json({ error: "Oturum gerekli." }, 401);
  const { data: allowed } = await db.rpc("can_manage_projects", {
    target_user_id: auth.user.id,
  });
  if (!allowed)
    return json(
      { error: "Bu işlem için yönetici veya teknik ofis yetkisi gerekli." },
      403,
    );
  if (!ANTHROPIC_API_KEY)
    return json({ error: "Anthropic API anahtarı tanımlı değil." }, 503);

  let body: { notes?: string; work_type?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Geçersiz istek." }, 400);
  }
  const notes = String(body.notes ?? "")
    .trim()
    .slice(0, 12000);
  if (!notes) return json({ error: "Not boş." }, 400);
  const workType = workTypeLabels[String(body.work_type)] ?? "diğer";

  // Katalog (RLS: yalnız yöneticide döner).
  const { data: catalogRows } = await db
    .from("offer_catalog_items")
    .select("id, code, name, brand, model, unit, module")
    .eq("is_active", true)
    .order("sort_order")
    .limit(600);
  const catalog = catalogRows ?? [];
  const catalogText = catalog
    .map(
      (c) =>
        `${c.id} | ${c.code} | ${c.name}${c.brand ? ` · ${c.brand}` : ""}${c.model ? ` · ${c.model}` : ""} | ${c.unit}`,
    )
    .join("\n");

  const system = `Sen NES Enerji'nin (Muğla, elektrik taahhüt / GES / şarj / OG) keşif asistanısın. Mühendisin sahada yazdığı ya da dikte ettiği serbest keşif notunu teklif kalemlerine çevirirsin.

Kurallar:
- Yalnız notta geçen malzeme ve işleri çıkar; olmayan kalem uydurma. Ölçü/miktar yazılmışsa aynen kullan (35 m, 4 adet). Yazılmamışsa 1.
- Aynı malzeme birden çok yerde geçiyorsa miktarları topla, notta yerini belirt.
- İşçilik, montaj, test/devreye alma notta açıkça geçiyorsa ayrı kalem yap.
- Katalogla eşleştirme: yalnız ürün tipi ve özellik (kesit, akım, güç) uyuşuyorsa catalog_id ver. Benzer ama farklı özellikteyse verme.
- Açıklamalar kısa ve teklif diline uygun olsun; birimler: adet, m, m², kg, set, boy, takım, saat, gün, kWp, iş.
- Sonucu kalemleri_kaydet aracıyla ver.`;

  const user = `İş türü: ${workType}

KEŞİF NOTU:
${notes}

${catalog.length ? `KATALOG (id | kod | ad | birim):\n${catalogText}` : "Katalog yok: catalog_id gönderme."}`;

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system,
      tools: [TOOL],
      messages: [{ role: "user", content: user }],
    });
    const use = response.content.find(
      (b): b is Anthropic.ToolUseBlock =>
        b.type === "tool_use" && b.name === TOOL.name,
    );
    const raw = (use?.input as { items?: unknown[] } | undefined)?.items ?? [];
    const ids = new Set(catalog.map((c) => c.id));
    const items = raw
      .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
      .map((x) => ({
        description: String(x.description ?? "")
          .trim()
          .slice(0, 300),
        quantity: Number(x.quantity) > 0 ? Number(x.quantity) : 1,
        unit:
          String(x.unit ?? "adet")
            .trim()
            .slice(0, 20) || "adet",
        catalog_item_id:
          typeof x.catalog_id === "string" && ids.has(x.catalog_id)
            ? x.catalog_id
            : null,
        note:
          typeof x.note === "string" && x.note.trim()
            ? x.note.trim().slice(0, 300)
            : null,
      }))
      .filter((x) => x.description);
    return json({ items });
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      console.error("Anthropic hatası", error.status, error.message);
      return json({ error: `Asistan yanıt veremedi (${error.status}).` }, 502);
    }
    console.error(error);
    return json({ error: "Beklenmedik hata." }, 500);
  }
});

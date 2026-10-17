import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";
import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.110.7";

// NES uygulama içi asistan. Kullanıcının yazdığı (ya da sesle söylediği)
// isteği Claude'a iletir; Claude aşağıdaki araçlarla kayıtları arar ve iş
// açar. Her şey giriş yapan kullanıcının oturumuyla (RLS ve RPC yetki
// kontrolleri aynen geçerli) çalışır.
//
// Kayıt açan / değiştiren araçlar hemen çalışmaz: sunucu döngüyü durdurur,
// arayüz kullanıcıya bir onay kartı gösterir; kullanıcı "Onayla" derse istek
// { confirm: { approved: true } } ile tekrar gelir ve araç o zaman çalışır.
// Konuşma geçmişi istemcide tutulur ve her istekte aynen geri gönderilir
// (düşünme blokları dahil, değiştirilmeden).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = "claude-opus-5-5";
const APP_ORIGIN = "https://app.nesgrup.com";
const MAX_LOOPS = 8;

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

type Ctx = {
  db: SupabaseClient;
  userId: string;
  userName: string;
  role: string;
};
type ToolOutput = { result: unknown; link?: { label: string; href: string } };

const str = (description: string) => ({ type: "string", description });
const nullableStr = (description: string) => ({
  type: ["string", "null"],
  description: `${description} Bilinmiyorsa null.`,
});
const nullableNum = (description: string) => ({
  type: ["number", "null"],
  description: `${description} Bilinmiyorsa null.`,
});
function schema(properties: Record<string, unknown>) {
  return {
    type: "object" as const,
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

// ---------------------------------------------------------------- araçlar
type ToolDef = {
  tool: Anthropic.Beta.BetaTool;
  write: boolean;
  /** Onay kartında görünen kısa açıklama. */
  summary?: (input: Record<string, unknown>, ctx: Ctx) => Promise<string>;
  run: (input: Record<string, unknown>, ctx: Ctx) => Promise<ToolOutput>;
};

async function personName(ctx: Ctx, id: unknown) {
  if (typeof id !== "string" || !id) return "atanmadı";
  const { data } = await ctx.db
    .from("profiles")
    .select("full_name")
    .eq("id", id)
    .maybeSingle();
  return data?.full_name ?? "bilinmeyen kişi";
}
async function rowName(ctx: Ctx, table: string, column: string, id: unknown) {
  if (typeof id !== "string" || !id) return null;
  const { data } = await ctx.db
    .from(table)
    .select(column)
    .eq("id", id)
    .maybeSingle();
  return (data as Record<string, string> | null)?.[column] ?? null;
}
const dateTr = (v: unknown) =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)
    ? v.slice(0, 10).split("-").reverse().join(".")
    : "tarih yok";

function check<T>(result: { data: T; error: { message: string } | null }) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

const TOOLS: Record<string, ToolDef> = {
  kisileri_listele: {
    write: false,
    tool: {
      name: "kisileri_listele",
      description:
        "Uygulamadaki kişileri (yönetici, teknik ofis, taşeron, müşteri) ve kimliklerini listeler. Görev atamadan önce kişinin kimliğini bulmak için kullan.",
      input_schema: schema({}),
      strict: true,
    },
    run: async (_input, ctx) => ({
      result: check(await ctx.db.rpc("list_task_assignees")),
    }),
  },
  musteri_ara: {
    write: false,
    tool: {
      name: "musteri_ara",
      description: "Müşteri adına göre arar; kimlik ve ad döner.",
      input_schema: schema({ sorgu: str("Müşteri adının bir kısmı.") }),
      strict: true,
    },
    run: async (input, ctx) => ({
      result: check(
        await ctx.db
          .from("customers")
          .select("id, name")
          .ilike("name", `%${String(input.sorgu)}%`)
          .limit(10),
      ),
    }),
  },
  proje_ara: {
    write: false,
    tool: {
      name: "proje_ara",
      description: "Proje adı ya da numarasına (NES-2026-0003 gibi) göre arar.",
      input_schema: schema({
        sorgu: str("Proje adının ya da numarasının bir kısmı."),
      }),
      strict: true,
    },
    run: async (input, ctx) => {
      const q = String(input.sorgu);
      return {
        result: check(
          await ctx.db
            .from("projects")
            .select(
              "id, project_no, name, status, target_end_date, customer_id",
            )
            .or(`name.ilike.%${q}%,project_no.ilike.%${q}%`)
            .limit(10),
        ),
      };
    },
  },
  teklif_ara: {
    write: false,
    tool: {
      name: "teklif_ara",
      description:
        "Teklif başlığı ya da numarasına (NES-TKF-2610-0003 gibi) göre arar; durum ve tutar bilgisi döner.",
      input_schema: schema({
        sorgu: str("Teklif başlığının ya da numarasının bir kısmı."),
      }),
      strict: true,
    },
    run: async (input, ctx) => {
      const q = String(input.sorgu);
      return {
        result: check(
          await ctx.db
            .from("offers")
            .select(
              "id, offer_no, title, status, total_amount, currency, customer_id",
            )
            .or(`title.ilike.%${q}%,offer_no.ilike.%${q}%`)
            .order("created_at", { ascending: false })
            .limit(10),
        ),
      };
    },
  },
  gorevleri_listele: {
    write: false,
    tool: {
      name: "gorevleri_listele",
      description:
        "Açık görevleri listeler: bağımsız görevler, kişiye atanmış proje adımları ve iş emirleri. 'geciken' yalnız tarihi geçmişleri, 'bugun' bugün planlananları, 'acik' tümünü verir.",
      input_schema: schema({
        kapsam: {
          type: "string",
          enum: ["geciken", "bugun", "acik"],
          description: "Hangi görevler.",
        },
      }),
      strict: true,
    },
    run: async (input, ctx) => {
      const today = new Date().toISOString().slice(0, 10);
      const scope = String(input.kapsam);
      const filterDate = <Q extends { lt: Function; eq: Function }>(
        q: Q,
        col: string,
      ) =>
        scope === "geciken"
          ? q.lt(col, today)
          : scope === "bugun"
            ? q.eq(col, today)
            : q;
      const ops = check(
        await filterDate(
          ctx.db
            .from("operational_tasks")
            .select("id, title, status, planned_date, assigned_to")
            .not("status", "in", "(completed,not_applicable)"),
          "planned_date",
        ).limit(30),
      );
      const steps = check(
        await filterDate(
          ctx.db
            .from("project_tasks")
            .select(
              "id, task_name, status, planned_date, responsible_id, project_id",
            )
            .not("status", "in", "(completed,not_applicable)")
            .not("responsible_id", "is", null),
          "planned_date",
        ).limit(30),
      );
      const ordersQuery = ctx.db
        .from("work_orders")
        .select("id, work_order_no, title, status, scheduled_at")
        .not("status", "in", "(completed,cancelled)")
        .limit(30);
      const orders = check(
        await (scope === "geciken"
          ? ordersQuery.lt("scheduled_at", new Date().toISOString())
          : scope === "bugun"
            ? ordersQuery
                .gte("scheduled_at", `${today}T00:00:00`)
                .lte("scheduled_at", `${today}T23:59:59`)
            : ordersQuery),
      );
      return {
        result: { gorevler: ops, proje_adimlari: steps, is_emirleri: orders },
      };
    },
  },
  ges_teklifi_hazirla: {
    // Kayıt açmaz: teklif hazırlayıcıyı bu bilgilerle doldurup açan bir
    // bağlantı üretir. Kullanıcı kontrol edip kendisi kaydeder.
    write: false,
    tool: {
      name: "ges_teklifi_hazirla",
      description:
        "GES (güneş enerjisi) teklifi için teklif hazırlayıcıyı verilen güç, sistem tipi ve müşteriyle dolduran bir bağlantı hazırlar. Kayıt açmaz; kullanıcı bağlantıyı açıp kontrol eder ve kaydeder. Kayıtlı müşteri varsa önce musteri_ara ile kimliğini bul.",
      input_schema: schema({
        kwp: { type: "number", description: "Hedef DC güç, kWp (ör. 10)." },
        sistem: {
          type: "string",
          enum: ["ongrid", "hibrit"],
          description: "On-grid ya da bataryalı hibrit.",
        },
        batarya_kwh: nullableNum("Hibrit sistemde hedef batarya, kWh."),
        musteri_id: nullableStr("Kayıtlı müşterinin kimliği."),
        aday_adi: nullableStr("Kayıtlı değilse müşteri/firma adı."),
        konum: nullableStr("Proje yeri, ör. 'Akyaka / Muğla'."),
        baslik: nullableStr("Teklif başlığı."),
      }),
      strict: true,
    },
    run: async (input) => {
      const params = new URLSearchParams();
      params.set("kwp", String(input.kwp));
      params.set("sistem", String(input.sistem));
      if (input.batarya_kwh) params.set("batarya", String(input.batarya_kwh));
      if (input.musteri_id) params.set("musteri", String(input.musteri_id));
      if (input.aday_adi) params.set("aday", String(input.aday_adi));
      if (input.konum) params.set("konum", String(input.konum));
      if (input.baslik) params.set("baslik", String(input.baslik));
      const href = `/energy-offer?${params.toString()}`;
      return {
        result: { hazir: true, baglanti: `${APP_ORIGIN}${href}` },
        link: { label: "Teklif hazırlayıcıyı aç", href },
      };
    },
  },
  gorev_olustur: {
    write: true,
    tool: {
      name: "gorev_olustur",
      description:
        "Yeni bağımsız görev açar; isteğe bağlı olarak bir kişiye atar, projeye ve müşteriye bağlar. Kişi/proje/müşteri kimliklerini önce arama araçlarıyla bul.",
      input_schema: schema({
        baslik: str("Görevin kısa başlığı."),
        aciklama: nullableStr("Ayrıntı."),
        atanan_id: nullableStr("Görevin atanacağı kişinin kimliği."),
        tarih: nullableStr("Planlanan gün, YYYY-AA-GG."),
        proje_id: nullableStr("Bağlı proje kimliği."),
        musteri_id: nullableStr("Bağlı müşteri kimliği."),
      }),
      strict: true,
    },
    summary: async (i, ctx) =>
      `Görev aç: "${i.baslik}" · Atanan: ${await personName(ctx, i.atanan_id)} · ${dateTr(i.tarih)}`,
    run: async (i, ctx) => {
      const id = check(
        await ctx.db.rpc("create_operational_task", {
          task_title: String(i.baslik),
          task_description: (i.aciklama as string) ?? null,
          target_project_id: (i.proje_id as string) ?? null,
          target_customer_id: (i.musteri_id as string) ?? null,
          assigned_user_id: (i.atanan_id as string) ?? null,
          planned_on: (i.tarih as string) ?? null,
        }),
      );
      return {
        result: { acildi: true, gorev_id: id },
        link: { label: "Görevlerde aç", href: "/tasks" },
      };
    },
  },
  gorev_ata: {
    write: true,
    tool: {
      name: "gorev_ata",
      description:
        "Var olan bağımsız görevi bir kişiye atar ve isteğe bağlı tarihini değiştirir. Görev kimliğini gorevleri_listele ile bul.",
      input_schema: schema({
        gorev_id: str("Görevin kimliği."),
        atanan_id: str("Atanacak kişinin kimliği."),
        tarih: nullableStr("Yeni planlanan gün, YYYY-AA-GG."),
      }),
      strict: true,
    },
    summary: async (i, ctx) =>
      `Görevi ata: "${(await rowName(ctx, "operational_tasks", "title", i.gorev_id)) ?? "görev"}" → ${await personName(ctx, i.atanan_id)}${i.tarih ? ` · ${dateTr(i.tarih)}` : ""}`,
    run: async (i, ctx) => {
      const task = check(
        await ctx.db
          .from("operational_tasks")
          .select(
            "title, description, project_id, customer_id, planned_date, status",
          )
          .eq("id", String(i.gorev_id))
          .single(),
      ) as Record<string, string | null>;
      check(
        await ctx.db.rpc("update_operational_task", {
          target_task_id: String(i.gorev_id),
          task_title: task.title ?? "",
          task_description: task.description ?? null,
          target_project_id: task.project_id ?? null,
          target_customer_id: task.customer_id ?? null,
          assigned_user_id: String(i.atanan_id),
          planned_on: (i.tarih as string) ?? task.planned_date ?? null,
          new_status: task.status ?? "not_started",
        }),
      );
      return {
        result: { atandi: true },
        link: { label: "Görevlerde aç", href: "/tasks" },
      };
    },
  },
  is_emri_olustur: {
    write: true,
    tool: {
      name: "is_emri_olustur",
      description:
        "Saha iş emri açar. Taşeron verilmezse taslak olarak açılır (taşeronsuz iş emri aktif olamaz). Müşteri kimliği zorunlu; musteri_ara ile bul.",
      input_schema: schema({
        baslik: str("İş emrinin başlığı."),
        musteri_id: str("Müşteri kimliği."),
        aciklama: nullableStr("Ayrıntı."),
        konum: nullableStr("Adres."),
        tarih_saat: nullableStr(
          "Planlanan başlangıç, YYYY-AA-GGTSS:DD (Türkiye saati).",
        ),
        taseron_id: nullableStr("Atanacak taşeronun kimliği."),
        proje_id: nullableStr("Bağlı proje kimliği."),
      }),
      strict: true,
    },
    summary: async (i, ctx) =>
      `İş emri aç: "${i.baslik}" · Müşteri: ${(await rowName(ctx, "customers", "name", i.musteri_id)) ?? "?"} · Taşeron: ${i.taseron_id ? await personName(ctx, i.taseron_id) : "yok (taslak)"}`,
    run: async (i, ctx) => {
      // İş emri saatleri yarım saatlik dilime oturmalı (veritabanı kuralı).
      let scheduled: string | undefined;
      if (typeof i.tarih_saat === "string" && i.tarih_saat) {
        const d = new Date(`${i.tarih_saat.slice(0, 16)}:00+03:00`);
        d.setUTCMinutes(Math.round(d.getUTCMinutes() / 30) * 30, 0, 0);
        scheduled = d.toISOString();
      }
      const id = check(
        await ctx.db.rpc("create_work_order", {
          target_customer_id: String(i.musteri_id),
          order_title: String(i.baslik),
          order_description: (i.aciklama as string) ?? null,
          order_location: (i.konum as string) ?? null,
          order_scheduled_at: scheduled ?? null,
          order_customer_labor_amount: 0,
          order_customer_material_amount: 0,
          order_contractor_labor_amount: 0,
          order_estimated_material_cost: 0,
          visible_to_customer: false,
          assigned_contractor_id: (i.taseron_id as string) ?? null,
          order_location_url: null,
          order_work_scope_type: "labor_only",
          order_default_material_source: "none",
          target_project_id: (i.proje_id as string) ?? null,
          order_planned_end_at: null,
          save_as_draft: !i.taseron_id,
        }),
      );
      return {
        result: { acildi: true, is_emri_id: id },
        link:
          typeof id === "string"
            ? { label: "İş emrini aç", href: `/jobs/${id}` }
            : undefined,
      };
    },
  },
  proje_olustur: {
    write: true,
    tool: {
      name: "proje_olustur",
      description:
        "Yeni proje açar; seçilen tipe göre proje adımları otomatik oluşur. Tipler: electric_permit (Elektrik Ruhsat), site_project (Şantiye), connection_line (Bağlantı Hattı).",
      input_schema: schema({
        ad: str("Proje adı."),
        tip: {
          type: "string",
          enum: ["electric_permit", "site_project", "connection_line"],
          description: "Proje tipi.",
        },
        musteri_id: nullableStr("Müşteri kimliği."),
        baslangic: nullableStr("Başlangıç günü, YYYY-AA-GG."),
        hedef_bitis: nullableStr("Hedef bitiş günü, YYYY-AA-GG."),
        il: nullableStr("İl."),
        ilce: nullableStr("İlçe."),
      }),
      strict: true,
    },
    summary: async (i, ctx) =>
      `Proje aç: "${i.ad}" · ${({ electric_permit: "Elektrik Ruhsat", site_project: "Şantiye", connection_line: "Bağlantı Hattı" } as Record<string, string>)[String(i.tip)]} · Müşteri: ${(await rowName(ctx, "customers", "name", i.musteri_id)) ?? "yok"} · Hedef: ${dateTr(i.hedef_bitis)}`,
    run: async (i, ctx) => {
      const id = check(
        await ctx.db.rpc("create_project_with_workflow", {
          target_customer_id: (i.musteri_id as string) ?? null,
          project_name: String(i.ad),
          selected_processes: [String(i.tip)],
          project_province: (i.il as string) ?? null,
          project_district: (i.ilce as string) ?? null,
          target_manager_id: ctx.role === "admin" ? ctx.userId : null,
          project_start_date: (i.baslangic as string) ?? null,
          project_target_end_date: (i.hedef_bitis as string) ?? null,
          project_state: "active",
        }),
      );
      return {
        result: { acildi: true, proje_id: id },
        link:
          typeof id === "string"
            ? { label: "Projeyi aç", href: `/projects/${id}` }
            : undefined,
      };
    },
  },
  satis_firsati_olustur: {
    write: true,
    tool: {
      name: "satis_firsati_olustur",
      description: "Satış Takibi'ne yeni fırsat (aday müşteri talebi) ekler.",
      input_schema: schema({
        baslik: str("Fırsatın kısa adı."),
        firma: nullableStr("Firma ya da kişi adı."),
        yetkili: nullableStr("Görüşülen kişi."),
        telefon: nullableStr("Telefon."),
        hizmet: {
          type: "string",
          enum: ["ges", "sarj", "taahhut", "bakim", "olcum", "diger"],
          description: "Hizmet türü.",
        },
        tahmini_tutar: nullableNum("Tahmini tutar."),
        para_birimi: {
          type: "string",
          enum: ["TRY", "USD", "EUR"],
          description: "Tutarın para birimi.",
        },
        sonraki_adim: nullableStr(
          "Yapılacak sonraki iş, ör. 'Keşif randevusu ayarla'.",
        ),
        sonraki_adim_tarihi: nullableStr("Sonraki adım günü, YYYY-AA-GG."),
        konum: nullableStr("Yer."),
      }),
      strict: true,
    },
    summary: async (i) =>
      `Satış fırsatı ekle: "${i.baslik}"${i.firma ? ` · ${i.firma}` : ""}${i.sonraki_adim ? ` · Sonraki: ${i.sonraki_adim} (${dateTr(i.sonraki_adim_tarihi)})` : ""}`,
    run: async (i, ctx) => {
      const row = check(
        await ctx.db
          .from("sales_leads")
          .insert({
            title: String(i.baslik),
            company_name: (i.firma as string) ?? null,
            contact_name: (i.yetkili as string) ?? null,
            phone: (i.telefon as string) ?? null,
            service: String(i.hizmet),
            source: "diger",
            stage: "yeni",
            estimated_value: (i.tahmini_tutar as number) ?? null,
            currency: String(i.para_birimi),
            next_action: (i.sonraki_adim as string) ?? null,
            next_action_at: (i.sonraki_adim_tarihi as string) ?? null,
            location: (i.konum as string) ?? null,
            owner_id: ctx.userId,
            created_by: ctx.userId,
          })
          .select("id")
          .single(),
      ) as { id: string };
      return {
        result: { eklendi: true, firsat_id: row.id },
        link: { label: "Satış Takibi'nde aç", href: `/sales?leadId=${row.id}` },
      };
    },
  },
  teklifi_gonder: {
    write: true,
    tool: {
      name: "teklifi_gonder",
      description:
        "Kaydedilmiş bir enerji/GES teklifi için müşteriye gönderilecek giriş gerektirmeyen bir bağlantı oluşturur ve teklifi 'Müşteriye Gönderildi' yapar. E-posta göndermez; bağlantıyı kullanıcı müşteriye iletir. Teklif kimliğini teklif_ara ile bul.",
      input_schema: schema({ teklif_id: str("Teklifin kimliği.") }),
      strict: true,
    },
    summary: async (i, ctx) =>
      `Teklifi gönder: ${(await rowName(ctx, "offers", "offer_no", i.teklif_id)) ?? "teklif"} için müşteri bağlantısı oluştur ve durumu "Müşteriye Gönderildi" yap`,
    run: async (i, ctx) => {
      const offerId = String(i.teklif_id);
      const doc = check(
        await ctx.db
          .from("offer_documents")
          .select("html")
          .eq("offer_id", offerId)
          .maybeSingle(),
      ) as { html: string } | null;
      if (!doc) {
        throw new Error(
          "Bu teklifin dosyası henüz yok. Teklifi hazırlayıcıda bir kez açıp Kaydet'e basın, sonra tekrar deneyin.",
        );
      }
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const token = Array.from(bytes, (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
      check(
        await ctx.db.from("offer_share_links").insert({
          offer_id: offerId,
          token,
          html: doc.html,
          created_by: ctx.userId,
        }),
      );
      check(
        await ctx.db
          .from("offers")
          .update({ status: "sent" })
          .eq("id", offerId),
      );
      const url = `${APP_ORIGIN}/teklif/${token}`;
      return {
        result: { gonderildi: true, musteri_baglantisi: url },
        link: { label: "Müşteri bağlantısı", href: url },
      };
    },
  },
};

const ANTHROPIC_TOOLS = Object.values(TOOLS).map((t) => t.tool);

function systemPrompt(ctx: Ctx) {
  const today = new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    dateStyle: "full",
  }).format(new Date());
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
  }).format(new Date());
  return `Sen NES Enerji'nin saha operasyon uygulamasındaki asistanısın. NES Enerji Muğla'da GES (güneş enerjisi), elektrik taahhüt, ruhsat, OG/trafo ve şarj işleri yapan bir firma.

Kullanıcı: ${ctx.userName} (${ctx.role === "admin" ? "yönetici" : "teknik ofis"}). Bugün ${today} (${iso}).

Nasıl çalışırsın:
- Türkçe, kısa ve sade yaz. Kullanıcı kodlama bilmez.
- İstenen işi araçlarla yap. Kimlikleri (kişi, müşteri, proje, teklif) asla uydurma; önce arama araçlarıyla bul. Birden fazla eşleşme varsa ya da emin değilsen kısaca hangisi olduğunu sor.
- "Yarın", "cuma", "haftaya" gibi tarihleri bugüne göre YYYY-AA-GG'ye çevir.
- Kayıt açan araçları (görev, iş emri, proje, satış fırsatı, teklif gönderme) doğrudan çağır; uygulama kullanıcıya ayrıca bir onay kartı gösterir, sen ayrıca "emin misin" diye sorma.
- GES teklifinde kayıt açılmaz: ges_teklifi_hazirla ile hazırlayıcıyı dolduran bağlantıyı ver, kullanıcının kontrol edip kaydetmesini söyle.
- Kullanıcı bir işlemi reddederse yeniden deneme; ne değiştirmek istediğini sor.
- Bir araç hata verirse hatayı sade dille anlat.
- Fiyat, maliyet ve kâr bilgisini yalnız yöneticiye söyle.`;
}

// ---------------------------------------------------------------- sunucu
type Body = {
  messages?: Anthropic.Beta.BetaMessageParam[];
  confirm?: { approved: boolean };
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST kullanın." }, 405);

  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer "))
    return json({ error: "Oturum gerekli." }, 401);
  const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await db.auth.getUser(
    authorization.slice("Bearer ".length).trim(),
  );
  if (authError || !authData.user)
    return json({ error: "Geçersiz oturum." }, 401);

  const { data: role } = await db.rpc("get_my_app_role");
  if (role !== "admin" && role !== "technical_office") {
    return json(
      { error: "Asistan yalnız yönetici ve teknik ofise açık." },
      403,
    );
  }
  if (!ANTHROPIC_API_KEY) {
    return json(
      {
        error:
          "Asistan için Anthropic API anahtarı tanımlı değil (Supabase → Edge Functions → Secrets → ANTHROPIC_API_KEY).",
        code: "no_key",
      },
      503,
    );
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Geçersiz istek." }, 400);
  }
  const messages = Array.isArray(body.messages) ? [...body.messages] : [];
  if (messages.length === 0 || messages.length > 80) {
    return json({ error: "Mesaj geçmişi geçersiz." }, 400);
  }

  const { data: profile } = await db
    .from("profiles")
    .select("full_name")
    .eq("id", authData.user.id)
    .maybeSingle();
  const ctx: Ctx = {
    db,
    userId: authData.user.id,
    userName: profile?.full_name ?? "Kullanıcı",
    role,
  };
  const links: { label: string; href: string }[] = [];

  async function runTools(
    blocks: Anthropic.Beta.BetaToolUseBlock[],
    approved: boolean | null,
  ): Promise<Anthropic.Beta.BetaToolResultBlockParam[]> {
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const block of blocks) {
      const def = TOOLS[block.name];
      if (!def) {
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: "Bilinmeyen araç.",
          is_error: true,
        });
        continue;
      }
      if (def.write && approved === false) {
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: "Kullanıcı bu işlemi onaylamadı; yapılmadı.",
          is_error: true,
        });
        continue;
      }
      try {
        const out = await def.run(block.input as Record<string, unknown>, ctx);
        if (out.link) links.push(out.link);
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(out.result),
        });
      } catch (error) {
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `Hata: ${error instanceof Error ? error.message : String(error)}`,
          is_error: true,
        });
      }
    }
    return results;
  }

  const toolUses = (content: Anthropic.Beta.BetaMessageParam["content"]) =>
    (Array.isArray(content) ? content : []).filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock =>
        (b as { type: string }).type === "tool_use",
    );

  // Onay kartı cevaplanmadan yeni mesaj yazıldıysa bekleyen işlemler
  // "onaylanmadı" sayılır (API, cevapsız araç çağrısı kabul etmez).
  if (!body.confirm && messages.length >= 2) {
    const prev = messages[messages.length - 2];
    const last = messages[messages.length - 1];
    const lastHasResults =
      Array.isArray(last.content) &&
      last.content.some((b) => (b as { type: string }).type === "tool_result");
    if (prev.role === "assistant" && last.role === "user" && !lastHasResults) {
      const pendingUses = toolUses(prev.content);
      if (pendingUses.length > 0) {
        const declined = pendingUses.map(
          (u): Anthropic.Beta.BetaToolResultBlockParam => ({
            type: "tool_result",
            tool_use_id: u.id,
            content:
              "Kullanıcı bu işlemi onaylamadan yeni bir istek yazdı; yapılmadı.",
            is_error: true,
          }),
        );
        const text = typeof last.content === "string" ? last.content : "";
        messages[messages.length - 1] = {
          role: "user",
          content: [
            ...declined,
            ...(text
              ? [{ type: "text" as const, text }]
              : Array.isArray(last.content)
                ? (last.content as Anthropic.Beta.BetaContentBlockParam[])
                : []),
          ],
        };
      }
    }
  }

  // Onay cevabı: son asistan mesajındaki bekleyen araçlar şimdi çalışır.
  if (body.confirm) {
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant")
      return json({ error: "Bekleyen işlem yok." }, 400);
    const results = await runTools(
      toolUses(last.content),
      body.confirm.approved,
    );
    messages.push({ role: "user", content: results });
  }

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  try {
    for (let loop = 0; loop < MAX_LOOPS; loop++) {
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium" },
        system: [{ type: "text", text: systemPrompt(ctx) }],
        tools: ANTHROPIC_TOOLS,
        messages,
      });
      messages.push({ role: "assistant", content: response.content });

      if (response.stop_reason === "refusal") {
        return json({ messages, reply: "Bu isteğe yanıt veremiyorum.", links });
      }
      if (response.stop_reason === "pause_turn") continue;
      if (response.stop_reason !== "tool_use") {
        const reply = response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        return json({ messages, reply, links });
      }

      const uses = toolUses(response.content);
      const writes = uses.filter((u) => TOOLS[u.name]?.write);
      if (writes.length > 0) {
        // Onay bekle: kayıt açan araç kullanıcı onayı olmadan çalışmaz.
        const pending = [];
        for (const u of writes) {
          const def = TOOLS[u.name];
          pending.push({
            name: u.name,
            summary: def.summary
              ? await def.summary(u.input as Record<string, unknown>, ctx)
              : u.name,
          });
        }
        const text = response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        return json({ messages, reply: text, pending, links });
      }
      messages.push({ role: "user", content: await runTools(uses, null) });
    }
    return json({
      messages,
      reply: "İşlem çok uzun sürdü; isteği daha kısa adımlara bölün.",
      links,
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return json(
        { error: "Anthropic API anahtarı geçersiz.", code: "bad_key" },
        503,
      );
    }
    if (error instanceof Anthropic.RateLimitError) {
      return json(
        { error: "Asistan şu an yoğun; biraz sonra tekrar deneyin." },
        429,
      );
    }
    if (error instanceof Anthropic.APIError) {
      console.error("Anthropic hatası", error.status, error.message);
      return json({ error: `Asistan yanıt veremedi (${error.status}).` }, 502);
    }
    console.error(error);
    return json({ error: "Asistan beklenmedik bir hata verdi." }, 500);
  }
});

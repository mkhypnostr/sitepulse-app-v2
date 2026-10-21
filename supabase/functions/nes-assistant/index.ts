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
  /** Kullanıcının oturum başlığı; Drive araması bununla yetki denetler. */
  authHeader: string;
};
type ToolOutput = {
  result: unknown;
  link?: { label: string; href: string };
  links?: { label: string; href: string }[];
  /** Sohbette PDF düğmesi olarak çıkan belge (tarayıcı üretir). */
  document?: Record<string, unknown>;
};

const str = (description: string) => ({ type: "string", description });
// İsteğe bağlı alanlar "required" listesine girmez (bilinmiyorsa hiç
// gönderilmez). Eskiden ["string","null"] kullanılıyordu; API, birleşik
// tipli (union) parametreyi en fazla 16 ile sınırlıyor, bizde 28 vardı.
const OPTIONAL = new WeakSet<object>();
const optional = <T extends object>(field: T) => {
  OPTIONAL.add(field);
  return field;
};
const nullableStr = (description: string) =>
  optional({
    type: "string",
    description: `${description} Bilinmiyorsa bu alanı gönderme.`,
  });
const nullableNum = (description: string) =>
  optional({
    type: "number",
    description: `${description} Bilinmiyorsa bu alanı gönderme.`,
  });
function schema(properties: Record<string, object>) {
  return {
    type: "object" as const,
    properties,
    required: Object.keys(properties).filter(
      (key) => !OPTIONAL.has(properties[key]),
    ),
    additionalProperties: false,
  };
}

/** Boş metinleri "yok" say: araç kodu eksik alanı null olarak işler. */
function cleanInput(input: unknown) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(
    (input ?? {}) as Record<string, unknown>,
  )) {
    if (v === "" || v === null) continue;
    out[k] = v;
  }
  return out;
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
  drive_ara: {
    write: false,
    tool: {
      name: "drive_ara",
      description:
        "NES'in Google Drive'ında (NES Operasyon; yöneticide ayrıca NES Yönetim ve Finans) dosya arar: teklif, çizim (dwg), fatura, keşif fotoğrafı, rapor, şablon. Ad ve içerikte arar; açma bağlantısı döner. Kullanıcı 'şunu göster / aç / bul' dediğinde kullan. Faturalar finans alanındadır.",
      input_schema: schema({
        sorgu: str(
          "Aranacak kelimeler: müşteri, proje, yer veya belge adı (ör. 'Çardak Petek teklif').",
        ),
        alan: optional({
          type: "string",
          enum: ["operasyon", "finans", "hepsi"],
          description:
            "Nerede aransın. Fatura/ödeme için 'finans', emin değilsen 'hepsi'. Bilinmiyorsa gönderme (operasyon).",
        }),
        tur: optional({
          type: "string",
          enum: ["pdf", "excel", "word", "foto", "cizim", "klasor"],
          description: "Dosya türü filtresi. Bilinmiyorsa gönderme.",
        }),
      }),
    },
    run: async (input, ctx) => {
      const area =
        ctx.role === "admin" ? (input.alan ?? "operasyon") : "operasyon";
      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/nes-workspace-control`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: ctx.authHeader,
            apikey: SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: {
              name: "search_nes_drive",
              arguments: {
                query: String(input.sorgu),
                area,
                ...(input.tur ? { kind: input.tur } : {}),
                limit: 10,
              },
            },
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        result?: {
          structuredContent?: {
            success?: boolean;
            error?: string;
            files?: { name: string; type: string; url: string }[];
          };
          isError?: boolean;
        };
      };
      const content = payload.result?.structuredContent;
      if (!response.ok || payload.result?.isError || !content?.success) {
        throw new Error(content?.error ?? "Drive araması yapılamadı.");
      }
      const files = content.files ?? [];
      return {
        result: files.length
          ? files
          : "Bu aramayla dosya bulunamadı. Başka kelimelerle dene ya da alanı 'hepsi' yap.",
        links: files.slice(0, 6).map((file) => ({
          label: `${file.type}: ${file.name}`.slice(0, 80),
          href: file.url,
        })),
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
  hakedis_hazirla: {
    // Kayıt açmaz: okunan listeden iki PDF hazırlanır, sohbette indirme
    // düğmesi olarak çıkar (PDF'i tarayıcı üretir).
    write: false,
    tool: {
      name: "hakedis_hazirla",
      description:
        "Taşeronun (usta/alt yüklenici) malzeme-işçilik listesinden iki PDF hazırlar ve sohbette indirme düğmesi olarak verir: (1) müşteriye giden hakediş (her kaleme kâr oranı eklenmiş; alış, kâr ve taşeron adı yok), (2) taşeron iç kaydı (alış tutarları, toplam kontrolü, kâr özeti, asıl fotoğraf). Kayıt açmaz. Düzeltme gelirse düzeltilmiş kalemlerle yeniden çağır. Kayıtlı müşteri varsa musteri_ara ile adını doğrula.",
      input_schema: schema({
        baslik: str("İşin kısa adı, ör. 'Yakup Avşar elektrik iç tesisatı'."),
        taseron: str(
          "Listeyi getiren taşeron/usta, ör. 'Özkan Elektrik (İlhami)'.",
        ),
        musteri_id: nullableStr("Kayıtlı müşterinin kimliği."),
        musteri_adi: nullableStr("Belgede görünecek müşteri adı."),
        kar_yuzde: nullableNum(
          "Alışa eklenecek kâr yüzdesi; söylenmediyse 25.",
        ),
        kdv_yuzde: nullableNum("KDV yüzdesi; söylenmediyse 20."),
        yazili_toplam: nullableNum(
          "Listenin altında taşeronun yazdığı genel toplam (kontrol için).",
        ),
        foto_yolu: nullableStr(
          "Kullanıcının eklediği fotoğrafın yolu (mesajda '(Ek fotoğraf, yol: ...)' olarak verilir).",
        ),
        not: nullableStr("İç not."),
        kalemler: {
          type: "array",
          description:
            "Listedeki satırlar, yazıldığı sırayla. Tutar o satırın taşeron toplam tutarıdır (birim fiyat değil).",
          items: {
            type: "object",
            properties: {
              miktar: { type: "number", description: "Miktar." },
              birim: {
                type: "string",
                description: "m, adet, sorti, set, kg, gün…",
              },
              aciklama: {
                type: "string",
                description: "Kalem, ör. '3x2,5 mm² NYM kablo'.",
              },
              tutar: {
                type: "number",
                description: "Satırın taşeron tutarı (TL).",
              },
              okuma_notu: {
                type: "string",
                description:
                  "Emin olunamayan rakam varsa kısa not, ör. 'Tutar 47.330 okundu, 47.730 da olabilir'. Eminsen gönderme.",
              },
            },
            required: ["miktar", "birim", "aciklama", "tutar"],
            additionalProperties: false,
          },
        },
      }),
    },
    run: async (i, ctx) => {
      const lines =
        (i.kalemler as {
          miktar: number;
          birim: string;
          aciklama: string;
          tutar: number;
          okuma_notu?: string;
        }[]) ?? [];
      if (lines.length === 0) throw new Error("Kalem yok.");
      let customerName = (i.musteri_adi as string | undefined) ?? null;
      if (!customerName && i.musteri_id) {
        customerName = await rowName(ctx, "customers", "name", i.musteri_id);
      }
      const cost = lines.reduce((a, l) => a + Number(l.tutar || 0), 0);
      const kar = Number(i.kar_yuzde ?? 25);
      const yazili = i.yazili_toplam != null ? Number(i.yazili_toplam) : null;
      const now = new Date();
      const p = (n: number) => String(n).padStart(2, "0");
      const tr = new Date(now.getTime() + 3 * 3600_000); // Türkiye saati
      const no = `NES-HKD-${String(tr.getUTCFullYear()).slice(2)}${p(tr.getUTCMonth() + 1)}${p(tr.getUTCDate())}-${p(tr.getUTCHours())}${p(tr.getUTCMinutes())}`;
      return {
        result: {
          hazir: true,
          hakedis_no: no,
          kalem_sayisi: lines.length,
          taseron_toplami: cost,
          yazili_toplam: yazili,
          fark: yazili != null ? Math.round((cost - yazili) * 100) / 100 : null,
          musteri_tutari_kdv_haric:
            Math.round(cost * (1 + kar / 100) * 100) / 100,
          kar_yuzde: kar,
        },
        document: {
          kind: "hakedis",
          bill_no: no,
          title: String(i.baslik),
          customer_name: customerName,
          subcontractor_name: String(i.taseron),
          margin_pct: kar,
          vat_rate: Number(i.kdv_yuzde ?? 20),
          written_total: yazili,
          bill_date: tr.toISOString().slice(0, 10),
          notes: (i.not as string | undefined) ?? null,
          photo_path: (i.foto_yolu as string | undefined) ?? null,
          lines: lines.map((l, n) => ({
            id: String(n),
            quantity: Number(l.miktar) > 0 ? Number(l.miktar) : 1,
            unit: String(l.birim || "adet"),
            description: String(l.aciklama),
            cost_amount: Math.max(0, Number(l.tutar) || 0),
            note: l.okuma_notu ? String(l.okuma_notu) : null,
          })),
        },
      };
    },
  },
  teklifi_gonder: {
    write: true,
    tool: {
      name: "teklifi_gonder",
      description:
        "Kaydedilmiş bir teklifi müşteriye gönderir: giriş gerektirmeyen müşteri bağlantısını oluşturur (varsa aynısını kullanır), teklifi 'Müşteriye Gönderildi' yapar. Kanal 'whatsapp' ise hazır mesajlı WhatsApp düğmesi verir (son Gönder'e kullanıcı basar); 'eposta' ise e-postayı NES adına gönderir; 'baglanti' yalnız bağlantı verir. Teklif kimliğini teklif_ara ile bul. Telefon/e-posta verilmezse müşteri kaydındakiler kullanılır.",
      input_schema: schema({
        teklif_id: str("Teklifin kimliği."),
        kanal: {
          type: "string",
          enum: ["whatsapp", "eposta", "baglanti"],
          description: "Nasıl gönderilecek.",
        },
        telefon: nullableStr("WhatsApp numarası (kullanıcı söylediyse)."),
        eposta: nullableStr("Alıcı e-postası (kullanıcı söylediyse)."),
        mesaj: nullableStr(
          "Müşteriye kısa, kibar mesaj (NES adına). Bilinmiyorsa gönderme; standart mesaj kullanılır.",
        ),
      }),
    },
    summary: async (i, ctx) => {
      const no =
        (await rowName(ctx, "offers", "offer_no", i.teklif_id)) ?? "teklif";
      const kanal = String(i.kanal);
      return kanal === "eposta"
        ? `Teklif ${no} müşteriye E-POSTAYLA gönderilsin${i.eposta ? ` (${i.eposta})` : " (müşteri kaydındaki adrese)"}; durum "Müşteriye Gönderildi" olur`
        : kanal === "whatsapp"
          ? `Teklif ${no} için müşteri bağlantısı ve hazır WhatsApp mesajı oluşturulsun; durum "Müşteriye Gönderildi" olur (son Gönder'e siz basarsınız)`
          : `Teklif ${no} için müşteri bağlantısı oluşturulsun; durum "Müşteriye Gönderildi" olur`;
    },
    run: async (i, ctx) => {
      const offerId = String(i.teklif_id);
      const kanal = String(i.kanal ?? "baglanti");
      const offer = check(
        await ctx.db
          .from("offers")
          .select("offer_no, title, module_config, customers(name, contact)")
          .eq("id", offerId)
          .maybeSingle(),
      ) as {
        offer_no: string;
        title: string;
        module_config: {
          recipient?: { name?: string; phone?: string; email?: string };
        } | null;
        customers: { name: string; contact: string | null } | null;
      } | null;
      if (!offer) throw new Error("Teklif bulunamadı.");

      // Bağlantı: geçerli olan varsa onu kullan.
      const existing = check(
        await ctx.db
          .from("offer_share_links")
          .select("token")
          .eq("offer_id", offerId)
          .is("revoked_at", null)
          .order("created_at", { ascending: false })
          .limit(1),
      ) as { token: string }[];
      let token = existing[0]?.token;
      if (!token) {
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
        token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
          "",
        );
        check(
          await ctx.db.from("offer_share_links").insert({
            offer_id: offerId,
            token,
            html: doc.html,
            created_by: ctx.userId,
          }),
        );
      }
      const url = `${APP_ORIGIN}/teklif/${token}`;

      const contactText = offer.customers?.contact ?? "";
      const recipient = offer.module_config?.recipient ?? {};
      const name = offer.customers?.name ?? recipient.name ?? "";
      const phone =
        (i.telefon as string | undefined) ??
        recipient.phone ??
        contactText.match(
          /(?:\+?90[\s-]?)?0?5\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/,
        )?.[0] ??
        "";
      const email =
        (i.eposta as string | undefined) ??
        recipient.email ??
        contactText.match(
          /[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}/,
        )?.[0] ??
        "";
      const message =
        (i.mesaj as string | undefined) ??
        `Merhaba${name ? ` ${name}` : ""},\n\n${offer.title} için hazırladığımız teklifi (${offer.offer_no}) aşağıdaki bağlantıdan inceleyebilirsiniz. Sorularınız için bize her zaman yazabilirsiniz.`;

      const links: { label: string; href: string }[] = [
        { label: "Müşteri bağlantısı", href: url },
      ];
      let emailSent = false;
      if (kanal === "whatsapp") {
        const digits = String(phone).replace(/\D/g, "");
        const p =
          digits.startsWith("90") && digits.length === 12
            ? digits
            : digits.startsWith("0") && digits.length === 11
              ? `9${digits}`
              : digits.length === 10 && digits.startsWith("5")
                ? `90${digits}`
                : digits;
        const text = encodeURIComponent(`${message}\n\n${url}`);
        links.unshift({
          label: p
            ? `WhatsApp'ta gönder (${phone})`
            : "WhatsApp'ta gönder (kişi seçin)",
          href: p
            ? `https://wa.me/${p}?text=${text}`
            : `https://wa.me/?text=${text}`,
        });
      } else if (kanal === "eposta") {
        if (!email) {
          throw new Error(
            "Müşterinin e-posta adresi kayıtlı değil. Adresi söyleyin ya da müşteri kartına ekleyin.",
          );
        }
        const response = await fetch(
          `${SUPABASE_URL}/functions/v1/send-document-email`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: ctx.authHeader,
              apikey: SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({
              kind: "offer",
              offer_id: offerId,
              to: [email],
              subject: `${offer.offer_no} · ${offer.title} — NES Enerji teklifi`,
              message,
              link: { url, label: "Teklifi görüntüle" },
            }),
          },
        );
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        if (!response.ok)
          throw new Error(body.error ?? "E-posta gönderilemedi.");
        emailSent = true;
      }
      check(
        await ctx.db
          .from("offers")
          .update({ status: "sent" })
          .eq("id", offerId),
      );
      return {
        result: {
          gonderildi: true,
          kanal,
          eposta_gonderildi: emailSent ? email : null,
          whatsapp_hazir: kanal === "whatsapp",
          telefon: phone || null,
        },
        links,
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
- Türkçe, kısa ve sade yaz. Kullanıcı kodlama bilmez. Yanıt telefonda dar bir pencerede okunur: tablo kullanma; liste için "- " ile kısa maddeler yaz, gerekirse **kalın** kullan.
- İstenen işi araçlarla yap. Kimlikleri (kişi, müşteri, proje, teklif) asla uydurma; önce arama araçlarıyla bul. Birden fazla eşleşme varsa ya da emin değilsen kısaca hangisi olduğunu sor.
- "Yarın", "cuma", "haftaya" gibi tarihleri bugüne göre YYYY-AA-GG'ye çevir.
- Kayıt açan araçları (görev, iş emri, proje, satış fırsatı, teklif gönderme) doğrudan çağır; uygulama kullanıcıya ayrıca bir onay kartı gösterir, sen ayrıca "emin misin" diye sorma.
- GES teklifinde kayıt açılmaz: ges_teklifi_hazirla ile hazırlayıcıyı dolduran bağlantıyı ver, kullanıcının kontrol edip kaydetmesini söyle.
- Teklif gönderirken kullanıcı WhatsApp ya da e-posta dediyse teklifi_gonder'i o kanalla çağır. WhatsApp'ta mesaj hazır açılır, son Gönder'e kullanıcı basar; bunu söyle.
- Bağlantı adreslerini (https://...) metne yazma; araçların verdiği bağlantılar ekranda düğme olarak çıkar, "aşağıdaki düğmeden açın" de.
- Kullanıcı bir işlemi reddederse yeniden deneme; ne değiştirmek istediğini sor.
- Bir araç hata verirse hatayı sade dille anlat.
- Kullanıcı bir belge, çizim, fatura, fotoğraf ya da eski bir teklifi görmek isterse drive_ara ile NES Drive'ında ara; bulduğun dosyaları kısa listele (ad, klasör, tarih). Açma düğmeleri ekranda otomatik çıkar. Bulamazsan farklı kelimelerle bir kez daha dene.
- Fiyat, maliyet ve kâr bilgisini yalnız yöneticiye söyle.
- Kullanıcı fotoğraf eklerse önce fotoğrafı dikkatle incele. Taşeron/usta listesi, malzeme listesi ya da hakediş listesi ise ve kullanıcı hakediş istiyorsa:
  - Satırları yazıldığı sırayla tek tek oku: miktar, birim, açıklama, satır tutarı. El yazısında 3 düz üstlü (Ʒ gibi), 7 çizgili ve kuyruklu yazılabilir; rakamı okurken birim fiyatın (tutar ÷ miktar) mantıklı olup olmadığına bak.
  - Emin olmadığın rakamı okuma_notu ile işaretle; uydurma.
  - Altta yazılı genel toplamı yazili_toplam olarak ver. Satırların toplamı tutmuyorsa farkı kullanıcıya açıkça söyle.
  - Kâr oranı söylenmediyse %25 kullan. Fotoğrafın yolunu foto_yolu olarak geç.
  - hakedis_hazirla'yı çağır. PDF düğmeleri (müşteri hakedişi, taşeron kaydı) sohbette çıkar. Yanıtında kısa özet ver: kalem sayısı, taşeron toplamı, müşteri tutarı (KDV hariç ve dahil), toplam tutuyor mu; emin olmadığın satırları tek tek yaz ve göndermeden önce kontrol etmesini söyle.
  - Kullanıcı bir rakamı düzeltirse ("1. satır 47730" gibi) son listeyi düzeltip hakedis_hazirla'yı aynı fotoğraf yoluyla yeniden çağır; düzeltilen satırın okuma notunu kaldır.`;
}

// ---------------------------------------------------------------- fotoğraflar
// İstemci fotoğrafı "assistant-uploads" deposuna yükler ve mesaja
// "[[foto:YOL]]" işareti koyar (geçmiş küçük kalır). Modele gönderirken
// işaret, kısa ömürlü imzalı adresle görsele çevrilir. Yalnız son mesajlardaki
// fotoğraflar görsel olarak gider; eskiler yalnız yol notu olarak kalır.
const PHOTO_RE = /^\[\[foto:([\w\-./]+)\]\]$/;
const PHOTO_WINDOW = 6;

async function expandPhotos(
  messages: Anthropic.Beta.BetaMessageParam[],
  ctx: Ctx,
): Promise<Anthropic.Beta.BetaMessageParam[]> {
  const cache = new Map<string, string | null>();
  const signed = async (path: string) => {
    if (!cache.has(path)) {
      const { data } = await ctx.db.storage
        .from("assistant-uploads")
        .createSignedUrl(path, 900);
      cache.set(path, data?.signedUrl ?? null);
    }
    return cache.get(path) ?? null;
  };
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  for (let m = 0; m < messages.length; m++) {
    const msg = messages[m];
    if (msg.role !== "user" || !Array.isArray(msg.content)) {
      out.push(msg);
      continue;
    }
    const recent = m >= messages.length - PHOTO_WINDOW;
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    for (const block of msg.content as Anthropic.Beta.BetaContentBlockParam[]) {
      const match =
        block.type === "text" ? PHOTO_RE.exec(block.text.trim()) : null;
      if (!match) {
        content.push(block);
        continue;
      }
      const path = match[1];
      const url = recent ? await signed(path) : null;
      if (url) content.push({ type: "image", source: { type: "url", url } });
      content.push({
        type: "text",
        text: url
          ? `(Ek fotoğraf, yol: ${path})`
          : `(Daha önce eklenmiş fotoğraf, yol: ${path})`,
      });
    }
    out.push({ ...msg, content });
  }
  return out;
}

// ---------------------------------------------------------------- sunucu
type Body = {
  messages?: Anthropic.Beta.BetaMessageParam[];
  confirm?: { approved: boolean };
  /** İstemcinin ürettiği istek kimliği; sohbete yazılan cevabı eşler. */
  request_id?: string;
  /** Cevabın yazılacağı sohbet ve istemcideki tam geçmiş uzunluğu. */
  conversation_id?: string;
  history_length?: number;
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
  const requestLength = messages.length;

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
    authHeader: req.headers.get("Authorization") ?? "",
  };
  const links: { label: string; href: string }[] = [];
  // Mesaj bir kez gönderildikten sonra iş sunucuda biter: ekran kapansa,
  // uygulama kapansa da cevap doğrudan sohbet geçmişine yazılır; uygulama
  // açılınca oradan gelir. İstemci, isteği göndermeden önce sohbeti kaydeder;
  // geçmiş uzunluğu tutmazsa (başka cihazdan değişmiş) yazılmaz.
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const requestId =
    typeof body.request_id === "string" && UUID_RE.test(body.request_id)
      ? body.request_id
      : null;
  const conversationId =
    typeof body.conversation_id === "string" &&
    UUID_RE.test(body.conversation_id)
      ? body.conversation_id
      : null;
  const historyLength = Number(body.history_length);
  async function saveToConversation(
    payload: Record<string, unknown>,
    status: number,
  ) {
    if (!requestId || !conversationId) return;
    try {
      const { data: row } = await db
        .from("assistant_conversations")
        .select("entries, messages")
        .eq("id", conversationId)
        .maybeSingle();
      if (!row) return;
      const entries = (row.entries ?? []) as Record<string, unknown>[];
      const stored = (row.messages ?? []) as unknown[];
      if (entries.some((e) => e.request_id === requestId)) return;
      if (stored.length !== historyLength) return;
      const at = new Date().toISOString();
      const ok = status < 400;
      const added =
        ok && Array.isArray(payload.messages)
          ? (payload.messages as unknown[]).slice(requestLength)
          : [];
      const pending = payload.pending as unknown[] | undefined;
      const docs = payload.documents as unknown[] | undefined;
      const entry = ok
        ? {
            role: "assistant",
            at,
            text:
              (payload.reply as string | undefined) ||
              (pending?.length ? "Şu işlemi yapmamı onaylıyor musunuz?" : ""),
            links: payload.links,
            pending,
            documents: docs?.length ? docs : undefined,
            request_id: requestId,
          }
        : {
            role: "error",
            at,
            text: String(payload.error ?? "Asistan yanıt veremedi."),
            request_id: requestId,
          };
      const { error } = await db
        .from("assistant_conversations")
        .update({
          entries: [...entries, entry],
          messages: [...stored, ...added],
        })
        .eq("id", conversationId);
      if (error) console.error("Sohbete yazılamadı", error.message);
    } catch (error) {
      console.error("Sohbete yazılamadı", error);
    }
  }
  async function respond(payload: Record<string, unknown>, status = 200) {
    await saveToConversation(payload, status);
    return json(payload, status);
  }
  const documents: Record<string, unknown>[] = [];

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
        const out = await def.run(cleanInput(block.input), ctx);
        if (out.link) links.push(out.link);
        if (out.links) links.push(...out.links);
        if (out.document) documents.push(out.document);
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
        messages: await expandPhotos(messages, ctx),
      });
      messages.push({ role: "assistant", content: response.content });

      if (response.stop_reason === "refusal") {
        return respond({
          messages,
          reply: "Bu isteğe yanıt veremiyorum.",
          links,
          documents,
        });
      }
      if (response.stop_reason === "pause_turn") continue;
      if (response.stop_reason !== "tool_use") {
        const reply = response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        return respond({ messages, reply, links, documents });
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
              ? await def.summary(cleanInput(u.input), ctx)
              : u.name,
          });
        }
        const text = response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        return respond({ messages, reply: text, pending, links, documents });
      }
      messages.push({ role: "user", content: await runTools(uses, null) });
    }
    return respond({
      messages,
      reply: "İşlem çok uzun sürdü; isteği daha kısa adımlara bölün.",
      links,
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return respond(
        { error: "Anthropic API anahtarı geçersiz.", code: "bad_key" },
        503,
      );
    }
    if (error instanceof Anthropic.RateLimitError) {
      return respond(
        { error: "Asistan şu an yoğun; biraz sonra tekrar deneyin." },
        429,
      );
    }
    if (error instanceof Anthropic.APIError) {
      console.error("Anthropic hatası", error.status, error.message);
      const detail = String(error.message ?? "").slice(0, 300);
      const lowCredit = /credit balance|billing/i.test(detail);
      return respond(
        {
          error: lowCredit
            ? "Anthropic API kredisi yok veya yetersiz. platform.claude.com → Billing bölümünü (Max planının aylık API kredisi bağlandı mı) kontrol edin."
            : `Asistan yanıt veremedi (${error.status}): ${detail}`,
          code: lowCredit ? "no_credit" : "api_error",
        },
        502,
      );
    }
    console.error(error);
    return respond({ error: "Asistan beklenmedik bir hata verdi." }, 500);
  }
});

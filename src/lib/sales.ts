// Satış takibi: aşamalar, etiketler ve takip hatırlatmalarının hesabı.
// Hatırlatmalar veritabanında saklanmaz; fırsat, görüşme ve teklif linki
// verisinden her açılışta hesaplanır (zamanlanmış iş gerekmez).

export const SALES_STAGES = [
  "yeni",
  "gorusuldu",
  "kesif",
  "teklif",
  "pazarlik",
  "kazanildi",
  "kaybedildi",
] as const;
export type SalesStage = (typeof SALES_STAGES)[number];

export const OPEN_STAGES: SalesStage[] = [
  "yeni",
  "gorusuldu",
  "kesif",
  "teklif",
  "pazarlik",
];

export const stageLabels: Record<SalesStage, string> = {
  yeni: "Yeni aday",
  gorusuldu: "Görüşüldü",
  kesif: "Keşif",
  teklif: "Teklif verildi",
  pazarlik: "Pazarlık",
  kazanildi: "Kazanıldı",
  kaybedildi: "Kaybedildi",
};

/** Huni değerinde kullanılan kazanma olasılığı (aşamaya göre). */
export const stageProbability: Record<SalesStage, number> = {
  yeni: 0.1,
  gorusuldu: 0.2,
  kesif: 0.35,
  teklif: 0.5,
  pazarlik: 0.7,
  kazanildi: 1,
  kaybedildi: 0,
};

export const serviceLabels = {
  ges: "GES",
  sarj: "EV şarj",
  taahhut: "Elektrik taahhüt",
  bakim: "Bakım / servis",
  olcum: "Ölçüm / periyodik kontrol",
  diger: "Diğer",
} as const;
export type SalesService = keyof typeof serviceLabels;

export const sourceLabels = {
  telefon: "Telefon",
  referans: "Referans",
  web: "Web sitesi",
  sosyal_medya: "Sosyal medya",
  saha: "Saha / ziyaret",
  fuar: "Fuar / etkinlik",
  mevcut_musteri: "Mevcut müşteri",
  diger: "Diğer",
} as const;
export type SalesSource = keyof typeof sourceLabels;

export const activityLabels = {
  arama: "Telefon",
  ziyaret: "Ziyaret",
  toplanti: "Toplantı",
  eposta: "E-posta",
  whatsapp: "WhatsApp",
  kesif: "Keşif",
  teklif: "Teklif",
  not: "Not",
  asama: "Aşama",
} as const;
export type ActivityKind = keyof typeof activityLabels;

export const LOST_REASONS = [
  "Fiyat yüksek bulundu",
  "Rakibe gitti",
  "Proje ertelendi / iptal",
  "Finansman / kredi çıkmadı",
  "Teknik olarak uygun değil (çatı, statik, bağlantı)",
  "Dönüş alınamadı",
];

export type LeadForFollowUp = {
  id: string;
  title: string;
  stage: SalesStage;
  next_action: string | null;
  next_action_at: string | null;
  stage_changed_at: string;
  created_at: string;
  offers: {
    id: string;
    offer_no: string;
    status: string;
    offer_share_links: {
      created_at: string;
      view_count: number;
      last_viewed_at: string | null;
      revoked_at: string | null;
    }[];
  }[];
};

export type FollowUp = {
  leadId: string;
  leadTitle: string;
  kind: "planli" | "gecikmis" | "acilmadi" | "acildi_donus_yok" | "hareketsiz";
  message: string;
  /** Sıralama için; küçük olan önce. */
  priority: number;
  days: number;
};

const DAY = 86_400_000;

function daysBetween(from: string | Date, to: Date) {
  return Math.floor((to.getTime() - new Date(from).getTime()) / DAY);
}

/** Bugünün yerel tarihi, YYYY-AA-GG. */
export function todayIso(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const CLOSED_OFFER = new Set(["approved", "lost", "cancelled"]);

/** Açık fırsatlar için takip listesi. `lastActivity` fırsat başına son
 * görüşme zamanıdır. */
export function computeFollowUps(
  leads: LeadForFollowUp[],
  lastActivity: Map<string, string>,
  now = new Date(),
): FollowUp[] {
  const today = todayIso(now);
  const items: FollowUp[] = [];
  for (const lead of leads) {
    if (!OPEN_STAGES.includes(lead.stage)) continue;
    const last = lastActivity.get(lead.id);
    let handled = false;

    if (lead.next_action_at) {
      if (lead.next_action_at < today) {
        const days = daysBetween(lead.next_action_at, now);
        items.push({
          leadId: lead.id,
          leadTitle: lead.title,
          kind: "gecikmis",
          message: `Gecikmiş: ${lead.next_action || "planlanan adım"} (${days} gün geçti)`,
          priority: 0,
          days,
        });
        handled = true;
      } else if (lead.next_action_at === today) {
        items.push({
          leadId: lead.id,
          leadTitle: lead.title,
          kind: "planli",
          message: `Bugün: ${lead.next_action || "planlanan adım"}`,
          priority: 1,
          days: 0,
        });
        handled = true;
      }
    }

    for (const offer of lead.offers ?? []) {
      if (CLOSED_OFFER.has(offer.status)) continue;
      const link = offer.offer_share_links?.find((l) => !l.revoked_at);
      if (!link) continue;
      if (link.view_count === 0) {
        const days = daysBetween(link.created_at, now);
        if (days >= 3) {
          items.push({
            leadId: lead.id,
            leadTitle: lead.title,
            kind: "acilmadi",
            message: `${offer.offer_no} linki ${days} gündür açılmadı — arayıp teklifin ulaştığını teyit edin.`,
            priority: 2,
            days,
          });
          handled = true;
        }
      } else if (link.last_viewed_at) {
        const days = daysBetween(link.last_viewed_at, now);
        const contactedAfter = last && last > link.last_viewed_at;
        if (days >= 2 && !contactedAfter) {
          items.push({
            leadId: lead.id,
            leadTitle: lead.title,
            kind: "acildi_donus_yok",
            message: `Müşteri ${offer.offer_no} teklifini ${link.view_count} kez açtı, ${days} gündür görüşme yok — sıcakken arayın.`,
            priority: 1,
            days,
          });
          handled = true;
        }
      }
    }

    if (!handled && !lead.next_action_at) {
      const reference = [last, lead.stage_changed_at]
        .filter(Boolean)
        .sort()
        .pop() as string;
      const days = daysBetween(reference, now);
      if (days >= 7) {
        items.push({
          leadId: lead.id,
          leadTitle: lead.title,
          kind: "hareketsiz",
          message: `${days} gündür hareket yok ve sonraki adım planlanmamış.`,
          priority: 3,
          days,
        });
      }
    }
  }
  return items.sort((a, b) => a.priority - b.priority || b.days - a.days);
}

/** Huni özeti: açık fırsat sayısı/değeri, olasılık ağırlıklı değer ve
 * son 90 günün kazanma oranı. Tutarlar TL'ye çevrilmiş verilir. */
export function pipelineSummary(
  leads: {
    stage: SalesStage;
    valueTl: number;
    closed_at: string | null;
  }[],
  now = new Date(),
) {
  const open = leads.filter((lead) => OPEN_STAGES.includes(lead.stage));
  const since = now.getTime() - 90 * DAY;
  const recent = leads.filter(
    (lead) =>
      (lead.stage === "kazanildi" || lead.stage === "kaybedildi") &&
      lead.closed_at &&
      new Date(lead.closed_at).getTime() >= since,
  );
  const won = recent.filter((lead) => lead.stage === "kazanildi");
  return {
    openCount: open.length,
    openValue: open.reduce((sum, lead) => sum + lead.valueTl, 0),
    weightedValue: open.reduce(
      (sum, lead) => sum + lead.valueTl * stageProbability[lead.stage],
      0,
    ),
    wonCount90: won.length,
    wonValue90: won.reduce((sum, lead) => sum + lead.valueTl, 0),
    winRate90: recent.length > 0 ? won.length / recent.length : null,
  };
}

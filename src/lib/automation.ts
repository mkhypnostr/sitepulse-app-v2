// Otomatik görev kurallarının etiketleri ve açıklamaları.
import { stageLabels } from "@/lib/sales";

export const triggerTypes = {
  offer_status: "Teklif durumu değişince",
  lead_stage: "Satış fırsatı aşaması değişince",
  project_status: "Proje durumu değişince",
  service_status: "Servis talebi durumu değişince",
  offer_valid_until: "Teklif geçerliliği bitmeden",
  contract_end: "Trafo sorumluluk sözleşmesi bitmeden",
} as const;
export type TriggerType = keyof typeof triggerTypes;

export const DATE_TRIGGERS: TriggerType[] = [
  "offer_valid_until",
  "contract_end",
];

/** Durum tetikleyicilerinde seçilebilecek değerler. */
export const triggerValues: Record<TriggerType, Record<string, string>> = {
  offer_status: {
    draft: "Taslak",
    internal_review: "İç onay",
    sent: "Müşteriye gönderildi",
    revision_pending: "Revizyon bekliyor",
    approved: "Onaylandı",
    lost: "Kaybedildi",
    cancelled: "İptal",
  },
  lead_stage: { ...stageLabels },
  project_status: {
    draft: "Taslak",
    active: "Aktif",
    on_hold: "Beklemede",
    completed: "Tamamlandı",
    cancelled: "İptal",
  },
  service_status: {
    new: "Yeni",
    reviewing: "İnceleniyor",
    planned: "Planlandı",
    on_site: "Sahada",
    resolved: "Çözüldü",
    closed: "Kapandı",
    cancelled: "İptal",
  },
  offer_valid_until: {},
  contract_end: {},
};

export const assignModes = {
  owner:
    "Kaydın sahibi (teklifi hazırlayan, proje yöneticisi, fırsat sorumlusu)",
  user: "Belirli kişi",
  none: "Atanmasın (yöneticiler görür)",
} as const;
export type AssignMode = keyof typeof assignModes;

/** Kuralın tek cümlelik açıklaması, ör. "Teklif 'Müşteriye gönderildi'
 * olunca 3 gün sonra". */
export function describeRule(rule: {
  trigger_type: string;
  trigger_value: string | null;
  offset_days: number;
}) {
  const type = rule.trigger_type as TriggerType;
  if (DATE_TRIGGERS.includes(type)) {
    const what =
      type === "contract_end"
        ? "Sözleşme bitişinden"
        : "Teklif geçerlilik bitişinden";
    return rule.offset_days === 0
      ? `${what.replace("bitişinden", "bitiş günü")}`
      : `${what} ${rule.offset_days} gün önce`;
  }
  const label =
    triggerValues[type]?.[rule.trigger_value ?? ""] ?? rule.trigger_value;
  const subject =
    type === "offer_status"
      ? "Teklif"
      : type === "lead_stage"
        ? "Fırsat"
        : type === "project_status"
          ? "Proje"
          : "Servis talebi";
  const when =
    rule.offset_days === 0 ? "aynı gün" : `${rule.offset_days} gün sonra`;
  return `${subject} "${label}" olunca ${when}`;
}

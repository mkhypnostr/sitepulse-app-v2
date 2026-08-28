export type TechnicalServiceStatus =
  | "new"
  | "reviewing"
  | "planned"
  | "on_site"
  | "resolved"
  | "closed"
  | "cancelled";

export type TechnicalServiceUrgency = "normal" | "high" | "critical";

export type TechnicalServiceEquipmentType =
  | "transformer"
  | "generator"
  | "ev_charger"
  | "panel"
  | "electrical_installation"
  | "other";

export const technicalServiceStatusLabels: Record<
  TechnicalServiceStatus,
  string
> = {
  new: "Yeni",
  reviewing: "İnceleniyor",
  planned: "Planlandı",
  on_site: "Sahada",
  resolved: "Çözüldü",
  closed: "Kapatıldı",
  cancelled: "İptal edildi",
};

export const technicalServiceUrgencyLabels: Record<
  TechnicalServiceUrgency,
  string
> = {
  normal: "Normal",
  high: "Yüksek",
  critical: "Kritik",
};

export const technicalServiceEquipmentLabels: Record<
  TechnicalServiceEquipmentType,
  string
> = {
  transformer: "Trafo",
  generator: "Jeneratör",
  ev_charger: "Elektrikli araç şarj istasyonu",
  panel: "Elektrik panosu",
  electrical_installation: "Elektrik tesisatı",
  other: "Diğer",
};

export function technicalServiceRequestLabel(requestNo: number) {
  return `TS-${String(requestNo).padStart(6, "0")}`;
}

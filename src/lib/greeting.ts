// Genel Bakış karşılama ve "Yeni" etiketi için küçük zaman yardımcıları.

const NEW_ITEM_WINDOW_MS = 24 * 60 * 60 * 1000;

// Son 24 saatte oluşturulan kayıtlar "Yeni" sayılır.
export function isRecentlyCreated(
  createdAt: string | null | undefined,
  now: Date = new Date(),
) {
  if (!createdAt) return false;
  const created = new Date(createdAt).getTime();
  return (
    Number.isFinite(created) && now.getTime() - created < NEW_ITEM_WINDOW_MS
  );
}

export function greetingForHour(hour: number) {
  if (hour < 6) return "İyi geceler";
  if (hour < 12) return "Günaydın";
  if (hour < 18) return "İyi günler";
  return "İyi akşamlar";
}

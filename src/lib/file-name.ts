// Paylaşılan/indirilen dosya adları yalnız Latin harfli olur.
//
// Türkçe harfli adlar bazı yerlerde bozuluyor: WhatsApp Web/masaüstü
// "ŞİRİNKÖY" adını "Å\u009eÄ°RÄ°NKÃ\u0096Y" gibi gösteriyor, bazı tarayıcılar indirme
// adını "download" yapıyor. Bu yüzden ad Türkçe karakterleri karşılığına
// çevrilerek ve boşluk/işaretler "_" yapılarak üretilir.

const MAP: Record<string, string> = {
  ç: "c",
  Ç: "C",
  ğ: "g",
  Ğ: "G",
  ı: "i",
  İ: "I",
  ö: "o",
  Ö: "O",
  ş: "s",
  Ş: "S",
  ü: "u",
  Ü: "U",
};

/** Ad parçası: Türkçe harfler çevrilir, kalan işaretler "_" olur. */
export function asciiSlug(value: string, maxLength = 60) {
  return value
    .replace(/[çÇğĞıİöÖşŞüÜ]/g, (c) => MAP[c] ?? c)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_.-]+|[_.-]+$/g, "")
    .slice(0, maxLength)
    .replace(/[_.-]+$/g, "");
}

/** Tam dosya adı (uzantı korunur). */
export function asciiFileName(name: string, fallback = "dosya") {
  const match = name.match(/^(.*?)(\.[A-Za-z0-9]{1,5})?$/);
  const base = asciiSlug(match?.[1] ?? name, 120) || fallback;
  const ext = (match?.[2] ?? "").toLowerCase();
  return `${base}${ext}`;
}

export type MapCoordinates = {
  latitude: number;
  longitude: number;
};

function validCoordinates(latitude: number, longitude: number) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function coordinates(latitude: string, longitude: string): MapCoordinates | null {
  const parsedLatitude = Number(latitude);
  const parsedLongitude = Number(longitude);
  return validCoordinates(parsedLatitude, parsedLongitude)
    ? { latitude: parsedLatitude, longitude: parsedLongitude }
    : null;
}

export function safeMapUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

export function safeHttpsMapUrl(value: string | null | undefined) {
  const url = safeMapUrl(value);
  return url?.startsWith("https://") ? url : null;
}

export function extractMapCoordinates(value: string | null | undefined) {
  const safeUrl = safeMapUrl(value);
  if (!safeUrl) return null;

  let decodedUrl = safeUrl;
  try {
    decodedUrl = decodeURIComponent(safeUrl);
  } catch {
    // URL zaten okunabilir durumdaysa çözümleme gerekmez.
  }

  const atMatch = decodedUrl.match(/@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/);
  if (atMatch) return coordinates(atMatch[1], atMatch[2]);

  const dataMatch = decodedUrl.match(/!3d(-?\d{1,2}(?:\.\d+)?).*?!4d(-?\d{1,3}(?:\.\d+)?)/);
  if (dataMatch) return coordinates(dataMatch[1], dataMatch[2]);

  const url = new URL(safeUrl);
  for (const parameter of ["q", "query", "ll", "center", "destination"]) {
    const candidate = url.searchParams.get(parameter);
    const match = candidate?.match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
    if (match) return coordinates(match[1], match[2]);
  }

  return null;
}

// "maps.google.com" bir iframe içinden yüklendiğinde Google bağlantıyı
// reddediyor (ERR_CONNECTION_CLOSED); embed her zaman "www.google.com"
// üzerinden istenmeli — 301 ile resmi /maps/embed sayfasına yönlenir.
export function googleMapsCoordinateEmbedUrl({ latitude, longitude }: MapCoordinates) {
  return `https://www.google.com/maps?q=${latitude},${longitude}&z=16&output=embed`;
}

export function googleMapsEmbedUrl(query: string | null | undefined) {
  const normalized = query?.trim();
  return normalized
    ? `https://www.google.com/maps?q=${encodeURIComponent(normalized)}&z=15&output=embed`
    : null;
}

// Kısa paylaşım linkleri (maps.app.goo.gl, goo.gl/maps) sunucu taraflı
// yönlendirme takibi olmadan koordinat içermez ve embed URL'ine
// çevrilemez; bu linkler için iframe denemek yerine doğrudan bağlantı
// gösterilmelidir.
export function isShortGoogleMapsUrl(value: string | null | undefined) {
  const url = safeMapUrl(value);
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "goo.gl" || host === "maps.app.goo.gl";
  } catch {
    return false;
  }
}

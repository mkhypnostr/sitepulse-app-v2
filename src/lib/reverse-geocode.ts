// Koordinattan okunur adres (Mahalle, Cadde No, İlçe / İl).
//
// OpenStreetMap Nominatim kullanılır (harita ve keşif aramasında da
// kullanılıyor). Ücretsiz servistir; yalnız belge açılırken tek istek atılır
// ve sonuç oturum boyunca önbellekte tutulur.

import { extractMapCoordinates, safeMapUrl } from "@/lib/map-location";

type NominatimAddress = Partial<
  Record<
    | "road"
    | "house_number"
    | "neighbourhood"
    | "quarter"
    | "suburb"
    | "village"
    | "hamlet"
    | "town"
    | "city_district"
    | "county"
    | "city"
    | "province"
    | "state",
    string
  >
>;

const cache = new Map<string, string | null>();

/** Konum bağlantısından (Google Maps vb.) koordinat çıkarır. */
export function coordinatesFromLocation(value: string | null | undefined) {
  if (!value || !safeMapUrl(value)) return null;
  return extractMapCoordinates(value);
}

export function formatTurkishAddress(address: NominatimAddress) {
  const area =
    address.quarter ||
    address.neighbourhood ||
    address.suburb ||
    address.village ||
    address.hamlet ||
    "";
  const street = address.road
    ? `${address.road}${address.house_number ? ` No:${address.house_number}` : ""}`
    : "";
  const district =
    address.town || address.city_district || address.county || "";
  const province = address.province || address.state || address.city || "";
  const tail = [district, province]
    .filter(Boolean)
    .filter((part, index, list) => list.indexOf(part) === index)
    .join(" / ");
  return [area, street, tail].filter(Boolean).join(", ");
}

export async function reverseGeocode(
  latitude: number,
  longitude: number,
): Promise<string | null> {
  const key = `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?${new URLSearchParams({
        lat: String(latitude),
        lon: String(longitude),
        format: "jsonv2",
        zoom: "18",
        addressdetails: "1",
        "accept-language": "tr",
      }).toString()}`,
    );
    if (!response.ok) throw new Error(String(response.status));
    const data = (await response.json()) as {
      address?: NominatimAddress;
      display_name?: string;
    };
    const text =
      (data.address ? formatTurkishAddress(data.address) : "") ||
      data.display_name?.split(", ").slice(0, 4).join(", ") ||
      null;
    cache.set(key, text);
    return text;
  } catch {
    return null;
  }
}

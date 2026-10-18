// Genel Bakış hava durumu: Open-Meteo (ücretsiz, anahtarsız). Konum
// izni daha önce verilmişse cihaz konumu, yoksa NES merkezi (Menteşe/Muğla)
// kullanılır; sayfa açılırken konum izni İSTENMEZ.
import { useQuery } from "@tanstack/react-query";

export const NES_LOCATION = {
  latitude: 37.2153,
  longitude: 28.3636,
  label: "Menteşe, Muğla",
};

export type Weather = {
  label: string;
  current: {
    temperature: number;
    apparent: number;
    humidity: number;
    wind: number;
    code: number;
    isDay: boolean;
  };
  days: {
    date: string;
    code: number;
    max: number;
    min: number;
    rain: number;
    sunrise: string;
    sunset: string;
    uv: number;
    /** Güneş ışınımı, kWh/m² (GES üretimi için kaba gösterge). */
    radiation: number;
  }[];
};

/** WMO hava kodu → Türkçe açıklama ve simge türü. */
export function weatherInfo(code: number): {
  text: string;
  kind:
    | "clear"
    | "partly"
    | "cloud"
    | "fog"
    | "drizzle"
    | "rain"
    | "snow"
    | "storm";
} {
  if (code === 0) return { text: "Açık", kind: "clear" };
  if (code === 1) return { text: "Az bulutlu", kind: "partly" };
  if (code === 2) return { text: "Parçalı bulutlu", kind: "partly" };
  if (code === 3) return { text: "Kapalı", kind: "cloud" };
  if (code === 45 || code === 48) return { text: "Sisli", kind: "fog" };
  if (code >= 51 && code <= 57) return { text: "Çiseleme", kind: "drizzle" };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82))
    return { text: code >= 80 ? "Sağanak" : "Yağmurlu", kind: "rain" };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86)
    return { text: "Karlı", kind: "snow" };
  if (code >= 95) return { text: "Gök gürültülü fırtına", kind: "storm" };
  return { text: "Bulutlu", kind: "cloud" };
}

/** Sahada çalışmaya uygunluk notu. */
export function fieldNote(day: Weather["days"][number], wind: number) {
  if (day.code >= 95)
    return {
      ok: false,
      text: "Fırtına bekleniyor, çatı ve direk işlerini erteleyin.",
    };
  if (day.rain >= 60)
    return {
      ok: false,
      text: `Yağış ihtimali %${day.rain}; dış saha işlerini planlarken dikkat.`,
    };
  if (wind >= 40)
    return {
      ok: false,
      text: `Rüzgâr ${Math.round(wind)} km/sa; çatıda panel montajı riskli.`,
    };
  if (day.max >= 36)
    return {
      ok: false,
      text: "Çok sıcak; öğle saatlerinde çatı işine ara verin.",
    };
  return { ok: true, text: "Saha çalışmasına uygun." };
}

async function currentPosition() {
  try {
    if (!("geolocation" in navigator) || !navigator.permissions) return null;
    const status = await navigator.permissions.query({ name: "geolocation" });
    if (status.state !== "granted") return null;
    return await new Promise<{ latitude: number; longitude: number } | null>(
      (resolve) =>
        navigator.geolocation.getCurrentPosition(
          (p) =>
            resolve({
              latitude: p.coords.latitude,
              longitude: p.coords.longitude,
            }),
          () => resolve(null),
          { timeout: 4000, maximumAge: 30 * 60 * 1000 },
        ),
    );
  } catch {
    return null;
  }
}

async function fetchWeather(): Promise<Weather> {
  const pos = await currentPosition();
  const lat = pos?.latitude ?? NES_LOCATION.latitude;
  const lon = pos?.longitude ?? NES_LOCATION.longitude;
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current:
      "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day",
    daily:
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max,shortwave_radiation_sum",
    timezone: "Europe/Istanbul",
    forecast_days: "2",
  });
  const response = await fetch(
    `https://api.open-meteo.com/v1/forecast?${params}`,
  );
  if (!response.ok) throw new Error("Hava durumu alınamadı.");
  const d = (await response.json()) as {
    current: {
      temperature_2m: number;
      apparent_temperature: number;
      relative_humidity_2m: number;
      weather_code: number;
      wind_speed_10m: number;
      is_day: number;
    };
    daily: {
      time: string[];
      weather_code: number[];
      temperature_2m_max: number[];
      temperature_2m_min: number[];
      precipitation_probability_max: (number | null)[];
      sunrise: string[];
      sunset: string[];
      uv_index_max: (number | null)[];
      shortwave_radiation_sum: (number | null)[];
    };
  };
  return {
    label: pos ? "Bulunduğunuz yer" : NES_LOCATION.label,
    current: {
      temperature: d.current.temperature_2m,
      apparent: d.current.apparent_temperature,
      humidity: d.current.relative_humidity_2m,
      wind: d.current.wind_speed_10m,
      code: d.current.weather_code,
      isDay: d.current.is_day === 1,
    },
    days: d.daily.time.map((date, i) => ({
      date,
      code: d.daily.weather_code[i],
      max: d.daily.temperature_2m_max[i],
      min: d.daily.temperature_2m_min[i],
      rain: d.daily.precipitation_probability_max[i] ?? 0,
      sunrise: d.daily.sunrise[i],
      sunset: d.daily.sunset[i],
      uv: d.daily.uv_index_max[i] ?? 0,
      radiation: (d.daily.shortwave_radiation_sum[i] ?? 0) / 3.6,
    })),
  };
}

export function useWeather() {
  return useQuery({
    queryKey: ["weather"],
    queryFn: fetchWeather,
    staleTime: 30 * 60 * 1000,
    refetchInterval: 30 * 60 * 1000,
    retry: 1,
  });
}

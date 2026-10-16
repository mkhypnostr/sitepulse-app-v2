import { createFileRoute } from "@tanstack/react-router";
import {
  parsePvgis,
  PVGIS_URL,
  pvgisRequestUrl,
  validPvgisQuery,
  type PvgisQuery,
} from "@/lib/solar-site";

// PVGIS (Avrupa Komisyonu JRC) tarayıcıdan doğrudan çağrılamıyor (CORS yok);
// istek sunucuda yapılır. Açık bir vekil (proxy) olmaması için yalnız oturum
// açmış kullanıcıya hizmet verilir.

async function authorized(request: Request) {
  const token = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const url =
    process.env.SUPABASE_URL ?? import.meta.env.VITE_SUPABASE_URL ?? "";
  const key =
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    "";
  if (!url || !key) return false;
  try {
    const response = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: key, authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/api/pvgis")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!(await authorized(request))) {
          return Response.json({ error: "Oturum gerekli." }, { status: 401 });
        }
        const params = new URL(request.url).searchParams;
        const query: Partial<PvgisQuery> = {
          lat: Number(params.get("lat")),
          lon: Number(params.get("lon")),
          tilt: Number(params.get("tilt")),
          azimuth: Number(params.get("azimuth")),
          lossPct: Number(params.get("loss") ?? 14),
        };
        if (!validPvgisQuery(query)) {
          return Response.json(
            { error: "Konum, eğim veya yön geçersiz." },
            { status: 400 },
          );
        }
        const bases = [PVGIS_URL, PVGIS_URL.replace("v5_3", "v5_2")];
        let lastError = "PVGIS yanıt vermedi.";
        for (const base of bases) {
          try {
            const response = await fetch(pvgisRequestUrl(query, base), {
              signal: AbortSignal.timeout(20_000),
            });
            const body = (await response.json().catch(() => null)) as {
              message?: string;
            } | null;
            if (!response.ok) {
              lastError = body?.message
                ? `PVGIS: ${body.message}`
                : `PVGIS HTTP ${response.status}`;
              // 400 konum hatasıdır (ör. denizde); diğer sürüm de aynı der.
              if (response.status === 400) break;
              continue;
            }
            const result = parsePvgis(body, query);
            if (!result) {
              lastError = "PVGIS yanıtı okunamadı.";
              continue;
            }
            return Response.json(result, {
              headers: { "cache-control": "private, max-age=86400" },
            });
          } catch {
            lastError = "PVGIS'e bağlanılamadı.";
          }
        }
        return Response.json({ error: lastError }, { status: 502 });
      },
    },
  },
});

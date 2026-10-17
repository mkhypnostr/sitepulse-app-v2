import { createFileRoute } from "@tanstack/react-router";
import {
  enerjipazariCategoryUrl,
  isEnerjipazariCategory,
  parseEnerjipazariPage,
} from "@/lib/enerjipazari";

// enerjipazari.com.tr tarayıcıdan doğrudan okunamıyor (CORS yok); kategori
// sayfası sunucuda alınıp ürün adı + fiyat olarak verilir. Açık bir vekil
// olmaması için yalnız yöneticiye ve yalnız sabit kategori listesine hizmet
// verilir. Sitenin robots.txt kuralı (30 sn bekleme) istemcide uygulanır:
// sayfalar tek tek, aralarında 31 sn beklenerek istenir.

async function isAdmin(request: Request) {
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
  const headers = { apikey: key, authorization: `Bearer ${token}` };
  try {
    const userResponse = await fetch(`${url}/auth/v1/user`, {
      headers,
      signal: AbortSignal.timeout(8_000),
    });
    if (!userResponse.ok) return false;
    const user = (await userResponse.json()) as { id?: string };
    if (!user.id) return false;
    const roleResponse = await fetch(`${url}/rest/v1/rpc/has_role`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ _user_id: user.id, _role: "admin" }),
      signal: AbortSignal.timeout(8_000),
    });
    return roleResponse.ok && (await roleResponse.json()) === true;
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/api/enerjipazari-prices")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!(await isAdmin(request))) {
          return Response.json(
            { error: "Bu işlem yalnız yöneticiye açık." },
            { status: 403 },
          );
        }
        const params = new URL(request.url).searchParams;
        const category = params.get("category") ?? "";
        const page = Math.trunc(Number(params.get("page") ?? 1));
        if (!isEnerjipazariCategory(category) || !(page >= 1 && page <= 10)) {
          return Response.json(
            { error: "Kategori veya sayfa geçersiz." },
            { status: 400 },
          );
        }
        try {
          const response = await fetch(
            enerjipazariCategoryUrl(category, page),
            {
              headers: {
                accept: "text/html",
                "user-agent":
                  "NES-Grup-Teklif/1.0 (+https://app.nesgrup.com; fiyat karsilastirma, gunde birkac istek)",
              },
              signal: AbortSignal.timeout(15_000),
            },
          );
          if (!response.ok) {
            return Response.json(
              {
                error: `Enerji Pazarı yanıt vermedi (HTTP ${response.status}).`,
              },
              { status: 502 },
            );
          }
          const parsed = parseEnerjipazariPage(
            await response.text(),
            category,
            page,
          );
          if (parsed.products.length === 0) {
            return Response.json(
              {
                error:
                  "Sayfada ürün/fiyat bulunamadı (site düzeni değişmiş olabilir).",
              },
              { status: 502 },
            );
          }
          return Response.json(parsed, {
            headers: { "cache-control": "private, max-age=3600" },
          });
        } catch {
          return Response.json(
            { error: "Enerji Pazarı'na bağlanılamadı." },
            { status: 502 },
          );
        }
      },
    },
  },
});

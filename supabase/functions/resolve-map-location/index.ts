import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function allowedGoogleMapsUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  const allowed =
    host === "maps.app.goo.gl" ||
    host === "goo.gl" ||
    host === "google.com" ||
    host === "www.google.com" ||
    host === "maps.google.com" ||
    (/^(www\.|maps\.)?google\.[a-z.]+$/.test(host) &&
      url.pathname.startsWith("/maps"));

  return allowed ? url : null;
}

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

function extractCoordinates(value: string) {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // URL zaten çözülmüş olabilir.
  }

  const patterns = [
    /@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/,
    /!3d(-?\d{1,2}(?:\.\d+)?).*?!4d(-?\d{1,3}(?:\.\d+)?)/,
  ];
  for (const pattern of patterns) {
    const match = decoded.match(pattern);
    if (!match) continue;
    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    if (validCoordinates(latitude, longitude)) return { latitude, longitude };
  }

  const url = new URL(value);
  for (const parameter of ["q", "query", "ll", "center", "destination"]) {
    const candidate = url.searchParams.get(parameter);
    const match = candidate?.match(
      /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/,
    );
    if (!match) continue;
    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    if (validCoordinates(latitude, longitude)) return { latitude, longitude };
  }

  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST kullanın." }, 405);

  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer "))
    return json({ error: "Oturum gerekli." }, 401);

  const accessToken = authorization.slice("Bearer ".length).trim();
  if (!accessToken) return json({ error: "Oturum doğrulanamadı." }, 401);

  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } =
    await client.auth.getUser(accessToken);
  if (authError || !authData.user)
    return json({ error: "Geçersiz oturum." }, 401);

  let rawUrl = "";
  try {
    const body = (await req.json()) as { url?: unknown };
    rawUrl = typeof body.url === "string" ? body.url.trim() : "";
  } catch {
    return json({ error: "Geçersiz istek." }, 400);
  }

  if (!rawUrl || rawUrl.length > 2048)
    return json({ error: "Geçerli bir harita bağlantısı girin." }, 400);
  const initialUrl = allowedGoogleMapsUrl(rawUrl);
  if (!initialUrl)
    return json(
      { error: "Yalnızca güvenli Google Maps bağlantıları kabul edilir." },
      400,
    );

  let resolvedUrl = initialUrl.toString();
  try {
    const response = await fetch(initialUrl, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "NES-Enerji-Map-Resolver/1.0" },
    });
    const finalUrl = allowedGoogleMapsUrl(response.url);
    if (finalUrl) resolvedUrl = finalUrl.toString();
    await response.body?.cancel();
  } catch {
    // Doğrudan bağlantı yine de aşağıda çözümlenebilir.
  }

  const location =
    extractCoordinates(resolvedUrl) ??
    extractCoordinates(initialUrl.toString());
  return json({
    original_url: initialUrl.toString(),
    resolved_url: resolvedUrl,
    latitude: location?.latitude ?? null,
    longitude: location?.longitude ?? null,
  });
});

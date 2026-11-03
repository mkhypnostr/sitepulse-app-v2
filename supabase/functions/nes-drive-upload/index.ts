import { createClient } from "npm:@supabase/supabase-js@2.110.7";

// Uygulamada üretilen PDF'i kurumsal Google Drive'a kaydeder.
//
// - Yalnız yönetici çağırabilir (teklifler fiyat içerir).
// - Dosya NES Operasyon paylaşılan sürücüsünde "05 Teklifler/<alt klasör>"
//   altına yazılır; alt klasör sabit listeden seçilir, dışarıdan klasör adı
//   veya kimliği alınmaz.
// - Aynı adlı dosya varsa üzerine yeni sürüm yazılır (kopya oluşmaz).
// - Google oturumu nes-workspace-control'ün kasada tuttuğu kurumsal bağlantıdır.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const OPERATIONS_DRIVE_ID =
  Deno.env.get("NES_OPERATIONS_DRIVE_ID") || "0ANT5zef2P9oDUk9PVA";
const WORKSPACE_OWNER_EMAIL = (
  Deno.env.get("NES_WORKSPACE_OWNER_EMAIL") || "mehmet.kilinckaya@nesgrup.com"
).toLowerCase();
const QUOTE_ROOT_FOLDER_NAME = "05 Teklifler";
const TARGET_FOLDERS: Record<string, string> = {
  olcum_teklifi: "Ölçüm Teklifleri",
};
const MAX_BYTES = 8 * 1024 * 1024;

function readAdminKey() {
  const secretKeysJson = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeysJson) {
    try {
      const keys = JSON.parse(secretKeysJson) as Record<string, string>;
      if (keys.default) return keys.default;
    } catch {
      // Eski anahtara geri dön.
    }
  }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!legacy) throw new Error("Sunucu anahtarı yapılandırılmamış.");
  return legacy;
}

const admin = createClient(SUPABASE_URL, readAdminKey(), {
  auth: { autoRefreshToken: false, persistSession: false },
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

// ------------------------------------------------------------ Google oturumu

type GoogleCredentials = {
  google_email: string;
  scopes: string[];
  access_token: string;
  refresh_token: string;
  expires_at: string | null;
};

async function ownerUserId() {
  const { data, error } = await admin
    .from("google_workspace_connections")
    .select("owner_user_id")
    .eq("google_email", WORKSPACE_OWNER_EMAIL)
    .maybeSingle();
  if (error || !data?.owner_user_id)
    throw new Error("Kurumsal Google Drive bağlantısı bulunamadı.");
  return data.owner_user_id as string;
}

async function oauthClient() {
  const { data, error } = await admin.rpc(
    "get_google_workspace_oauth_client_credentials",
  );
  const row = Array.isArray(data) ? data[0] : data;
  if (!error && row?.client_id && row?.client_secret)
    return {
      client_id: String(row.client_id),
      client_secret: String(row.client_secret),
    };
  const id = Deno.env.get("GOOGLE_WORKSPACE_CLIENT_ID") ?? "";
  const secret = Deno.env.get("GOOGLE_WORKSPACE_CLIENT_SECRET") ?? "";
  if (id && secret) return { client_id: id, client_secret: secret };
  throw new Error("Google uygulama bilgileri bulunamadı.");
}

async function accessToken(owner: string) {
  const { data, error } = await admin.rpc("get_google_workspace_credentials", {
    target_user_id: owner,
  });
  if (error) throw new Error("Google bağlantısı okunamadı.");
  const credentials = (data?.[0] as GoogleCredentials | undefined) ?? null;
  if (!credentials) throw new Error("Google Drive bağlantısı yok.");
  const expiresAt = credentials.expires_at
    ? new Date(credentials.expires_at).getTime()
    : 0;
  if (expiresAt > Date.now() + 90_000) return credentials.access_token;

  const client = await oauthClient();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      ...client,
      refresh_token: credentials.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok || typeof payload.access_token !== "string")
    throw new Error(
      "Google oturumu yenilenemedi; Drive bağlantısını yeniden onaylayın.",
    );
  const nextExpiry = new Date(
    Date.now() + Number(payload.expires_in ?? 3600) * 1000,
  ).toISOString();
  // Yenileme anahtarı boş verilince kasadaki mevcut anahtar korunur
  // (nes-workspace-control ile aynı davranış).
  await admin.rpc("save_google_workspace_connection", {
    target_user_id: owner,
    target_google_email: credentials.google_email,
    target_scopes: credentials.scopes,
    target_access_token: payload.access_token,
    target_refresh_token: "",
    target_expires_at: nextExpiry,
  });
  return payload.access_token;
}

async function google<T>(
  token: string,
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  const response = await fetch(url, { ...init, headers });
  const payload = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    const message = (payload.error as { message?: string } | undefined)
      ?.message;
    throw new Error(
      message
        ? `Google: ${message}`
        : `Google isteği başarısız (${response.status}).`,
    );
  }
  return payload as T;
}

const q = (value: string) => value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

async function findChild(
  token: string,
  parentId: string,
  name: string,
  folder: boolean,
) {
  const query = encodeURIComponent(
    `'${parentId}' in parents and name = '${q(name)}' and mimeType ${folder ? "=" : "!="} 'application/vnd.google-apps.folder' and trashed = false`,
  );
  const result = await google<{
    files?: Array<{ id: string; name: string; webViewLink?: string }>;
  }>(
    token,
    `https://www.googleapis.com/drive/v3/files?q=${query}&corpora=allDrives&includeItemsFromAllDrives=true&supportsAllDrives=true&pageSize=10&fields=files(id,name,webViewLink)`,
  );
  return result.files?.find((f) => f.name === name) ?? null;
}

async function ensureFolder(token: string, parentId: string, name: string) {
  const existing = await findChild(token, parentId, name, true);
  if (existing) return existing.id;
  const created = await google<{ id: string }>(
    token,
    "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id",
    {
      method: "POST",
      body: JSON.stringify({
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentId],
      }),
    },
  );
  return created.id;
}

function multipartBody(metadata: unknown, bytes: Uint8Array, boundary: string) {
  const enc = new TextEncoder();
  const head = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`,
  );
  const tail = enc.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head, 0);
  body.set(bytes, head.length);
  body.set(tail, head.length + bytes.length);
  return body;
}

function decodeBase64(value: string) {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ------------------------------------------------------------------ istek

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST kullanın." }, 405);

  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer "))
    return json({ error: "Oturum gerekli." }, 401);
  const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userError } = await db.auth.getUser(
    authorization.slice("Bearer ".length).trim(),
  );
  if (userError || !userData.user)
    return json({ error: "Geçersiz oturum." }, 401);
  const { data: callerRole } = await db.rpc("get_my_app_role");
  if (callerRole !== "admin")
    return json({ error: "Drive'a kaydetme yalnız yöneticiye açık." }, 403);

  let body: { kind?: unknown; file_name?: unknown; content_base64?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Geçersiz istek." }, 400);
  }
  const subFolder =
    typeof body.kind === "string" ? TARGET_FOLDERS[body.kind] : undefined;
  if (!subFolder) return json({ error: "Kayıt türü geçersiz." }, 400);
  const fileName =
    typeof body.file_name === "string"
      ? body.file_name
          .replace(/[\\/\r\n\t]+/g, "_")
          .trim()
          .slice(0, 150)
      : "";
  if (!fileName.toLowerCase().endsWith(".pdf"))
    return json({ error: "Dosya adı .pdf ile bitmeli." }, 400);
  if (typeof body.content_base64 !== "string" || !body.content_base64)
    return json({ error: "Dosya boş." }, 400);

  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(body.content_base64);
  } catch {
    return json({ error: "Dosya okunamadı." }, 400);
  }
  if (bytes.length > MAX_BYTES)
    return json({ error: "Dosya 8 MB sınırını aşıyor." }, 413);
  // PDF imzası: "%PDF-"
  if (
    bytes.length < 5 ||
    String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-"
  )
    return json({ error: "Yalnız PDF dosyası kaydedilebilir." }, 400);

  try {
    const owner = await ownerUserId();
    const token = await accessToken(owner);
    const rootId = await ensureFolder(
      token,
      OPERATIONS_DRIVE_ID,
      QUOTE_ROOT_FOLDER_NAME,
    );
    const folderId = await ensureFolder(token, rootId, subFolder);
    const existing = await findChild(token, folderId, fileName, false);
    const boundary = `nes-${crypto.randomUUID()}`;
    const fields = "id,name,webViewLink";
    const file = existing
      ? await google<{ id: string; name: string; webViewLink?: string }>(
          token,
          `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existing.id)}?uploadType=multipart&supportsAllDrives=true&fields=${fields}`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": `multipart/related; boundary=${boundary}`,
            },
            body: multipartBody({ name: fileName }, bytes, boundary),
          },
        )
      : await google<{ id: string; name: string; webViewLink?: string }>(
          token,
          `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=${fields}`,
          {
            method: "POST",
            headers: {
              "Content-Type": `multipart/related; boundary=${boundary}`,
            },
            body: multipartBody(
              {
                name: fileName,
                parents: [folderId],
                mimeType: "application/pdf",
              },
              bytes,
              boundary,
            ),
          },
        );
    return json({
      id: file.id,
      name: file.name,
      url:
        file.webViewLink ?? `https://drive.google.com/file/d/${file.id}/view`,
      folder: `${QUOTE_ROOT_FOLDER_NAME}/${subFolder}`,
      replaced: Boolean(existing),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Drive kaydı başarısız:", message);
    return json({ error: message }, 502);
  }
});

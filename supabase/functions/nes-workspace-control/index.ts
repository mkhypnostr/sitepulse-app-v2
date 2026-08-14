import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.7";

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

type Actor = {
  user: { id: string; email?: string };
  isAdmin: boolean;
};

type GoogleCredentials = {
  google_email: string;
  scopes: string[];
  access_token: string;
  refresh_token: string;
  expires_at: string | null;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/nes-workspace-control`;
const RESOURCE_METADATA_URL = `${FUNCTION_URL}/.well-known/oauth-protected-resource`;
const AUTH_SERVER_URL = `${SUPABASE_URL}/auth/v1`;
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_WORKSPACE_CLIENT_ID") ?? "";
const GOOGLE_CLIENT_SECRET =
  Deno.env.get("GOOGLE_WORKSPACE_CLIENT_SECRET") ?? "";
const GOOGLE_REDIRECT_URI =
  Deno.env.get("GOOGLE_WORKSPACE_REDIRECT_URI") ||
  `${FUNCTION_URL}/google/callback`;
const OPERATIONS_DRIVE_ID =
  Deno.env.get("NES_OPERATIONS_DRIVE_ID") || "0ANT5zef2P9oDUk9PVA";
const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/calendar.events",
];

const OPERATIONS_ROOT_FOLDERS = [
  "00 Şablonlar",
  "01 Aktif Projeler",
  "02 Tamamlanan Projeler",
  "03 Ortak Teknik Kütüphane",
  "04 Toplantılar ve Tutanaklar",
  "05 Genel Operasyon",
];

const FINANCE_ROOT_FOLDERS = [
  "00_Gelen Kutusu & Sınıflandırılacaklar",
  "01_Şirket & Hukuk",
  "02_Teklifler",
  "03_Sözleşmeler",
  "04_Finans & Muhasebe",
  "05_Maliyet & Bütçe",
  "06_Hakedişler",
  "07_Satın Alma & Tedarik",
  "08_İnsan Kaynakları",
  "09_Operasyon & Proje Yönetimi",
  "10_Raporlama & KPI",
  "11_Marka & Kurumsal İletişim",
  "12_Bilgi Teknolojileri & Sistemler",
  "13_Arşiv",
];

const PROJECT_OPERATIONS_FOLDERS = [
  "01 Teklif ve Sözleşme",
  "02 Teknik Dokümanlar",
  "03 Saha Fotoğrafları",
  "04 Günlük Raporlar",
  "05 Toplantılar ve Tutanaklar",
  "06 Teslim ve Kabul",
];

function readAdminKey() {
  const secretKeysJson = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeysJson) {
    try {
      const secretKeys = JSON.parse(secretKeysJson) as Record<string, string>;
      if (secretKeys.default) return secretKeys.default;
    } catch {
      // Geriye uyumlu service role anahtarına düş.
    }
  }
  const legacyKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!legacyKey)
    throw new Error("Supabase sunucu anahtarı yapılandırılmamış.");
  return legacyKey;
}

const admin = createClient(SUPABASE_URL, readAdminKey(), {
  auth: { autoRefreshToken: false, persistSession: false },
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info, mcp-protocol-version, mcp-session-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200, extraHeaders: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

function html(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function rpcResult(id: JsonRpcRequest["id"], result: unknown) {
  return json({ jsonrpc: "2.0", id: id ?? null, result });
}

function rpcError(
  id: JsonRpcRequest["id"],
  code: number,
  message: string,
  status = 200,
) {
  return json(
    { jsonrpc: "2.0", id: id ?? null, error: { code, message } },
    status,
  );
}

function unauthorized(message = "Oturum gerekli") {
  return json({ error: message }, 401, {
    "WWW-Authenticate": `Bearer resource_metadata="${RESOURCE_METADATA_URL}", scope="openid email profile"`,
  });
}

function safeError(error: unknown) {
  if (!(error instanceof Error)) return "İşlem başarısız.";
  return error.message
    .replace(/ya29\.[A-Za-z0-9._-]+/g, "[gizlendi]")
    .slice(0, 500);
}

function requireText(value: unknown, label: string, maxLength = 200) {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${label} zorunludur.`);
  const result = value.trim();
  if (result.length > maxLength)
    throw new Error(`${label} en fazla ${maxLength} karakter olabilir.`);
  return result;
}

function requireNesEmail(value: unknown, label: string) {
  const email = requireText(value, label, 254).toLowerCase();
  if (!/^[^\s@]+@nesgrup\.com$/.test(email))
    throw new Error(`${label} @nesgrup.com adresi olmalıdır.`);
  return email;
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function randomToken(size = 32) {
  return base64Url(crypto.getRandomValues(new Uint8Array(size)));
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return base64Url(new Uint8Array(digest));
}

async function authenticate(req: Request): Promise<Actor | null> {
  const header = req.headers.get("Authorization") ?? "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  const email = data.user.email?.trim().toLowerCase() ?? "";
  if (!email.endsWith("@nesgrup.com"))
    return { user: data.user, isAdmin: false };

  const { data: roles, error: roleError } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", data.user.id)
    .eq("role", "admin");

  return { user: data.user, isAdmin: !roleError && Boolean(roles?.length) };
}

async function getCredentials(
  ownerUserId: string,
): Promise<GoogleCredentials | null> {
  const { data, error } = await admin.rpc("get_google_workspace_credentials", {
    target_user_id: ownerUserId,
  });
  if (error) throw new Error("Google bağlantısı okunamadı.");
  return (data?.[0] as GoogleCredentials | undefined) ?? null;
}

async function saveCredentials(
  ownerUserId: string,
  googleEmail: string,
  scopes: string[],
  accessToken: string,
  refreshToken: string,
  expiresAt: string,
) {
  const { error } = await admin.rpc("save_google_workspace_connection", {
    target_user_id: ownerUserId,
    target_google_email: googleEmail,
    target_scopes: scopes,
    target_access_token: accessToken,
    target_refresh_token: refreshToken,
    target_expires_at: expiresAt,
  });
  if (error) throw new Error("Google bağlantısı güvenli kasaya kaydedilemedi.");
}

async function googleAccessToken(ownerUserId: string) {
  const credentials = await getCredentials(ownerUserId);
  if (!credentials)
    throw new Error(
      "Google Workspace bağlantısı yok. Önce start_google_workspace_connection aracını çalıştırın.",
    );
  const expiresAt = credentials.expires_at
    ? new Date(credentials.expires_at).getTime()
    : 0;
  if (expiresAt > Date.now() + 90_000) return credentials.access_token;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error("Google OAuth sunucu ayarları tamamlanmamış.");
  }
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: credentials.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok || typeof payload.access_token !== "string") {
    throw new Error(
      "Google oturumu yenilenemedi; bağlantıyı yeniden onaylayın.",
    );
  }
  const nextExpiry = new Date(
    Date.now() + Number(payload.expires_in ?? 3600) * 1000,
  ).toISOString();
  await saveCredentials(
    ownerUserId,
    credentials.google_email,
    credentials.scopes,
    payload.access_token,
    "",
    nextExpiry,
  );
  return payload.access_token;
}

async function googleFetch<T>(
  ownerUserId: string,
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const accessToken = await googleAccessToken(ownerUserId);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(url, { ...init, headers });
  const payload = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    const googleMessage = (payload.error as { message?: string } | undefined)
      ?.message;
    throw new Error(
      googleMessage
        ? `Google: ${googleMessage}`
        : `Google isteği başarısız (${response.status}).`,
    );
  }
  return payload as T;
}

async function rememberResource(
  ownerUserId: string,
  key: string,
  id: string,
  type: "drive" | "folder" | "calendar",
  name: string,
  metadata: Record<string, unknown> = {},
) {
  const { error } = await admin.from("google_workspace_resources").upsert(
    {
      owner_user_id: ownerUserId,
      resource_key: key,
      resource_id: id,
      resource_type: type,
      resource_name: name,
      metadata,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "owner_user_id,resource_key" },
  );
  if (error) throw new Error("Workspace kaynak kaydı güncellenemedi.");
}

async function rememberedResource(ownerUserId: string, key: string) {
  const { data } = await admin
    .from("google_workspace_resources")
    .select("resource_id,resource_name,resource_type,metadata")
    .eq("owner_user_id", ownerUserId)
    .eq("resource_key", key)
    .maybeSingle();
  return data;
}

async function findDrive(ownerUserId: string, name: string) {
  const q = encodeURIComponent(`name = '${name.replace(/'/g, "\\'")}'`);
  const result = await googleFetch<{
    drives?: Array<{ id: string; name: string }>;
  }>(
    ownerUserId,
    `https://www.googleapis.com/drive/v3/drives?q=${q}&pageSize=100&useDomainAdminAccess=true`,
  );
  return result.drives?.find((drive) => drive.name === name) ?? null;
}

async function ensureDrive(ownerUserId: string, key: string, name: string) {
  const saved = await rememberedResource(ownerUserId, key);
  if (saved?.resource_id)
    return { id: saved.resource_id, name, created: false };
  const existing = await findDrive(ownerUserId, name);
  if (existing) {
    await rememberResource(ownerUserId, key, existing.id, "drive", name);
    return { ...existing, created: false };
  }
  const requestId = crypto.randomUUID();
  const created = await googleFetch<{ id: string; name: string }>(
    ownerUserId,
    `https://www.googleapis.com/drive/v3/drives?requestId=${requestId}`,
    { method: "POST", body: JSON.stringify({ name }) },
  );
  await rememberResource(ownerUserId, key, created.id, "drive", name);
  return { ...created, created: true };
}

async function findFolder(ownerUserId: string, parentId: string, name: string) {
  const escaped = name.replace(/'/g, "\\'");
  const q = encodeURIComponent(
    `'${parentId}' in parents and name = '${escaped}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
  );
  const result = await googleFetch<{
    files?: Array<{ id: string; name: string }>;
  }>(
    ownerUserId,
    `https://www.googleapis.com/drive/v3/files?q=${q}&corpora=allDrives&includeItemsFromAllDrives=true&supportsAllDrives=true&pageSize=20&fields=files(id,name)`,
  );
  return result.files?.find((file) => file.name === name) ?? null;
}

async function ensureFolder(
  ownerUserId: string,
  parentId: string,
  name: string,
) {
  const existing = await findFolder(ownerUserId, parentId, name);
  if (existing) return { ...existing, created: false };
  const created = await googleFetch<{ id: string; name: string }>(
    ownerUserId,
    "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name",
    {
      method: "POST",
      body: JSON.stringify({
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentId],
      }),
    },
  );
  return { ...created, created: true };
}

async function ensureFolders(
  ownerUserId: string,
  parentId: string,
  names: string[],
) {
  const results = [];
  for (const name of names)
    results.push(await ensureFolder(ownerUserId, parentId, name));
  return results;
}

async function ensurePermission(
  ownerUserId: string,
  driveId: string,
  email: string,
  role: "organizer" | "fileOrganizer",
) {
  const result = await googleFetch<{
    permissions?: Array<{ id: string; emailAddress?: string; role: string }>;
  }>(
    ownerUserId,
    `https://www.googleapis.com/drive/v3/files/${driveId}/permissions?supportsAllDrives=true&useDomainAdminAccess=true&fields=permissions(id,emailAddress,role)&pageSize=100`,
  );
  const existing = result.permissions?.find(
    (item) => item.emailAddress?.toLowerCase() === email,
  );
  if (existing?.role === role)
    return { id: existing.id, email, role, changed: false };
  if (existing) {
    await googleFetch(
      ownerUserId,
      `https://www.googleapis.com/drive/v3/files/${driveId}/permissions/${existing.id}?supportsAllDrives=true&useDomainAdminAccess=true`,
      { method: "PATCH", body: JSON.stringify({ role }) },
    );
    return { id: existing.id, email, role, changed: true };
  }
  const created = await googleFetch<{ id: string }>(
    ownerUserId,
    `https://www.googleapis.com/drive/v3/files/${driveId}/permissions?supportsAllDrives=true&useDomainAdminAccess=true&sendNotificationEmail=false&fields=id`,
    {
      method: "POST",
      body: JSON.stringify({ type: "user", role, emailAddress: email }),
    },
  );
  return { id: created.id, email, role, changed: true };
}

async function startGoogleConnection(actor: Actor) {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error("Google OAuth istemci ayarları henüz sunucuya eklenmemiş.");
  }
  const state = randomToken(32);
  const codeVerifier = randomToken(64);
  const codeChallenge = await sha256(codeVerifier);
  const stateHash = await sha256(state);
  const { error } = await admin.from("google_workspace_oauth_states").insert({
    state_hash: stateHash,
    owner_user_id: actor.user.id,
    code_verifier: codeVerifier,
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  if (error) throw new Error("Google bağlantı isteği başlatılamadı.");

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    hd: "nesgrup.com",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  }).toString();
  return {
    success: true,
    authorization_url: url.toString(),
    expires_in_minutes: 10,
    message: "Bağlantıyı tamamlamak için Google onay bağlantısını açın.",
  };
}

async function handleGoogleCallback(url: URL) {
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  const googleError = url.searchParams.get("error");
  if (googleError)
    return html(`<h1>Bağlantı iptal edildi</h1><p>${googleError}</p>`, 400);
  if (!state || !code) return html("<h1>Geçersiz Google dönüşü</h1>", 400);

  const stateHash = await sha256(state);
  const { data: oauthState, error: stateError } = await admin
    .from("google_workspace_oauth_states")
    .select("owner_user_id,code_verifier,expires_at,consumed_at")
    .eq("state_hash", stateHash)
    .maybeSingle();
  if (
    stateError ||
    !oauthState ||
    oauthState.consumed_at ||
    new Date(oauthState.expires_at).getTime() < Date.now()
  ) {
    return html(
      "<h1>Bağlantı isteğinin süresi dolmuş</h1><p>Sohbetten yeniden başlatın.</p>",
      400,
    );
  }

  await admin
    .from("google_workspace_oauth_states")
    .update({ consumed_at: new Date().toISOString() })
    .eq("state_hash", stateHash)
    .is("consumed_at", null);

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      code,
      code_verifier: oauthState.code_verifier,
      grant_type: "authorization_code",
      redirect_uri: GOOGLE_REDIRECT_URI,
    }),
  });
  const token = (await tokenResponse.json()) as Record<string, unknown>;
  if (!tokenResponse.ok || typeof token.access_token !== "string") {
    return html(
      "<h1>Google bağlantısı tamamlanamadı</h1><p>Sohbetten yeniden deneyin.</p>",
      400,
    );
  }

  const userInfoResponse = await fetch(
    "https://openidconnect.googleapis.com/v1/userinfo",
    {
      headers: { Authorization: `Bearer ${token.access_token}` },
    },
  );
  const userInfo = (await userInfoResponse.json()) as {
    email?: string;
    email_verified?: boolean;
  };
  const email = userInfo.email?.toLowerCase() ?? "";
  if (
    !userInfoResponse.ok ||
    !userInfo.email_verified ||
    !email.endsWith("@nesgrup.com")
  ) {
    return html(
      "<h1>Kurumsal hesap gerekli</h1><p>Yalnızca @nesgrup.com hesabı bağlanabilir.</p>",
      403,
    );
  }
  const { data: ownerResult } = await admin.auth.admin.getUserById(
    oauthState.owner_user_id,
  );
  const ownerEmail = ownerResult.user?.email?.trim().toLowerCase() ?? "";
  if (!ownerEmail || ownerEmail !== email) {
    return html(
      "<h1>Hesaplar eşleşmiyor</h1><p>Google onayı, NES uygulamasında giriş yapılan aynı kurumsal hesapla verilmelidir.</p>",
      403,
    );
  }

  const scopes =
    typeof token.scope === "string"
      ? token.scope.split(" ").filter(Boolean)
      : GOOGLE_SCOPES;
  const expiresAt = new Date(
    Date.now() + Number(token.expires_in ?? 3600) * 1000,
  ).toISOString();
  try {
    await saveCredentials(
      oauthState.owner_user_id,
      email,
      scopes,
      token.access_token,
      typeof token.refresh_token === "string" ? token.refresh_token : "",
      expiresAt,
    );
  } catch {
    return html(
      "<h1>Bağlantı güvenli biçimde kaydedilemedi</h1><p>Sohbetten yeniden deneyin.</p>",
      500,
    );
  }

  return html(
    `<!doctype html><html lang="tr"><meta charset="utf-8"><title>NES Google bağlantısı</title><body style="font-family:system-ui;max-width:620px;margin:80px auto;padding:24px"><h1>Google Workspace bağlandı</h1><p><strong>${email}</strong> hesabı güvenli biçimde bağlandı. Bu pencereyi kapatıp sohbete dönebilirsin.</p></body></html>`,
  );
}

async function workspaceStatus(actor: Actor) {
  const [{ data: connection }, { data: resources }] = await Promise.all([
    admin
      .from("google_workspace_connections")
      .select("google_email,scopes,expires_at,connected_at,updated_at")
      .eq("owner_user_id", actor.user.id)
      .maybeSingle(),
    admin
      .from("google_workspace_resources")
      .select("resource_key,resource_id,resource_name,resource_type,updated_at")
      .eq("owner_user_id", actor.user.id)
      .order("resource_key"),
  ]);
  return {
    connected: Boolean(connection),
    oauth_server_configured: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET),
    google_account: connection?.google_email ?? null,
    scopes: connection?.scopes ?? [],
    token_expires_at: connection?.expires_at ?? null,
    resources: resources ?? [],
    operations_drive_id: OPERATIONS_DRIVE_ID,
  };
}

async function workspaceCandidates() {
  const { data: roleRows, error } = await admin
    .from("user_roles")
    .select("user_id,role")
    .in("role", ["admin", "technical_office"]);
  if (error) throw new Error("NES yönetici listesi alınamadı.");
  const userIds = [...new Set((roleRows ?? []).map((row) => row.user_id))];
  if (!userIds.length) return [];
  const { data: profiles } = await admin
    .from("profiles")
    .select("id,full_name")
    .in("id", userIds);
  const profileMap = new Map(
    (profiles ?? []).map((profile) => [profile.id, profile.full_name]),
  );
  const candidates = [];
  for (const roleRow of roleRows ?? []) {
    const { data } = await admin.auth.admin.getUserById(roleRow.user_id);
    const email = data.user?.email?.toLowerCase() ?? "";
    if (email.endsWith("@nesgrup.com")) {
      candidates.push({
        user_id: roleRow.user_id,
        full_name: profileMap.get(roleRow.user_id) ?? "",
        email,
        app_role: roleRow.role,
      });
    }
  }
  return candidates;
}

async function listWorkspaceCandidates() {
  return { candidates: await workspaceCandidates() };
}

async function initializeNesWorkspace(actor: Actor, rawArguments: unknown) {
  const args = (rawArguments ?? {}) as Record<string, unknown>;
  const secondAdminEmail = requireNesEmail(
    args.second_admin_email,
    "İkinci yönetici e-postası",
  );
  const operationsManagerEmail = requireNesEmail(
    args.operations_manager_email,
    "Operasyon yöneticisi e-postası",
  );
  const actorEmail = requireNesEmail(
    actor.user.email,
    "Bağlı yönetici e-postası",
  );
  const candidates = await workspaceCandidates();
  const secondAdmin = candidates.find(
    (candidate) =>
      candidate.email === secondAdminEmail && candidate.app_role === "admin",
  );
  const operationsManager = candidates.find(
    (candidate) => candidate.email === operationsManagerEmail,
  );
  if (!secondAdmin) {
    throw new Error(
      "İkinci yönetici e-postası NES uygulamasında admin rolüne bağlı olmalıdır.",
    );
  }
  if (!operationsManager || operationsManager.app_role !== "technical_office") {
    throw new Error(
      "Operasyon yöneticisi e-postası NES uygulamasında teknik ofis rolüne bağlı olmalıdır.",
    );
  }

  await rememberResource(
    actor.user.id,
    "operations_drive",
    OPERATIONS_DRIVE_ID,
    "drive",
    "NES Operasyon",
  );
  const finance = await ensureDrive(
    actor.user.id,
    "finance_drive",
    "NES Yönetim ve Finans",
  );
  const operationFolders = await ensureFolders(
    actor.user.id,
    OPERATIONS_DRIVE_ID,
    OPERATIONS_ROOT_FOLDERS,
  );
  const financeFolders = await ensureFolders(
    actor.user.id,
    finance.id,
    FINANCE_ROOT_FOLDERS,
  );

  for (const folder of operationFolders) {
    const key = `operations_root:${folder.name}`;
    await rememberResource(
      actor.user.id,
      key,
      folder.id,
      "folder",
      folder.name,
      { parent_id: OPERATIONS_DRIVE_ID },
    );
  }
  for (const folder of financeFolders) {
    const key = `finance_root:${folder.name}`;
    await rememberResource(
      actor.user.id,
      key,
      folder.id,
      "folder",
      folder.name,
      { parent_id: finance.id },
    );
  }

  const permissions = [
    await ensurePermission(
      actor.user.id,
      OPERATIONS_DRIVE_ID,
      actorEmail,
      "organizer",
    ),
    await ensurePermission(
      actor.user.id,
      OPERATIONS_DRIVE_ID,
      secondAdminEmail,
      "organizer",
    ),
    await ensurePermission(
      actor.user.id,
      OPERATIONS_DRIVE_ID,
      operationsManagerEmail,
      "fileOrganizer",
    ),
    await ensurePermission(actor.user.id, finance.id, actorEmail, "organizer"),
    await ensurePermission(
      actor.user.id,
      finance.id,
      secondAdminEmail,
      "organizer",
    ),
  ];

  return {
    success: true,
    operations_drive: {
      id: OPERATIONS_DRIVE_ID,
      folders: operationFolders.length,
    },
    finance_drive: {
      id: finance.id,
      name: finance.name,
      created: finance.created,
      folders: financeFolders.length,
    },
    permissions,
    note: "Operasyon yöneticisine finans sürücüsünde yetki verilmedi.",
  };
}

async function ensureWorkspaceMember(actor: Actor, rawArguments: unknown) {
  const args = (rawArguments ?? {}) as Record<string, unknown>;
  const drive = args.drive;
  if (drive !== "operations" && drive !== "finance") {
    throw new Error("Drive operations veya finance olmalıdır.");
  }
  const email = requireNesEmail(args.email, "Üye e-postası");
  const candidates = await workspaceCandidates();
  const candidate = candidates.find((item) => item.email === email);
  if (!candidate) {
    throw new Error(
      "Bu hesap NES uygulamasında yönetici veya teknik ofis rolüne bağlı değil.",
    );
  }
  if (drive === "finance" && candidate.app_role !== "admin") {
    throw new Error("Finans Drive'ına yalnız NES yöneticisi eklenebilir.");
  }

  const role = candidate.app_role === "admin" ? "organizer" : "fileOrganizer";
  const driveId =
    drive === "operations"
      ? OPERATIONS_DRIVE_ID
      : (
          await ensureDrive(
            actor.user.id,
            "finance_drive",
            "NES Yönetim ve Finans",
          )
        ).id;
  const permission = await ensurePermission(
    actor.user.id,
    driveId,
    email,
    role,
  );
  return {
    success: true,
    drive,
    drive_id: driveId,
    member: {
      email,
      app_role: candidate.app_role,
      google_role: role,
      changed: permission.changed,
    },
  };
}

async function createProjectWorkspace(actor: Actor, rawArguments: unknown) {
  const args = (rawArguments ?? {}) as Record<string, unknown>;
  const projectId = requireText(args.project_id, "Proje kimliği", 36);
  if (!/^[0-9a-f-]{36}$/i.test(projectId))
    throw new Error("Geçerli bir proje kimliği girin.");

  const { data: existingLink } = await admin
    .from("project_workspace_links")
    .select("operations_folder_id,finance_folder_id")
    .eq("project_id", projectId)
    .maybeSingle();
  if (existingLink) return { success: true, created: false, ...existingLink };

  const { data: project, error } = await admin
    .from("projects")
    .select("id,project_no,name")
    .eq("id", projectId)
    .maybeSingle();
  if (error || !project) throw new Error("Proje bulunamadı.");

  const activeRoot = await ensureFolder(
    actor.user.id,
    OPERATIONS_DRIVE_ID,
    "01 Aktif Projeler",
  );
  const finance = await ensureDrive(
    actor.user.id,
    "finance_drive",
    "NES Yönetim ve Finans",
  );
  const financeRoot = await ensureFolder(
    actor.user.id,
    finance.id,
    "09_Operasyon & Proje Yönetimi",
  );
  const projectName = `${project.project_no} - ${project.name}`.slice(0, 180);
  const operationsProject = await ensureFolder(
    actor.user.id,
    activeRoot.id,
    projectName,
  );
  const financeProject = await ensureFolder(
    actor.user.id,
    financeRoot.id,
    projectName,
  );
  const operationsFolders = await ensureFolders(
    actor.user.id,
    operationsProject.id,
    PROJECT_OPERATIONS_FOLDERS,
  );
  const financeFolder = await ensureFolder(
    actor.user.id,
    financeProject.id,
    "07 Yönetim ve Finans",
  );

  const { error: linkError } = await admin
    .from("project_workspace_links")
    .upsert(
      {
        project_id: projectId,
        owner_user_id: actor.user.id,
        operations_folder_id: operationsProject.id,
        finance_folder_id: financeProject.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "project_id" },
    );
  if (linkError) throw new Error("Proje klasör bağlantısı kaydedilemedi.");

  return {
    success: true,
    created: operationsProject.created || financeProject.created,
    project_id: projectId,
    project_name: projectName,
    operations_folder_id: operationsProject.id,
    finance_folder_id: financeProject.id,
    operations_subfolders: operationsFolders.map((folder) => ({
      id: folder.id,
      name: folder.name,
    })),
    finance_subfolder: { id: financeFolder.id, name: financeFolder.name },
  };
}

async function createCalendarEvent(actor: Actor, rawArguments: unknown) {
  const args = (rawArguments ?? {}) as Record<string, unknown>;
  const summary = requireText(args.summary, "Etkinlik başlığı", 180);
  const start = requireText(args.start, "Başlangıç", 40);
  const end = requireText(args.end, "Bitiş", 40);
  if (
    Number.isNaN(Date.parse(start)) ||
    Number.isNaN(Date.parse(end)) ||
    Date.parse(end) <= Date.parse(start)
  ) {
    throw new Error(
      "Başlangıç ve bitiş geçerli ISO tarih-saat olmalı; bitiş başlangıçtan sonra olmalıdır.",
    );
  }
  const attendees = Array.isArray(args.attendees)
    ? args.attendees.map((email, index) => ({
        email: requireNesEmail(email, `Katılımcı ${index + 1}`),
      }))
    : [];
  const calendarId =
    typeof args.calendar_id === "string" && args.calendar_id.trim()
      ? args.calendar_id.trim()
      : "primary";
  const event = await googleFetch<{
    id: string;
    htmlLink?: string;
    status?: string;
  }>(
    actor.user.id,
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=all`,
    {
      method: "POST",
      body: JSON.stringify({
        summary,
        description:
          typeof args.description === "string"
            ? args.description.slice(0, 5000)
            : undefined,
        location:
          typeof args.location === "string"
            ? args.location.slice(0, 500)
            : undefined,
        start: { dateTime: start, timeZone: "Europe/Istanbul" },
        end: { dateTime: end, timeZone: "Europe/Istanbul" },
        attendees,
      }),
    },
  );
  return {
    success: true,
    event_id: event.id,
    event_url: event.htmlLink,
    status: event.status,
  };
}

async function writeAudit(
  actorUserId: string,
  requestId: string,
  toolName: string,
  outcome: "success" | "failed",
  inputSummary: Record<string, unknown>,
  targetResourceId?: string,
  errorCode?: string,
) {
  await admin.from("google_workspace_operation_audit").insert({
    request_id: requestId,
    actor_user_id: actorUserId,
    tool_name: toolName,
    target_resource_id: targetResourceId ?? null,
    input_summary: inputSummary,
    outcome,
    error_code: errorCode ?? null,
  });
}

const tools = [
  {
    name: "get_google_workspace_status",
    title: "Google Workspace bağlantı durumunu göster",
    description:
      "NES Google Workspace bağlantısını ve kayıtlı Drive kaynaklarını salt okunur olarak gösterir.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "start_google_workspace_connection",
    title: "Google Workspace bağlantısını başlat",
    description:
      "Mehmet'in @nesgrup.com Google hesabını güvenli OAuth ekranında bir kez bağlamak için süreli bir onay bağlantısı üretir.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  {
    name: "list_nes_workspace_candidates",
    title: "Workspace yetki adaylarını listele",
    description:
      "NES uygulamasındaki yönetici ve teknik ofis hesaplarının kurumsal e-posta adreslerini salt okunur olarak listeler.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "initialize_nes_workspace",
    title: "NES Drive yapısını kur",
    description:
      "NES Operasyon ve NES Yönetim ve Finans Ortak Drive yapılarını ve rol tabanlı erişimleri idempotent biçimde kurar. Yazma işlemidir; çalıştırılmadan hemen önce açık onay gerekir.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        second_admin_email: {
          type: "string",
          format: "email",
          description:
            "Enes'in @nesgrup.com adresi; iki Drive'da yönetici olur.",
        },
        operations_manager_email: {
          type: "string",
          format: "email",
          description:
            "Aslı'nın @nesgrup.com adresi; yalnız NES Operasyon'da içerik yöneticisi olur.",
        },
      },
      required: ["second_admin_email", "operations_manager_email"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: "create_project_workspace",
    title: "Proje Drive klasörlerini oluştur",
    description:
      "NES uygulamasındaki bir proje için Operasyon ve Finans Drive'larında standart klasörleri idempotent biçimde oluşturur. Yazma işlemidir; çalıştırılmadan hemen önce açık onay gerekir.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        project_id: {
          type: "string",
          format: "uuid",
          description: "NES uygulamasındaki proje kimliği",
        },
      },
      required: ["project_id"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: "ensure_nes_workspace_member",
    title: "NES Drive üyesini yetkilendir",
    description:
      "NES uygulamasındaki admin hesabını seçilen Drive'da yönetici; teknik ofis hesabını yalnız Operasyon Drive'ında içerik yöneticisi yapar. Taşeron, müşteri veya teknik ofis hesabına Finans erişimi vermez. Yazma işlemidir; çalıştırılmadan hemen önce açık onay gerekir.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        drive: {
          type: "string",
          enum: ["operations", "finance"],
          description: "Yetkinin verileceği NES Ortak Drive",
        },
        email: {
          type: "string",
          format: "email",
          description: "NES uygulamasında kayıtlı @nesgrup.com hesabı",
        },
      },
      required: ["drive", "email"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: "create_nes_calendar_event",
    title: "NES takvim etkinliği oluştur",
    description:
      "Google Calendar'da Europe/Istanbul saat diliminde etkinlik oluşturur ve kurumsal katılımcılara davet yollar. Yazma işlemidir; çalıştırılmadan hemen önce açık onay gerekir.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        summary: { type: "string", minLength: 1, maxLength: 180 },
        start: { type: "string", format: "date-time" },
        end: { type: "string", format: "date-time" },
        description: { type: "string", maxLength: 5000 },
        location: { type: "string", maxLength: 500 },
        attendees: {
          type: "array",
          items: { type: "string", format: "email" },
          maxItems: 50,
        },
        calendar_id: { type: "string", description: "Varsayılan: primary" },
      },
      required: ["summary", "start", "end"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: corsHeaders });
  const url = new URL(req.url);

  if (url.pathname.endsWith("/google/callback"))
    return await handleGoogleCallback(url);
  if (url.pathname.endsWith("/.well-known/oauth-protected-resource")) {
    return json({
      resource: FUNCTION_URL,
      authorization_servers: [AUTH_SERVER_URL],
      bearer_methods_supported: ["header"],
      scopes_supported: ["openid", "email", "profile"],
    });
  }
  if (req.method !== "POST") return json({ error: "POST kullanın." }, 405);

  const actor = await authenticate(req);
  if (!actor) return unauthorized();
  if (!actor.isAdmin)
    return json(
      { error: "Bu bağlantı yalnızca NES yöneticileri içindir." },
      403,
    );

  let request: JsonRpcRequest;
  try {
    request = await req.json();
  } catch {
    return rpcError(null, -32700, "Geçersiz JSON", 400);
  }
  if (request.jsonrpc !== "2.0")
    return rpcError(request.id, -32600, "Geçersiz JSON-RPC isteği");
  if (request.method === "initialize") {
    return rpcResult(request.id, {
      protocolVersion: "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "NES Google Workspace Yönetimi", version: "1.0.0" },
    });
  }
  if (request.method === "notifications/initialized") {
    return new Response(null, { status: 202, headers: corsHeaders });
  }
  if (request.method === "ping") return rpcResult(request.id, {});
  if (request.method === "tools/list") return rpcResult(request.id, { tools });
  if (request.method !== "tools/call")
    return rpcError(request.id, -32601, "Yöntem bulunamadı");

  const params = request.params ?? {};
  const toolName = typeof params.name === "string" ? params.name : "";
  if (!tools.some((tool) => tool.name === toolName))
    return rpcError(request.id, -32602, "Bilinmeyen araç");

  const requestId = crypto.randomUUID();
  const inputSummary =
    toolName === "create_nes_calendar_event"
      ? {
          summary: (params.arguments as Record<string, unknown> | undefined)
            ?.summary,
        }
      : {};
  try {
    const result =
      toolName === "get_google_workspace_status"
        ? await workspaceStatus(actor)
        : toolName === "start_google_workspace_connection"
          ? await startGoogleConnection(actor)
          : toolName === "list_nes_workspace_candidates"
            ? await listWorkspaceCandidates()
            : toolName === "initialize_nes_workspace"
              ? await initializeNesWorkspace(actor, params.arguments)
              : toolName === "ensure_nes_workspace_member"
                ? await ensureWorkspaceMember(actor, params.arguments)
                : toolName === "create_project_workspace"
                  ? await createProjectWorkspace(actor, params.arguments)
                  : await createCalendarEvent(actor, params.arguments);
    if (!(
      toolName === "get_google_workspace_status" ||
      toolName === "list_nes_workspace_candidates"
    )) {
      await writeAudit(
        actor.user.id,
        requestId,
        toolName,
        "success",
        inputSummary,
      );
    }
    return rpcResult(request.id, {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
      isError: false,
    });
  } catch (error) {
    const message = safeError(error);
    if (!(
      toolName === "get_google_workspace_status" ||
      toolName === "list_nes_workspace_candidates"
    )) {
      await writeAudit(
        actor.user.id,
        requestId,
        toolName,
        "failed",
        inputSummary,
        undefined,
        "operation_failed",
      );
    }
    return rpcResult(request.id, {
      content: [{ type: "text", text: message }],
      structuredContent: { success: false, error: message },
      isError: true,
    });
  }
});

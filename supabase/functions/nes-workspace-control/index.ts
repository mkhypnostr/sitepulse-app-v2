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
  canManageProjects: boolean;
};

type GoogleCredentials = {
  google_email: string;
  scopes: string[];
  access_token: string;
  refresh_token: string;
  expires_at: string | null;
};

type DriveItem = {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  driveId?: string;
};

type DrivePermission = {
  id: string;
  type?: string;
  emailAddress?: string;
  role?: string;
  permissionDetails?: Array<{
    inherited?: boolean;
    inheritedFrom?: string;
  }>;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/nes-workspace-control`;
const RESOURCE_METADATA_URL = `${FUNCTION_URL}/.well-known/oauth-protected-resource`;
const AUTH_SERVER_URL = `${SUPABASE_URL}/auth/v1`;
type GoogleOAuthClientConfig = {
  client_id: string;
  client_secret: string;
  redirect_uri: string;
};

const GOOGLE_REDIRECT_URI_FALLBACK =
  Deno.env.get("GOOGLE_WORKSPACE_REDIRECT_URI") ||
  `${FUNCTION_URL}/google/callback`;
let googleOAuthClientConfigCache: GoogleOAuthClientConfig | null = null;
const OPERATIONS_DRIVE_ID =
  Deno.env.get("NES_OPERATIONS_DRIVE_ID") || "0ANT5zef2P9oDUk9PVA";
const WORKSPACE_OWNER_EMAIL = (
  Deno.env.get("NES_WORKSPACE_OWNER_EMAIL") || "mehmet.kilinckaya@nesgrup.com"
).toLowerCase();
const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/calendar.events",
];

const OPERATIONS_ROOT_FOLDERS = [
  "01 Projeler",
  "02 Merkezi Stok, Ekipman ve Lojistik",
  "03 Ortak Teknik Kütüphane ve Şablonlar",
  "04 Genel Operasyon ve Toplantılar",
  "99 Operasyon Arşivi",
];

const FINANCE_ROOT_FOLDERS = [
  "01 Faturalar ve Muhasebe",
  "02 Ödeme, Tahsilat ve Banka",
  "03 Bütçe, Maliyet ve Hakediş",
  "99 Mali Arşiv",
];

const LEGACY_NES_FOLDER_ID = "1YRO8CHplMssqsXdO_Ci_Ee52hHGubq3t";
const LEGACY_NES_FOLDER_NAME = "NES ENERJİ";
const LEGACY_MIGRATION_MAX_ITEMS = 5000;

type LegacyDestination =
  | "operations_projects"
  | "operations_stock"
  | "operations_library"
  | "operations_general"
  | "finance_invoices";

const LEGACY_NES_MIGRATION_MAP: Record<string, LegacyDestination> = {
  YANGINASON: "operations_projects",
  KATALOG: "operations_library",
  "BİLİRKİŞİ RAPOR": "operations_projects",
  "AYLIK TAKVİM.xlsx": "operations_general",
  AYDINLATMA: "operations_projects",
  İHALE: "operations_projects",
  GES: "operations_projects",
  "evrak-teslim-formu.xls": "operations_general",
  TAAHHÜT: "operations_projects",
  "ENERJİ KİMLİK BELGESİ": "operations_library",
  PROJE: "operations_projects",
  "EV CHARGE": "operations_projects",
  "ÖLÇÜM RAPORLAMA": "operations_projects",
  "TR İŞLETME SORUMLULUĞU": "operations_projects",
  "MALZEME TEKLİF": "operations_stock",
  "NES Enerji ABB Şarj İstasyon Fiyatlar.pdf": "operations_library",
  FATURA: "finance_invoices",
  "ŞİRKET BELGELERİ": "operations_library",
  "LOGO ÇALIŞMALARI": "operations_library",
};

const LEGACY_DESTINATION_LABELS: Record<LegacyDestination, string> = {
  operations_projects: "NES Operasyon / 01 Projeler",
  operations_stock: "NES Operasyon / 02 Merkezi Stok, Ekipman ve Lojistik",
  operations_library: "NES Operasyon / 03 Ortak Teknik Kütüphane ve Şablonlar",
  operations_general: "NES Operasyon / 04 Genel Operasyon ve Toplantılar",
  finance_invoices: "NES Yönetim ve Finans / 01 Faturalar ve Muhasebe",
};

const PROJECT_OPERATIONS_FOLDERS = [
  "01 Teklif ve Sözleşme",
  "02 Teknik Dokümanlar",
  "03 Saha Raporları ve Tutanaklar",
  "04 Fotoğraf ve Videolar",
  "05 Satın Alma ve Sevkiyat",
  "06 Proje Kapanışı",
];

const PROJECT_FINANCE_FOLDERS = ["01 Bütçe", "02 Maliyet", "03 Hakediş"];

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

async function getGoogleOAuthClientConfig(): Promise<GoogleOAuthClientConfig> {
  if (googleOAuthClientConfigCache) return googleOAuthClientConfigCache;

  const { data, error } = await admin.rpc(
    "get_google_workspace_oauth_client_credentials",
  );
  const row = Array.isArray(data) ? data[0] : data;
  if (
    !error &&
    row &&
    typeof row.client_id === "string" &&
    row.client_id &&
    typeof row.client_secret === "string" &&
    row.client_secret
  ) {
    googleOAuthClientConfigCache = {
      client_id: row.client_id,
      client_secret: row.client_secret,
      redirect_uri:
        typeof row.redirect_uri === "string" && row.redirect_uri
          ? row.redirect_uri
          : GOOGLE_REDIRECT_URI_FALLBACK,
    };
    return googleOAuthClientConfigCache;
  }

  const envClientId = Deno.env.get("GOOGLE_WORKSPACE_CLIENT_ID") ?? "";
  const envClientSecret = Deno.env.get("GOOGLE_WORKSPACE_CLIENT_SECRET") ?? "";
  if (envClientId && envClientSecret) {
    googleOAuthClientConfigCache = {
      client_id: envClientId,
      client_secret: envClientSecret,
      redirect_uri: GOOGLE_REDIRECT_URI_FALLBACK,
    };
    return googleOAuthClientConfigCache;
  }

  throw new Error("Google OAuth sunucu ayarları tamamlanmamış.");
}

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
    return { user: data.user, isAdmin: false, canManageProjects: false };

  const { data: roles, error: roleError } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", data.user.id)
    .in("role", ["admin", "technical_office"]);

  const roleNames = new Set((roles ?? []).map((item) => item.role));
  return {
    user: data.user,
    isAdmin: !roleError && roleNames.has("admin"),
    canManageProjects:
      !roleError &&
      (roleNames.has("admin") || roleNames.has("technical_office")),
  };
}

async function getWorkspaceOwnerUserId() {
  const { data: sharedConnection, error } = await admin
    .from("google_workspace_connections")
    .select("owner_user_id")
    .eq("google_email", WORKSPACE_OWNER_EMAIL)
    .maybeSingle();
  if (error || !sharedConnection?.owner_user_id) {
    throw new Error(
      "Kurumsal Google Workspace bağlantısı bulunamadı. Mehmet hesabının bağlantısını kontrol edin.",
    );
  }
  return sharedConnection.owner_user_id;
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

  const googleOAuth = await getGoogleOAuthClientConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: googleOAuth.client_id,
      client_secret: googleOAuth.client_secret,
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

async function getDriveItem(ownerUserId: string, fileId: string) {
  return await googleFetch<DriveItem>(
    ownerUserId,
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=id,name,mimeType,parents,driveId`,
  );
}

async function listDriveFolderChildren(ownerUserId: string, parentId: string) {
  const files: DriveItem[] = [];
  let pageToken = "";
  do {
    const q = encodeURIComponent(
      `'${parentId}' in parents and trashed = false`,
    );
    const pageTokenQuery = pageToken
      ? `&pageToken=${encodeURIComponent(pageToken)}`
      : "";
    const result = await googleFetch<{
      files?: DriveItem[];
      nextPageToken?: string;
    }>(
      ownerUserId,
      `https://www.googleapis.com/drive/v3/files?q=${q}&corpora=allDrives&includeItemsFromAllDrives=true&supportsAllDrives=true&pageSize=1000&fields=nextPageToken,files(id,name,mimeType,parents,driveId)${pageTokenQuery}`,
    );
    files.push(...(result.files ?? []));
    pageToken = result.nextPageToken ?? "";
    if (files.length > LEGACY_MIGRATION_MAX_ITEMS) {
      throw new Error(
        `Eski Drive'da ${LEGACY_MIGRATION_MAX_ITEMS} öğeden fazla içerik var; güvenli taşıma durduruldu.`,
      );
    }
  } while (pageToken);
  return files;
}

async function listDrivePermissions(ownerUserId: string, fileId: string) {
  const result = await googleFetch<{ permissions?: DrivePermission[] }>(
    ownerUserId,
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions?supportsAllDrives=true&useDomainAdminAccess=true&pageSize=100&fields=permissions(id,type,emailAddress,role,permissionDetails(inherited,inheritedFrom))`,
  );
  return result.permissions ?? [];
}

function isDirectPermission(permission: DrivePermission) {
  const details = permission.permissionDetails ?? [];
  return details.some((detail) => detail.inherited === false);
}

async function removeDirectPermissions(ownerUserId: string, fileId: string) {
  const permissions = await listDrivePermissions(ownerUserId, fileId);
  const directPermissions = permissions.filter(isDirectPermission);
  for (const permission of directPermissions) {
    await googleFetch(
      ownerUserId,
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(permission.id)}?supportsAllDrives=true&useDomainAdminAccess=true`,
      { method: "DELETE" },
    );
  }
  return directPermissions.length;
}

async function removeLegacyDirectPermissionsRecursively(
  ownerUserId: string,
  root: DriveItem,
) {
  const pending: DriveItem[] = [root];
  let inspected = 0;
  let removedPermissions = 0;

  while (pending.length) {
    const item = pending.pop()!;
    inspected += 1;
    if (inspected > LEGACY_MIGRATION_MAX_ITEMS) {
      throw new Error(
        `Bir taşıma dalında ${LEGACY_MIGRATION_MAX_ITEMS} öğeden fazla içerik var; güvenli taşıma durduruldu.`,
      );
    }
    removedPermissions += await removeDirectPermissions(ownerUserId, item.id);
    if (item.mimeType === "application/vnd.google-apps.folder") {
      pending.push(...(await listDriveFolderChildren(ownerUserId, item.id)));
    }
  }

  return { inspected, removed_permissions: removedPermissions };
}

async function moveLegacyItem(
  ownerUserId: string,
  source: DriveItem,
  destinationParentId: string,
  expectedDriveId: string,
) {
  const current = await getDriveItem(ownerUserId, source.id);
  const currentParents = current.parents ?? [];
  if (
    current.driveId === expectedDriveId &&
    currentParents.includes(destinationParentId)
  ) {
    return {
      id: current.id,
      name: current.name,
      moved: false,
      ...(await removeLegacyDirectPermissionsRecursively(ownerUserId, current)),
    };
  }
  if (!currentParents.includes(LEGACY_NES_FOLDER_ID)) {
    throw new Error(
      `${current.name} eski NES ana klasöründe değil; taşıma durduruldu.`,
    );
  }

  const moved = await googleFetch<DriveItem>(
    ownerUserId,
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(source.id)}?addParents=${encodeURIComponent(destinationParentId)}&removeParents=${encodeURIComponent(LEGACY_NES_FOLDER_ID)}&supportsAllDrives=true&fields=id,name,mimeType,parents,driveId`,
    { method: "PATCH", body: JSON.stringify({}) },
  );
  if (
    moved.driveId !== expectedDriveId ||
    !moved.parents?.includes(destinationParentId)
  ) {
    throw new Error(`${source.name} hedef Ortak Drive'a doğrulanamadı.`);
  }
  return {
    id: moved.id,
    name: moved.name,
    moved: true,
    ...(await removeLegacyDirectPermissionsRecursively(ownerUserId, moved)),
  };
}

async function legacyMigrationTargets(ownerUserId: string) {
  const finance = await ensureDrive(
    ownerUserId,
    "finance_drive",
    "NES Yönetim ve Finans",
  );
  const [projects, stock, library, general, invoices] = await Promise.all([
    ensureFolder(ownerUserId, OPERATIONS_DRIVE_ID, "01 Projeler"),
    ensureFolder(
      ownerUserId,
      OPERATIONS_DRIVE_ID,
      "02 Merkezi Stok, Ekipman ve Lojistik",
    ),
    ensureFolder(
      ownerUserId,
      OPERATIONS_DRIVE_ID,
      "03 Ortak Teknik Kütüphane ve Şablonlar",
    ),
    ensureFolder(
      ownerUserId,
      OPERATIONS_DRIVE_ID,
      "04 Genel Operasyon ve Toplantılar",
    ),
    ensureFolder(ownerUserId, finance.id, "01 Faturalar ve Muhasebe"),
  ]);
  return {
    operations_projects: {
      parentId: projects.id,
      driveId: OPERATIONS_DRIVE_ID,
    },
    operations_stock: { parentId: stock.id, driveId: OPERATIONS_DRIVE_ID },
    operations_library: { parentId: library.id, driveId: OPERATIONS_DRIVE_ID },
    operations_general: { parentId: general.id, driveId: OPERATIONS_DRIVE_ID },
    finance_invoices: { parentId: invoices.id, driveId: finance.id },
  } satisfies Record<LegacyDestination, { parentId: string; driveId: string }>;
}

async function migrateLegacyNesDrive(rawArguments: unknown) {
  const args = (rawArguments ?? {}) as Record<string, unknown>;
  const mode = args.mode ?? "preview";
  if (mode !== "preview" && mode !== "execute") {
    throw new Error("mode preview veya execute olmalıdır.");
  }
  const workspaceOwnerUserId = await getWorkspaceOwnerUserId();
  const sourceFolder = await getDriveItem(
    workspaceOwnerUserId,
    LEGACY_NES_FOLDER_ID,
  );
  if (
    sourceFolder.mimeType !== "application/vnd.google-apps.folder" ||
    sourceFolder.name !== LEGACY_NES_FOLDER_NAME
  ) {
    throw new Error("Eski NES Drive kaynağı doğrulanamadı.");
  }
  const sourceItems = await listDriveFolderChildren(
    workspaceOwnerUserId,
    LEGACY_NES_FOLDER_ID,
  );
  const unmapped = sourceItems.filter(
    (item) => !LEGACY_NES_MIGRATION_MAP[item.name],
  );
  const planned = sourceItems.map((item) => ({
    id: item.id,
    name: item.name,
    destination: LEGACY_NES_MIGRATION_MAP[item.name]
      ? LEGACY_DESTINATION_LABELS[LEGACY_NES_MIGRATION_MAP[item.name]]
      : null,
  }));
  if (unmapped.length) {
    return {
      success: false,
      mode,
      source_folder: LEGACY_NES_FOLDER_NAME,
      planned,
      unmapped: unmapped.map((item) => item.name),
      message:
        "Yeni veya eşleştirilmemiş öğeler bulundu; hiçbir öğe taşınmadı.",
    };
  }
  if (mode === "preview") {
    return {
      success: true,
      mode,
      source_folder: LEGACY_NES_FOLDER_NAME,
      item_count: planned.length,
      planned,
      message:
        "Onaydan sonra öğeler hedef Ortak Drive'lara taşınacak ve eski doğrudan yetkiler temizlenecek.",
    };
  }

  const targets = await legacyMigrationTargets(workspaceOwnerUserId);
  const migrated = [];
  for (const item of sourceItems) {
    const destination = LEGACY_NES_MIGRATION_MAP[item.name];
    migrated.push(
      await moveLegacyItem(
        workspaceOwnerUserId,
        item,
        targets[destination].parentId,
        targets[destination].driveId,
      ),
    );
  }
  return {
    success: true,
    mode,
    source_folder: LEGACY_NES_FOLDER_NAME,
    migrated_count: migrated.length,
    migrated,
    message:
      "Eski NES Drive içerikleri Ortak Drive'lara taşındı; doğrudan eski yetkiler temizlendi.",
  };
}

async function startGoogleConnection(actor: Actor) {
  const googleOAuth = await getGoogleOAuthClientConfig();
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
    client_id: googleOAuth.client_id,
    redirect_uri: googleOAuth.redirect_uri,
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
  const googleOAuth = await getGoogleOAuthClientConfig();
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

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: googleOAuth.client_id,
      client_secret: googleOAuth.client_secret,
      code,
      code_verifier: oauthState.code_verifier,
      grant_type: "authorization_code",
      redirect_uri: googleOAuth.redirect_uri,
    }),
  });
  const token = (await tokenResponse.json()) as Record<string, unknown>;
  if (!tokenResponse.ok || typeof token.access_token !== "string") {
    const googleErrorCode =
      typeof token.error === "string"
        ? token.error.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 80)
        : "token_exchange_failed";
    console.error("Google OAuth token exchange failed", {
      status: tokenResponse.status,
      error: googleErrorCode,
    });
    return html(
      `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Google bağlantı hatası</title></head><body><h1>Google bağlantısı tamamlanamadı</h1><p>Hata kodu: ${googleErrorCode}</p></body></html>`,
      400,
    );
  }

  const { data: consumedState, error: consumeError } = await admin
    .from("google_workspace_oauth_states")
    .update({ consumed_at: new Date().toISOString() })
    .eq("state_hash", stateHash)
    .is("consumed_at", null)
    .select("state_hash")
    .maybeSingle();
  if (consumeError || !consumedState) {
    return html(
      '<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Bağlantı isteği geçersiz</title></head><body><h1>Bağlantı isteği kullanılmış</h1><p>Yeni bir bağlantı başlatın.</p></body></html>',
      409,
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
  const googleOAuth = await getGoogleOAuthClientConfig();
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
  const visibleResources = actor.isAdmin
    ? (resources ?? [])
    : (resources ?? []).filter((resource) =>
        resource.resource_key.startsWith("operations_"),
      );
  return {
    connected: Boolean(connection),
    oauth_server_configured: Boolean(
      googleOAuth.client_id && googleOAuth.client_secret,
    ),
    google_account: connection?.google_email ?? null,
    scopes: connection?.scopes ?? [],
    token_expires_at: connection?.expires_at ?? null,
    resources: visibleResources,
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

async function createProjectWorkspace(rawArguments: unknown) {
  const args = (rawArguments ?? {}) as Record<string, unknown>;
  const projectId = requireText(args.project_id, "Proje kimliği", 36);
  if (!/^[0-9a-f-]{36}$/i.test(projectId))
    throw new Error("Geçerli bir proje kimliği girin.");

  const { data: existingLink } = await admin
    .from("project_workspace_links")
    .select("operations_folder_id,finance_folder_id")
    .eq("project_id", projectId)
    .maybeSingle();
  if (existingLink) {
    return {
      success: true,
      created: false,
      ...existingLink,
      operations_folder_url: `https://drive.google.com/drive/folders/${existingLink.operations_folder_id}`,
      finance_folder_url: existingLink.finance_folder_id
        ? `https://drive.google.com/drive/folders/${existingLink.finance_folder_id}`
        : null,
    };
  }

  const { data: project, error } = await admin
    .from("projects")
    .select("id,project_no,name")
    .eq("id", projectId)
    .maybeSingle();
  if (error || !project) throw new Error("Proje bulunamadı.");

  const workspaceOwnerUserId = await getWorkspaceOwnerUserId();

  const projectsRoot = await ensureFolder(
    workspaceOwnerUserId,
    OPERATIONS_DRIVE_ID,
    "01 Projeler",
  );
  const finance = await ensureDrive(
    workspaceOwnerUserId,
    "finance_drive",
    "NES Yönetim ve Finans",
  );
  const financeRoot = await ensureFolder(
    workspaceOwnerUserId,
    finance.id,
    "03 Bütçe, Maliyet ve Hakediş",
  );
  const projectName = `${project.project_no} - ${project.name}`.slice(0, 180);
  const operationsProject = await ensureFolder(
    workspaceOwnerUserId,
    projectsRoot.id,
    projectName,
  );
  const financeProject = await ensureFolder(
    workspaceOwnerUserId,
    financeRoot.id,
    projectName,
  );
  const operationsFolders = await ensureFolders(
    workspaceOwnerUserId,
    operationsProject.id,
    PROJECT_OPERATIONS_FOLDERS,
  );
  const financeFolders = await ensureFolders(
    workspaceOwnerUserId,
    financeProject.id,
    PROJECT_FINANCE_FOLDERS,
  );

  const { error: linkError } = await admin
    .from("project_workspace_links")
    .upsert(
      {
        project_id: projectId,
        owner_user_id: workspaceOwnerUserId,
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
    operations_folder_url: `https://drive.google.com/drive/folders/${operationsProject.id}`,
    finance_folder_url: `https://drive.google.com/drive/folders/${financeProject.id}`,
    operations_subfolders: operationsFolders.map((folder) => ({
      id: folder.id,
      name: folder.name,
    })),
    finance_subfolders: financeFolders.map((folder) => ({
      id: folder.id,
      name: folder.name,
    })),
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

const OAUTH_SECURITY_SCHEMES = [
  { type: "oauth2", scopes: ["openid", "email", "profile"] },
];

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
      "NES Operasyon'da 5, NES Yönetim ve Finans'ta yalnız parasal kayıtlar için 4 ana klasörü ve rol tabanlı erişimleri idempotent biçimde kurar. Yazma işlemidir; çalıştırılmadan hemen önce açık onay gerekir.",
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
      "NES uygulamasındaki proje için Operasyon merkezli standart klasörleri ve Finans Drive'ında yalnız bütçe, maliyet ve hakediş klasörlerini idempotent biçimde oluşturur. Yazma işlemidir; çalıştırılmadan hemen önce açık onay gerekir.",
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
    name: "migrate_legacy_nes_drive",
    title: "Eski NES Drive'ını güvenli taşı",
    description:
      "Eski NES ENERJİ klasöründeki doğrulanmış içerikleri Operasyon ve Finans Ortak Drive'larına taşır. FATURA yalnız Finans'a gider; taşıma sonrasında eski doğrudan kullanıcı yetkilerini kaldırır. preview salt okunurdur, execute yazma işlemidir ve açık onaydan hemen sonra çalıştırılmalıdır.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        mode: {
          type: "string",
          enum: ["preview", "execute"],
          description:
            "Önce preview ile listeyi doğrulayın; açık onaydan sonra execute kullanın.",
        },
      },
      required: ["mode"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
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

for (const tool of tools) {
  Object.assign(tool, {
    securitySchemes: OAUTH_SECURITY_SCHEMES,
    _meta: { securitySchemes: OAUTH_SECURITY_SCHEMES },
  });
}

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
      serverInfo: { name: "NES Google Workspace Yönetimi", version: "1.2.0" },
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

  const actor = await authenticate(req);
  if (!actor) {
    return rpcResult(request.id, {
      content: [
        { type: "text", text: "Bu işlem için NES hesabınızı bağlayın." },
      ],
      _meta: {
        "mcp/www_authenticate": [
          `Bearer resource_metadata="${RESOURCE_METADATA_URL}", error="invalid_token", error_description="NES hesabıyla oturum açmanız gerekiyor"`,
        ],
      },
      isError: true,
    });
  }
  const canCallTool =
    actor.isAdmin ||
    ((toolName === "create_project_workspace" ||
      toolName === "get_google_workspace_status") &&
      actor.canManageProjects);
  if (!canCallTool) {
    return rpcResult(request.id, {
      content: [
        {
          type: "text",
          text: "Bu işlem için NES yönetici yetkisi gerekir.",
        },
      ],
      structuredContent: {
        success: false,
        error: "Bu işlem için NES yönetici yetkisi gerekir.",
      },
      isError: true,
    });
  }

  const requestId = crypto.randomUUID();
  const inputSummary =
    toolName === "create_nes_calendar_event"
      ? {
          summary: (params.arguments as Record<string, unknown> | undefined)
            ?.summary,
        }
      : toolName === "migrate_legacy_nes_drive"
        ? {
            source_folder: LEGACY_NES_FOLDER_NAME,
            mode: (params.arguments as Record<string, unknown> | undefined)
              ?.mode,
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
                  ? await createProjectWorkspace(params.arguments)
                  : toolName === "migrate_legacy_nes_drive"
                    ? await migrateLegacyNesDrive(params.arguments)
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

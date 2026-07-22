import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.7";

type AppRole = "admin" | "contractor" | "customer";

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/nes-user-management`;
const RESOURCE_METADATA_URL = `${FUNCTION_URL}/.well-known/oauth-protected-resource`;
const AUTH_SERVER_URL = `${SUPABASE_URL}/auth/v1`;

function readAdminKey() {
  const secretKeysJson = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeysJson) {
    try {
      const secretKeys = JSON.parse(secretKeysJson) as Record<string, string>;
      if (secretKeys.default) return secretKeys.default;
    } catch {
      // Eski projelerde aşağıdaki geriye uyumlu anahtarı kullan.
    }
  }

  const legacyKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!legacyKey) throw new Error("Supabase sunucu anahtarı yapılandırılmamış.");
  return legacyKey;
}

const admin = createClient(SUPABASE_URL, readAdminKey(), {
  auth: { autoRefreshToken: false, persistSession: false },
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, content-type, mcp-protocol-version, mcp-session-id",
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

function rpcResult(id: JsonRpcRequest["id"], result: unknown) {
  return json({ jsonrpc: "2.0", id: id ?? null, result });
}

function rpcError(id: JsonRpcRequest["id"], code: number, message: string, status = 200) {
  return json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, status);
}

function unauthorized(message = "Oturum gerekli") {
  return json({ error: message }, 401, {
    "WWW-Authenticate": `Bearer resource_metadata="${RESOURCE_METADATA_URL}", scope="openid email profile"`,
  });
}

function normalizedEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

function validPassword(value: unknown) {
  if (typeof value !== "string" || value.length < 12 || value.length > 128) return false;
  return (
    /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9]/.test(value)
  );
}

function optionalText(value: unknown, maxLength: number, fieldLabel: string) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new Error(`${fieldLabel} metin olmalıdır.`);
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    throw new Error(`${fieldLabel} en fazla ${maxLength} karakter olabilir.`);
  }
  return normalized;
}

async function authenticate(req: Request) {
  const header = req.headers.get("Authorization") ?? "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;

  const { data: roleRow, error: roleError } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", data.user.id)
    .eq("role", "admin")
    .maybeSingle();

  if (roleError || !roleRow) return { user: data.user, isAdmin: false };
  return { user: data.user, isAdmin: true };
}

async function writeAudit(input: {
  requestId: string;
  actorUserId: string;
  targetUserId?: string | null;
  email: string;
  role: AppRole;
  outcome: "success" | "failed";
  errorCode?: string | null;
}) {
  await admin.from("user_management_audit").insert({
    request_id: input.requestId,
    actor_user_id: input.actorUserId,
    target_user_id: input.targetUserId ?? null,
    target_email: input.email,
    requested_role: input.role,
    action: "create_user",
    outcome: input.outcome,
    error_code: input.errorCode ?? null,
  });
}

async function createUser(actorUserId: string, rawArguments: unknown) {
  const args = (rawArguments ?? {}) as Record<string, unknown>;
  const email = normalizedEmail(args.email);
  const fullName = typeof args.full_name === "string" ? args.full_name.trim() : "";
  const companyName = optionalText(args.company_name, 160, "Firma adı");
  const phone = optionalText(args.phone, 40, "Telefon");
  const role = args.role as AppRole;
  const temporaryPassword = args.temporary_password;
  const requestId = crypto.randomUUID();

  if (!validEmail(email)) throw new Error("Geçerli bir e-posta adresi girin.");
  if (fullName.length < 2 || fullName.length > 120) {
    throw new Error("Ad soyad 2 ile 120 karakter arasında olmalıdır.");
  }
  if (!(["admin", "contractor", "customer"] as AppRole[]).includes(role)) {
    throw new Error("Rol admin, contractor veya customer olmalıdır.");
  }
  if (!validPassword(temporaryPassword)) {
    throw new Error(
      "Geçici şifre en az 12 karakter olmalı; büyük harf, küçük harf, rakam ve özel karakter içermelidir.",
    );
  }

  let createdUserId: string | null = null;
  try {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: temporaryPassword as string,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        company_name: companyName,
        phone,
      },
    });

    if (error || !data.user) {
      const message = error?.message ?? "Kullanıcı oluşturulamadı.";
      await writeAudit({
        requestId,
        actorUserId,
        email,
        role,
        outcome: "failed",
        errorCode: error?.code ?? "auth_create_failed",
      });
      throw new Error(message);
    }

    createdUserId = data.user.id;

    const { error: roleError } = await admin
      .from("user_roles")
      .upsert({ user_id: createdUserId, role }, { onConflict: "user_id,role" });

    if (roleError) throw roleError;

    const { error: removeDefaultRoleError } = await admin
      .from("user_roles")
      .delete()
      .eq("user_id", createdUserId)
      .neq("role", role);

    if (removeDefaultRoleError) throw removeDefaultRoleError;

    const { error: profileError } = await admin.from("profiles").upsert(
      {
        id: createdUserId,
        full_name: fullName,
        company_name: companyName,
        phone,
      },
      { onConflict: "id" },
    );

    if (profileError) throw profileError;

    await writeAudit({
      requestId,
      actorUserId,
      targetUserId: createdUserId,
      email,
      role,
      outcome: "success",
    });

    return {
      success: true,
      user_id: createdUserId,
      email,
      full_name: fullName,
      company_name: companyName,
      phone,
      role,
      message: "Kullanıcı oluşturuldu ve rolü atandı.",
      security_note:
        "Geçici şifreyi güvenli bir kanaldan paylaşın ve ilk girişten sonra değiştirin.",
    };
  } catch (error) {
    if (createdUserId) {
      await admin.auth.admin.deleteUser(createdUserId);
    }

    const message = error instanceof Error ? error.message : "Kullanıcı oluşturulamadı.";
    if (createdUserId) {
      await writeAudit({
        requestId,
        actorUserId,
        targetUserId: createdUserId,
        email,
        role,
        outcome: "failed",
        errorCode: "role_assignment_failed_rolled_back",
      });
    }
    throw new Error(message);
  }
}

const tools = [
  {
    name: "create_nes_user",
    title: "NES kullanıcısı oluştur",
    description:
      "NES Saha Operasyon sisteminde yeni bir hesap oluşturur ve admin, contractor veya customer rolünü atar. Bu araç veri yazar ve çağrılmadan hemen önce kullanıcıdan açık onay alınmalıdır.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        email: { type: "string", format: "email", description: "Yeni kullanıcının e-posta adresi" },
        full_name: { type: "string", minLength: 2, maxLength: 120, description: "Ad ve soyad" },
        company_name: {
          type: "string",
          maxLength: 160,
          description: "Firma adı (isteğe bağlı)",
        },
        phone: {
          type: "string",
          maxLength: 40,
          description: "Telefon numarası (isteğe bağlı)",
        },
        role: {
          type: "string",
          enum: ["admin", "contractor", "customer"],
          description: "admin: yönetici, contractor: taşeron, customer: müşteri",
        },
        temporary_password: {
          type: "string",
          minLength: 12,
          maxLength: 128,
          description:
            "Geçici şifre; büyük/küçük harf, rakam ve özel karakter içermelidir. Araç şifreyi kaydetmez veya yanıtında tekrarlamaz.",
        },
      },
      required: ["email", "full_name", "role", "temporary_password"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  const url = new URL(req.url);
  if (url.pathname.endsWith("/.well-known/oauth-protected-resource")) {
    return json({
      resource: FUNCTION_URL,
      authorization_servers: [AUTH_SERVER_URL],
      bearer_methods_supported: ["header"],
      scopes_supported: ["openid", "email", "profile"],
    });
  }

  if (req.method !== "POST") return json({ error: "POST kullanın." }, 405);

  const auth = await authenticate(req);
  if (!auth) return unauthorized();
  if (!auth.isAdmin) return json({ error: "Bu bağlantı yalnızca NES yöneticileri içindir." }, 403);

  let request: JsonRpcRequest;
  try {
    request = await req.json();
  } catch {
    return rpcError(null, -32700, "Geçersiz JSON", 400);
  }

  if (request.jsonrpc !== "2.0") return rpcError(request.id, -32600, "Geçersiz JSON-RPC isteği");

  if (request.method === "initialize") {
    return rpcResult(request.id, {
      protocolVersion: "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "NES Kullanıcı Yönetimi", version: "1.0.0" },
    });
  }

  if (request.method === "notifications/initialized") {
    return new Response(null, { status: 202, headers: corsHeaders });
  }

  if (request.method === "ping") return rpcResult(request.id, {});
  if (request.method === "tools/list") return rpcResult(request.id, { tools });

  if (request.method === "tools/call") {
    const params = request.params ?? {};
    if (params.name !== "create_nes_user") {
      return rpcError(request.id, -32602, "Bilinmeyen araç");
    }

    try {
      const result = await createUser(auth.user.id, params.arguments);
      return rpcResult(request.id, {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
        isError: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "İşlem başarısız.";
      return rpcResult(request.id, {
        content: [{ type: "text", text: message }],
        structuredContent: { success: false, error: message },
        isError: true,
      });
    }
  }

  return rpcError(request.id, -32601, "Yöntem bulunamadı");
});

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.7";

type AppRole = "admin" | "technical_office" | "contractor" | "customer";

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

function normalizedUsername(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function validUsername(value: string) {
  return /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])$/.test(value);
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

  const { data: roleRows, error: roleError } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", data.user.id)
    .in("role", ["admin", "technical_office"]);

  if (roleError) return { user: data.user, isAdmin: false, isTechnicalOffice: false };
  return {
    user: data.user,
    isAdmin: roleRows?.some((row) => row.role === "admin") ?? false,
    isTechnicalOffice: roleRows?.some((row) => row.role === "technical_office") ?? false,
  };
}

async function writeAudit(input: {
  requestId: string;
  actorUserId: string;
  targetUserId?: string | null;
  email: string;
  role: AppRole;
  action?: "create_user" | "reset_password" | "update_email";
  outcome: "success" | "failed";
  errorCode?: string | null;
}) {
  await admin.from("user_management_audit").insert({
    request_id: input.requestId,
    actor_user_id: input.actorUserId,
    target_user_id: input.targetUserId ?? null,
    target_email: input.email,
    requested_role: input.role,
    action: input.action ?? "create_user",
    outcome: input.outcome,
    error_code: input.errorCode ?? null,
  });
}

async function createUser(
  actor: { user: { id: string }; isAdmin: boolean; isTechnicalOffice: boolean },
  rawArguments: unknown,
) {
  const args = (rawArguments ?? {}) as Record<string, unknown>;
  const email = normalizedEmail(args.email);
  const username = normalizedUsername(args.username);
  const fullName = typeof args.full_name === "string" ? args.full_name.trim() : "";
  const companyName = optionalText(args.company_name, 160, "Firma adı");
  const phone = optionalText(args.phone, 40, "Telefon");
  const role = args.role as AppRole;
  const temporaryPassword = args.temporary_password;
  const requestId = crypto.randomUUID();

  if (!validUsername(username)) {
    throw new Error(
      "Kullanıcı adı 3-32 karakter olmalı; yalnızca küçük harf, rakam, nokta, tire ve alt çizgi içermelidir.",
    );
  }
  if (email && !validEmail(email)) throw new Error("Geçerli bir e-posta adresi girin.");
  if (fullName.length < 2 || fullName.length > 120) {
    throw new Error("Ad soyad 2 ile 120 karakter arasında olmalıdır.");
  }
  if (!(["admin", "technical_office", "contractor", "customer"] as AppRole[]).includes(role)) {
    throw new Error("Rol admin, technical_office, contractor veya customer olmalıdır.");
  }
  if (!actor.isAdmin && (!actor.isTechnicalOffice || role !== "contractor")) {
    throw new Error("Teknik ofis yalnızca taşeron hesabı oluşturabilir.");
  }
  if (!validPassword(temporaryPassword)) {
    throw new Error(
      "Geçici şifre en az 12 karakter olmalı; büyük harf, küçük harf, rakam ve özel karakter içermelidir.",
    );
  }

  let createdUserId: string | null = null;
  // Gerçek e-postası henüz olmayan saha kullanıcıları için yalnızca sistem içinde kullanılan,
  // kullanıcıya gösterilmeyen bir giriş adresi oluşturulur. E-posta doğrulama gönderilmez.
  const authEmail = email || `${username}.${crypto.randomUUID()}@accounts.nesgrup.com`;
  try {
    const { data, error } = await admin.auth.admin.createUser({
      email: authEmail,
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
        actorUserId: actor.user.id,
        email: authEmail,
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

    const { error: usernameError } = await admin.from("user_login_profiles").insert({
      user_id: createdUserId,
      username,
    });

    if (usernameError) {
      if (usernameError.code === "23505") throw new Error("Bu kullanıcı adı zaten kullanılıyor.");
      throw usernameError;
    }

    await writeAudit({
      requestId,
      actorUserId: actor.user.id,
      targetUserId: createdUserId,
      email: authEmail,
      role,
      outcome: "success",
    });

    return {
      success: true,
      user_id: createdUserId,
      username,
      email: email || null,
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
        actorUserId: actor.user.id,
        targetUserId: createdUserId,
        email: authEmail,
        role,
        outcome: "failed",
        errorCode: "role_assignment_failed_rolled_back",
      });
    }
    throw new Error(message);
  }
}

async function resetUserPassword(actorUserId: string, rawArguments: unknown) {
  const args = (rawArguments ?? {}) as Record<string, unknown>;
  const targetUserId = typeof args.target_user_id === "string" ? args.target_user_id : "";
  const temporaryPassword = args.temporary_password;
  const requestId = crypto.randomUUID();

  if (!/^[0-9a-f-]{36}$/i.test(targetUserId)) throw new Error("Geçersiz kullanıcı seçildi.");
  if (!validPassword(temporaryPassword)) {
    throw new Error("Geçici şifre en az 12 karakter olmalı; büyük harf, küçük harf, rakam ve özel karakter içermelidir.");
  }

  const [{ data: roleRow, error: roleError }, { data: userResult, error: userError }] = await Promise.all([
    admin.from("user_roles").select("role").eq("user_id", targetUserId).maybeSingle(),
    admin.auth.admin.getUserById(targetUserId),
  ]);

  if (roleError || !roleRow || userError || !userResult.user) throw new Error("Kullanıcı bulunamadı.");
  if (roleRow.role === "admin") throw new Error("Yönetici hesabının şifresi bu ekrandan yenilenemez.");

  const { error } = await admin.auth.admin.updateUserById(targetUserId, {
    password: temporaryPassword as string,
  });
  if (error) throw new Error(error.message);

  await writeAudit({
    requestId,
    actorUserId,
    targetUserId,
    email: userResult.user.email ?? "hesap",
    role: roleRow.role as AppRole,
    action: "reset_password",
    outcome: "success",
  });

  return { success: true, user_id: targetUserId, message: "Geçici şifre yenilendi." };
}

async function updateUserEmail(actorUserId: string, rawArguments: unknown) {
  const args = (rawArguments ?? {}) as Record<string, unknown>;
  const targetUserId = typeof args.target_user_id === "string" ? args.target_user_id : "";
  const newEmail = normalizedEmail(args.new_email);
  const requestedRole = args.new_role;
  const requestId = crypto.randomUUID();

  if (!/^[0-9a-f-]{36}$/i.test(targetUserId)) throw new Error("Geçersiz kullanıcı seçildi.");
  if (!validEmail(newEmail)) throw new Error("Geçerli bir e-posta adresi girin.");
  if (
    requestedRole !== undefined &&
    !(["admin", "technical_office", "contractor", "customer"] as AppRole[]).includes(
      requestedRole as AppRole,
    )
  ) {
    throw new Error("Rol admin, technical_office, contractor veya customer olmalıdır.");
  }
  const newRole = requestedRole as AppRole | undefined;

  const [{ data: userResult, error: userError }, { data: roleRow, error: roleError }] =
    await Promise.all([
      admin.auth.admin.getUserById(targetUserId),
      admin.from("user_roles").select("role").eq("user_id", targetUserId).maybeSingle(),
    ]);

  if (userError || !userResult.user) throw new Error("Kullanıcı bulunamadı.");
  if (roleError || !roleRow) throw new Error("Kullanıcının rolü bulunamadı.");

  const previousEmail = userResult.user.email ?? null;
  const currentRole = roleRow.role as AppRole;
  const finalRole = newRole ?? currentRole;

  if (previousEmail && previousEmail.toLowerCase() === newEmail) {
    throw new Error("Yeni e-posta mevcut e-posta ile aynı olamaz.");
  }

  const { error: emailError } = await admin.auth.admin.updateUserById(targetUserId, {
    email: newEmail,
    email_confirm: true,
  });

  if (emailError) {
    await writeAudit({
      requestId,
      actorUserId,
      targetUserId,
      email: newEmail,
      role: currentRole,
      action: "update_email",
      outcome: "failed",
      errorCode: emailError.code ?? "email_update_failed",
    });
    const message =
      emailError.code === "email_exists" || /already|exist/i.test(emailError.message)
        ? "Bu e-posta adresi zaten başka bir hesap tarafından kullanılıyor."
        : emailError.message;
    throw new Error(message);
  }

  if (newRole && newRole !== currentRole) {
    try {
      const { error: roleUpsertError } = await admin
        .from("user_roles")
        .upsert({ user_id: targetUserId, role: newRole }, { onConflict: "user_id,role" });
      if (roleUpsertError) throw roleUpsertError;

      const { error: removeOtherRolesError } = await admin
        .from("user_roles")
        .delete()
        .eq("user_id", targetUserId)
        .neq("role", newRole);
      if (removeOtherRolesError) throw removeOtherRolesError;
    } catch (error) {
      if (previousEmail) {
        await admin.auth.admin.updateUserById(targetUserId, { email: previousEmail });
      }
      await writeAudit({
        requestId,
        actorUserId,
        targetUserId,
        email: newEmail,
        role: currentRole,
        action: "update_email",
        outcome: "failed",
        errorCode: "role_update_failed_rolled_back",
      });
      const message = error instanceof Error ? error.message : "Rol güncellenemedi.";
      throw new Error(message);
    }
  }

  await writeAudit({
    requestId,
    actorUserId,
    targetUserId,
    email: newEmail,
    role: finalRole,
    action: "update_email",
    outcome: "success",
  });

  return {
    success: true,
    user_id: targetUserId,
    previous_email: previousEmail,
    new_email: newEmail,
    role: finalRole,
    message: "Giriş e-postası güncellendi.",
  };
}

const tools = [
  {
    name: "create_nes_user",
    title: "NES kullanıcısı oluştur",
    description:
      "NES Saha Operasyon sisteminde yeni bir hesap oluşturur. Yöneticiler admin, technical_office, contractor veya customer rolünü; teknik ofis ise yalnızca contractor rolünü atayabilir. Kullanıcı adı zorunludur; e-posta isteğe bağlıdır. Bu araç veri yazar ve çağrılmadan hemen önce kullanıcıdan açık onay alınmalıdır.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        username: {
          type: "string",
          minLength: 3,
          maxLength: 32,
          description: "Giriş kullanıcı adı: küçük harf, rakam, nokta, tire veya alt çizgi",
        },
        email: { type: "string", format: "email", description: "Gerçek e-posta adresi (isteğe bağlı)" },
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
          enum: ["admin", "technical_office", "contractor", "customer"],
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
      required: ["username", "full_name", "role", "temporary_password"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "reset_nes_user_password",
    title: "NES kullanıcı şifresini yenile",
    description:
      "Yalnızca taşeron veya müşteri hesabının geçici şifresini yeniler. Yönetici hesaplarını değiştiremez. Bu araç veri yazar ve çağrılmadan hemen önce kullanıcıdan açık onay alınmalıdır.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        target_user_id: { type: "string", format: "uuid", description: "Şifresi yenilenecek kullanıcı kimliği" },
        temporary_password: {
          type: "string",
          minLength: 12,
          maxLength: 128,
          description: "Yeni geçici şifre; yanıt veya kayıtlarda gösterilmez.",
        },
      },
      required: ["target_user_id", "temporary_password"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "update_nes_user_email",
    title: "NES giriş e-postasını değiştir",
    description:
      "Bir hesabın kurumsal giriş e-postasını değiştirir (ör. kişisel bir adresten @nesgrup.com adresine taşıma). Kullanıcı kimliği, profil, atamalar, roller ve şifre korunur; yalnızca giriş e-postası ve isteğe bağlı olarak rol güncellenir. Yalnızca yöneticiler çağırabilir. Bu araç veri yazar ve çağrılmadan hemen önce kullanıcıdan açık onay alınmalıdır.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        target_user_id: {
          type: "string",
          format: "uuid",
          description: "E-postası değiştirilecek kullanıcı kimliği",
        },
        new_email: { type: "string", format: "email", description: "Yeni kurumsal giriş e-postası" },
        new_role: {
          type: "string",
          enum: ["admin", "technical_office", "contractor", "customer"],
          description: "İsteğe bağlı: e-posta değişimiyle birlikte rolü de günceller",
        },
      },
      required: ["target_user_id", "new_email"],
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
  if (!auth.isAdmin && !auth.isTechnicalOffice) {
    return json({ error: "Bu bağlantı yalnızca NES yöneticileri veya teknik ofis içindir." }, 403);
  }

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
    const knownTools = ["create_nes_user", "reset_nes_user_password", "update_nes_user_email"];
    if (!knownTools.includes(params.name as string)) {
      return rpcError(request.id, -32602, "Bilinmeyen araç");
    }
    if (params.name === "reset_nes_user_password" && !auth.isAdmin) {
      return rpcResult(request.id, {
        content: [{ type: "text", text: "Şifre yenileme yalnızca yöneticiler içindir." }],
        structuredContent: { success: false, error: "Şifre yenileme yalnızca yöneticiler içindir." },
        isError: true,
      });
    }
    if (params.name === "update_nes_user_email" && !auth.isAdmin) {
      return rpcResult(request.id, {
        content: [{ type: "text", text: "Giriş e-postası değişimi yalnızca yöneticiler içindir." }],
        structuredContent: {
          success: false,
          error: "Giriş e-postası değişimi yalnızca yöneticiler içindir.",
        },
        isError: true,
      });
    }

    try {
      const result =
        params.name === "create_nes_user"
          ? await createUser(auth, params.arguments)
          : params.name === "reset_nes_user_password"
            ? await resetUserPassword(auth.user.id, params.arguments)
            : await updateUserEmail(auth.user.id, params.arguments);
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

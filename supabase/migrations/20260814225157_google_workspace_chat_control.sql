-- Google Workspace / ChatGPT yönetim bağlantısı.
-- OAuth erişim ve yenileme anahtarları yalnızca Supabase Vault'ta tutulur;
-- uygulama tablolarında veya günlüklerde hiçbir zaman açık metin saklanmaz.

CREATE TABLE IF NOT EXISTS public.google_workspace_connections (
  owner_user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  google_email TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  access_token_secret_name TEXT NOT NULL UNIQUE,
  refresh_token_secret_name TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT google_workspace_connections_nes_email
    CHECK (lower(google_email) LIKE '%@nesgrup.com')
);

CREATE TABLE IF NOT EXISTS public.google_workspace_oauth_states (
  state_hash TEXT PRIMARY KEY,
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_verifier TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS google_workspace_oauth_states_expiry_idx
  ON public.google_workspace_oauth_states (expires_at);

CREATE TABLE IF NOT EXISTS public.google_workspace_resources (
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  resource_key TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('drive', 'folder', 'calendar')),
  resource_name TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_user_id, resource_key)
);

CREATE TABLE IF NOT EXISTS public.project_workspace_links (
  project_id UUID PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  operations_folder_id TEXT NOT NULL,
  finance_folder_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.google_workspace_operation_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL UNIQUE,
  actor_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  tool_name TEXT NOT NULL,
  target_resource_id TEXT,
  input_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failed')),
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS google_workspace_operation_audit_actor_idx
  ON public.google_workspace_operation_audit (actor_user_id, created_at DESC);

ALTER TABLE public.google_workspace_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_workspace_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_workspace_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_workspace_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_workspace_operation_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.google_workspace_connections FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.google_workspace_oauth_states FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.google_workspace_resources FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.project_workspace_links FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.google_workspace_operation_audit FROM PUBLIC, anon, authenticated;

GRANT ALL ON public.google_workspace_connections TO service_role;
GRANT ALL ON public.google_workspace_oauth_states TO service_role;
GRANT ALL ON public.google_workspace_resources TO service_role;
GRANT ALL ON public.project_workspace_links TO service_role;
GRANT ALL ON public.google_workspace_operation_audit TO service_role;

-- service_role dışında hiçbir rolün açık Google anahtarlarını okuyamaması için
-- Vault erişimi yalnızca SECURITY DEFINER yardımcılarında kapsüllenir.
CREATE OR REPLACE FUNCTION public.save_google_workspace_connection(
  target_user_id UUID,
  target_google_email TEXT,
  target_scopes TEXT[],
  target_access_token TEXT,
  target_refresh_token TEXT,
  target_expires_at TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  access_name TEXT := 'google_workspace_access_' || target_user_id::text;
  refresh_name TEXT := 'google_workspace_refresh_' || target_user_id::text;
  access_secret_id UUID;
  refresh_secret_id UUID;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF lower(target_google_email) NOT LIKE '%@nesgrup.com' THEN
    RAISE EXCEPTION 'Only nesgrup.com accounts are allowed';
  END IF;

  SELECT id INTO access_secret_id FROM vault.secrets WHERE name = access_name LIMIT 1;
  IF access_secret_id IS NULL THEN
    PERFORM vault.create_secret(target_access_token, access_name, 'Google Workspace access token');
  ELSE
    PERFORM vault.update_secret(access_secret_id, target_access_token, access_name, 'Google Workspace access token');
  END IF;

  SELECT id INTO refresh_secret_id FROM vault.secrets WHERE name = refresh_name LIMIT 1;
  IF NULLIF(target_refresh_token, '') IS NOT NULL THEN
    IF refresh_secret_id IS NULL THEN
      PERFORM vault.create_secret(target_refresh_token, refresh_name, 'Google Workspace refresh token');
    ELSE
      PERFORM vault.update_secret(refresh_secret_id, target_refresh_token, refresh_name, 'Google Workspace refresh token');
    END IF;
  ELSIF refresh_secret_id IS NULL THEN
    RAISE EXCEPTION 'Google refresh token is required for the first connection';
  END IF;

  INSERT INTO public.google_workspace_connections (
    owner_user_id,
    google_email,
    scopes,
    access_token_secret_name,
    refresh_token_secret_name,
    expires_at
  ) VALUES (
    target_user_id,
    lower(target_google_email),
    COALESCE(target_scopes, '{}'::TEXT[]),
    access_name,
    refresh_name,
    target_expires_at
  )
  ON CONFLICT (owner_user_id) DO UPDATE SET
    google_email = EXCLUDED.google_email,
    scopes = EXCLUDED.scopes,
    expires_at = EXCLUDED.expires_at,
    connected_at = now(),
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.get_google_workspace_credentials(target_user_id UUID)
RETURNS TABLE (
  google_email TEXT,
  scopes TEXT[],
  access_token TEXT,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    connection.google_email,
    connection.scopes,
    access_secret.decrypted_secret,
    refresh_secret.decrypted_secret,
    connection.expires_at
  FROM public.google_workspace_connections AS connection
  JOIN vault.decrypted_secrets AS access_secret
    ON access_secret.name = connection.access_token_secret_name
  JOIN vault.decrypted_secrets AS refresh_secret
    ON refresh_secret.name = connection.refresh_token_secret_name
  WHERE connection.owner_user_id = target_user_id
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.save_google_workspace_connection(UUID, TEXT, TEXT[], TEXT, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_google_workspace_credentials(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_google_workspace_connection(UUID, TEXT, TEXT[], TEXT, TEXT, TIMESTAMPTZ)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_google_workspace_credentials(UUID)
  TO service_role;

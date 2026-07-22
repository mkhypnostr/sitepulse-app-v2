-- E-posta vermeden oluşturulan saha hesapları için kullanıcı adı eşleştirmesi.
-- Bu tablo istemciye kapalıdır; yalnızca service_role kullanan Edge Function'lar erişebilir.

CREATE TABLE IF NOT EXISTS public.user_login_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_login_profiles_username_length CHECK (char_length(username) BETWEEN 3 AND 32),
  CONSTRAINT user_login_profiles_username_format CHECK (username ~ '^[a-z0-9][a-z0-9._-]*[a-z0-9]$')
);

CREATE UNIQUE INDEX IF NOT EXISTS user_login_profiles_username_lower_key
  ON public.user_login_profiles (lower(username));

ALTER TABLE public.user_login_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_login_profiles FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.user_login_profiles TO service_role;

DROP POLICY IF EXISTS "user_login_profiles_service_role_only" ON public.user_login_profiles;
CREATE POLICY "user_login_profiles_service_role_only"
ON public.user_login_profiles
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP TRIGGER IF EXISTS user_login_profiles_updated_at ON public.user_login_profiles;
CREATE TRIGGER user_login_profiles_updated_at
BEFORE UPDATE ON public.user_login_profiles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.user_management_audit
  DROP CONSTRAINT IF EXISTS user_management_audit_action_check;

ALTER TABLE public.user_management_audit
  ADD CONSTRAINT user_management_audit_action_check
  CHECK (action IN ('create_user', 'reset_password'));

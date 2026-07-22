-- NES Kullanıcı Yönetimi: hassas veri içermeyen denetim günlüğü.
-- Parolalar ve Supabase gizli anahtarları bu tabloya hiçbir zaman yazılmaz.

CREATE TABLE IF NOT EXISTS public.user_management_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL UNIQUE,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  target_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  target_email TEXT NOT NULL,
  requested_role public.app_role NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create_user')),
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failed')),
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_management_audit_created_at_idx
  ON public.user_management_audit (created_at DESC);

CREATE INDEX IF NOT EXISTS user_management_audit_actor_idx
  ON public.user_management_audit (actor_user_id, created_at DESC);

ALTER TABLE public.user_management_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.user_management_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_management_audit TO authenticated;
GRANT ALL ON public.user_management_audit TO service_role;

DROP POLICY IF EXISTS "user_management_audit_admin_read"
  ON public.user_management_audit;

CREATE POLICY "user_management_audit_admin_read"
ON public.user_management_audit
FOR SELECT
TO authenticated
USING (public.has_role((SELECT auth.uid()), 'admin'));


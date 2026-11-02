-- Panel önizleme kaydı: yöneticinin hangi taşeron/müşteri panelini ne zaman
-- açtığı. Kayıtları yalnız nes-view-as Edge Function'ı (service role) yazar;
-- yalnız yönetici okur. Tekrar çalıştırılabilir; veri silmez.

CREATE TABLE IF NOT EXISTS public.view_as_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_role text NOT NULL CHECK (target_role IN ('customer', 'contractor')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS view_as_log_admin_idx
  ON public.view_as_log (admin_id, created_at DESC);

ALTER TABLE public.view_as_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins view view_as_log" ON public.view_as_log;
CREATE POLICY "admins view view_as_log"
  ON public.view_as_log FOR SELECT TO authenticated
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

REVOKE ALL ON public.view_as_log FROM anon;
GRANT SELECT ON public.view_as_log TO authenticated;

-- Bakım paketleri fiyat listesi (GES / trafo bakımı, işletme sorumluluğu,
-- ek hizmetler). Tek satır, fiyatlar jsonb; finansal veri olduğu için
-- yalnız yönetici okur ve yazar. Tekrar çalıştırılabilir; veri silmez.

CREATE TABLE IF NOT EXISTS public.maintenance_price_list (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  prices jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.maintenance_price_list ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'maintenance_price_list'
      AND policyname = 'admins manage maintenance_price_list'
  ) THEN
    CREATE POLICY "admins manage maintenance_price_list"
      ON public.maintenance_price_list FOR ALL TO authenticated
      USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)))
      WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));
  END IF;
END;
$$;

REVOKE ALL ON public.maintenance_price_list FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.maintenance_price_list TO authenticated;

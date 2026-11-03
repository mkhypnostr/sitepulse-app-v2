-- Taşeron iş tarifi: keşifte yazılır, iş emrine taşınır. Yalnız NES
-- (yönetici, teknik ofis) ve işe atanmış taşeron görür; müşteri hiçbir
-- yoldan göremez (iş emrinin "Açıklama" alanı tamamlanınca müşteriye
-- açılabildiği için ayrı tabloda tutulur). Tekrar çalıştırılabilir; veri silmez.

ALTER TABLE public.site_surveys
  ADD COLUMN IF NOT EXISTS contractor_instructions text;

CREATE TABLE IF NOT EXISTS public.work_order_instructions (
  work_order_id uuid PRIMARY KEY
    REFERENCES public.work_orders(id) ON DELETE CASCADE,
  body text NOT NULL DEFAULT '',
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.work_order_instructions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'work_order_instructions'
      AND policyname = 'managers manage work_order_instructions'
  ) THEN
    CREATE POLICY "managers manage work_order_instructions"
      ON public.work_order_instructions FOR ALL TO authenticated
      USING ((SELECT public.can_manage_projects(auth.uid())))
      WITH CHECK ((SELECT public.can_manage_projects(auth.uid())));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'work_order_instructions'
      AND policyname = 'assigned contractor reads work_order_instructions'
  ) THEN
    CREATE POLICY "assigned contractor reads work_order_instructions"
      ON public.work_order_instructions FOR SELECT TO authenticated
      USING (EXISTS (
        SELECT 1 FROM public.work_order_assignments woa
        WHERE woa.work_order_id = work_order_instructions.work_order_id
          AND woa.contractor_id = (SELECT auth.uid())
      ));
  END IF;
END;
$$;

REVOKE ALL ON public.work_order_instructions FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_order_instructions TO authenticated;

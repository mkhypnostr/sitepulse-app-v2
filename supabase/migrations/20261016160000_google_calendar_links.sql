-- Google Takvim'e gönderilen kayıtların izi.
--
-- Uygulamadaki takvim kaydı, görev, iş emri veya satış adımı bağlı Google
-- hesabının takvimine (mevcut nes-workspace-control "create_nes_calendar_event"
-- aracıyla) gönderildiğinde etkinlik kimliği burada tutulur; aynı kayıt aynı
-- gün için ikinci kez gönderilmez. Yalnız yönetici.
-- Yalnız ekleme yapar (DROP içermez) ve tekrar çalıştırılabilir.

CREATE TABLE IF NOT EXISTS public.google_calendar_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL CHECK (source_type IN
    ('calendar_event', 'operational_task', 'project_task', 'work_order', 'lead_action')),
  source_id uuid NOT NULL,
  source_date date NOT NULL,
  google_event_id text NOT NULL CHECK (char_length(google_event_id) <= 200),
  google_event_url text CHECK (google_event_url IS NULL OR char_length(google_event_url) <= 500),
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id, source_date)
);

ALTER TABLE public.google_calendar_links ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'google_calendar_links' AND policyname = 'admins manage google calendar links') THEN
    CREATE POLICY "admins manage google calendar links" ON public.google_calendar_links
      FOR ALL TO authenticated
      USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
      WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
  END IF;
END $$;

GRANT SELECT, INSERT, DELETE ON public.google_calendar_links TO authenticated;

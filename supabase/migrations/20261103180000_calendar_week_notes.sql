-- Takvim haftalık notları: günü belli olmayan, o hafta yapılacak işler.
-- Yalnız NES (yönetici, teknik ofis) görür ve düzenler; taşeron ve müşteri
-- göremez. Tekrar çalıştırılabilir; veri silmez.

CREATE TABLE IF NOT EXISTS public.calendar_week_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start date NOT NULL CHECK (extract(isodow FROM week_start) = 1),
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 500),
  is_done boolean NOT NULL DEFAULT false,
  done_at timestamptz,
  done_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS calendar_week_notes_week_idx
  ON public.calendar_week_notes (week_start);
CREATE INDEX IF NOT EXISTS calendar_week_notes_open_idx
  ON public.calendar_week_notes (week_start) WHERE NOT is_done;

ALTER TABLE public.calendar_week_notes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'calendar_week_notes'
      AND policyname = 'managers manage calendar_week_notes'
  ) THEN
    CREATE POLICY "managers manage calendar_week_notes"
      ON public.calendar_week_notes FOR ALL TO authenticated
      USING ((SELECT public.can_manage_projects(auth.uid())))
      WITH CHECK ((SELECT public.can_manage_projects(auth.uid())));
  END IF;
END;
$$;

REVOKE ALL ON public.calendar_week_notes FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendar_week_notes TO authenticated;

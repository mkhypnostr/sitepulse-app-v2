-- Uygulama içi takvimde, aynı gün birden fazla bağımsız plan/not
-- tutulabilmesi için. Google Calendar eşlemesi bu ilk aşamanın kapsamı
-- dışındadır; takvimin ana kaynağı uygulamanın kendi verisidir.

CREATE TABLE public.calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 3 AND 180),
  event_type text NOT NULL DEFAULT 'plan'
    CHECK (event_type IN ('plan', 'meeting', 'site_visit', 'reminder')),
  scheduled_date date NOT NULL,
  scheduled_time time without time zone,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  work_order_id uuid REFERENCES public.work_orders(id) ON DELETE SET NULL,
  responsible_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes text CHECK (notes IS NULL OR char_length(notes) <= 2000),
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'completed', 'cancelled')),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX calendar_events_scheduled_date_idx
  ON public.calendar_events (scheduled_date);
CREATE INDEX calendar_events_responsible_date_idx
  ON public.calendar_events (responsible_id, scheduled_date);

ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;

-- Yönetici ve teknik ofis tüm planları yönetir. Taşeron yalnızca kendisine
-- atanmış planları görür; plan oluşturma veya başkasının notunu değiştirme
-- yetkisi verilmez.
CREATE POLICY "calendar_events_managers_all"
ON public.calendar_events
FOR ALL TO authenticated
USING (public.can_manage_projects((SELECT auth.uid())))
WITH CHECK (public.can_manage_projects((SELECT auth.uid())));

CREATE POLICY "calendar_events_assignee_read"
ON public.calendar_events
FOR SELECT TO authenticated
USING (responsible_id = (SELECT auth.uid()));

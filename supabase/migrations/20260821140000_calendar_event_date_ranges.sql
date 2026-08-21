-- Planlar ve projeye bağlı takvim kayıtları için tarih aralığı.
-- Hatırlatmalar tek günlüktür; end_date boş kalır.

ALTER TABLE public.calendar_events
  ADD COLUMN end_date date;

-- Daha önce oluşturulmuş planlar tek günlük tarih aralığı olarak korunur.
UPDATE public.calendar_events
SET end_date = scheduled_date
WHERE end_date IS NULL
  AND (
    event_type = 'plan'
    OR (project_id IS NOT NULL AND event_type <> 'reminder')
  );

ALTER TABLE public.calendar_events
  ADD CONSTRAINT calendar_events_end_date_order_check
  CHECK (end_date IS NULL OR end_date >= scheduled_date),
  ADD CONSTRAINT calendar_events_plan_end_date_check
  CHECK (event_type <> 'plan' OR end_date IS NOT NULL),
  ADD CONSTRAINT calendar_events_project_end_date_check
  CHECK (
    project_id IS NULL
    OR event_type = 'reminder'
    OR end_date IS NOT NULL
  ),
  ADD CONSTRAINT calendar_events_reminder_single_day_check
  CHECK (event_type <> 'reminder' OR end_date IS NULL);

CREATE INDEX calendar_events_end_date_idx
  ON public.calendar_events (end_date);

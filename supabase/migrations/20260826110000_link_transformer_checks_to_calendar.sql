-- Aylık trafo kontrol kaydını uygulama takvimindeki planla birebir bağlar.
-- Bu bağlantı takip içindir; teknik rapor veya resmî imza oluşturmaz.

ALTER TABLE public.calendar_events
  ADD COLUMN transformer_contract_id uuid
    REFERENCES public.transformer_responsibility_contracts(id)
    ON DELETE SET NULL;

ALTER TABLE public.transformer_monthly_checks
  ADD COLUMN planned_date date,
  ADD COLUMN calendar_event_id uuid
    REFERENCES public.calendar_events(id)
    ON DELETE SET NULL;

CREATE INDEX calendar_events_transformer_contract_id_idx
  ON public.calendar_events(transformer_contract_id);

CREATE INDEX transformer_monthly_checks_calendar_event_id_idx
  ON public.transformer_monthly_checks(calendar_event_id);

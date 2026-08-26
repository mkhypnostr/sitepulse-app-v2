-- Her yıllık trafo sözleşmesi için tek bir uygulama içi yenileme planı.
-- Harici e-posta veya WhatsApp bildirimi göndermez.

ALTER TABLE public.transformer_responsibility_contracts
  ADD COLUMN renewal_calendar_event_id uuid
    REFERENCES public.calendar_events(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX transformer_contracts_renewal_calendar_event_id_key
  ON public.transformer_responsibility_contracts(renewal_calendar_event_id)
  WHERE renewal_calendar_event_id IS NOT NULL;

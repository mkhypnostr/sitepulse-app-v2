-- Kontrol formunu yükleyen kullanıcıya ait foreign key sorgularını hızlandırır.

CREATE INDEX transformer_monthly_checks_control_form_uploaded_by_idx
  ON public.transformer_monthly_checks(control_form_uploaded_by);

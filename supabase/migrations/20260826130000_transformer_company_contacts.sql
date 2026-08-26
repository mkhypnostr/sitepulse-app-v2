-- Firma kartındaki muhatap/yetkili iletişim bilgileri.
-- Sözleşme yenilense de bilgiler firma düzeyinde korunur.

ALTER TABLE public.transformer_companies
  ADD COLUMN contact_name text,
  ADD COLUMN contact_title text,
  ADD COLUMN contact_phone text,
  ADD COLUMN contact_email text
    CHECK (
      contact_email IS NULL
      OR contact_email ~* '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'
    );

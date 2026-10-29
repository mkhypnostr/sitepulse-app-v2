-- Sade keşif: yetkili kişi, iş tanımı ve kalem türü (malzeme / işçilik).
--
--  site_surveys.contact_name      Sahadaki yetkili kişi.
--  site_surveys.work_description  İşin tanımı; teklifte "Kapsam" olarak çıkar.
--                                 (notes alanı artık yalnız iç notlardır,
--                                 müşteriye giden belgelere yazılmaz.)
--  site_survey_items.kind         'malzeme' veya 'iscilik'.
--
-- Yalnız ekleme yapar (DROP içermez) ve tekrar çalıştırılabilir.

ALTER TABLE public.site_surveys
  ADD COLUMN IF NOT EXISTS contact_name text
    CHECK (contact_name IS NULL OR char_length(contact_name) <= 120),
  ADD COLUMN IF NOT EXISTS work_description text
    CHECK (work_description IS NULL OR char_length(work_description) <= 4000);

ALTER TABLE public.site_survey_items
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'malzeme'
    CHECK (kind IN ('malzeme', 'iscilik'));

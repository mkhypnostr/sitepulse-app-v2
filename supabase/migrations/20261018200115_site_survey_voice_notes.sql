-- Keşif ses notları: fotoğraflarla aynı tabloda tür alanıyla tutulur
-- (photo / audio). Ses dosyaları site-surveys deposuna yüklenir.
-- Yalnız ekleme yapar, tekrar çalıştırılabilir.
ALTER TABLE public.site_survey_photos
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'photo'
    CHECK (kind IN ('photo', 'audio')),
  ADD COLUMN IF NOT EXISTS duration_s integer
    CHECK (duration_s IS NULL OR duration_s >= 0),
  ADD COLUMN IF NOT EXISTS transcript text
    CHECK (transcript IS NULL OR char_length(transcript) <= 20000);

UPDATE storage.buckets
   SET allowed_mime_types = ARRAY[
     'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf',
     'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/wav', 'audio/x-m4a'
   ]
 WHERE id = 'site-surveys';

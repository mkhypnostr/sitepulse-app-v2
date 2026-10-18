-- Keşif (saha ziyareti): tabletten, internet olmasa da doldurulur; internet
-- gelince cihazdan gönderilir. Kimlikler cihazda üretilir (uuid), bu yüzden
-- tekrar gönderim aynı kaydı günceller, kopya oluşturmaz.
--
--  site_surveys        Keşif başlığı: müşteri/aday, iş türü, konum (GPS),
--                      serbest notlar, durum, oluşturulan teklif.
--  site_survey_items   Malzeme / iş kalemleri (katalogdan ya da elle).
--  site_survey_photos  Fotoğraflar (site-surveys deposunda).
--
-- Yetki: can_manage_projects (yönetici + teknik ofis). Teklife dönüştürme
-- teklif yetkisi gerektirir (offers tablosunun kendi kuralları).
-- Yalnız ekleme yapar, tekrar çalıştırılabilir.

CREATE TABLE IF NOT EXISTS public.site_surveys (
  id uuid PRIMARY KEY,
  survey_no text UNIQUE,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  work_type text NOT NULL DEFAULT 'diger'
    CHECK (work_type IN ('ges', 'sarj', 'taahhut', 'siva_alti', 'pano', 'aydinlatma', 'og_trafo', 'olcum', 'diger')),
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name text CHECK (customer_name IS NULL OR char_length(customer_name) <= 200),
  contact_phone text CHECK (contact_phone IS NULL OR char_length(contact_phone) <= 40),
  lead_id uuid REFERENCES public.sales_leads(id) ON DELETE SET NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  location_text text CHECK (location_text IS NULL OR char_length(location_text) <= 300),
  latitude double precision CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude double precision CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  location_accuracy_m double precision,
  notes text CHECK (notes IS NULL OR char_length(notes) <= 20000),
  status text NOT NULL DEFAULT 'taslak'
    CHECK (status IN ('taslak', 'tamamlandi', 'teklif')),
  offer_id uuid REFERENCES public.offers(id) ON DELETE SET NULL,
  surveyed_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.site_survey_items (
  id uuid PRIMARY KEY,
  survey_id uuid NOT NULL REFERENCES public.site_surveys(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  description text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 1 AND 300),
  quantity numeric(14,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit text NOT NULL DEFAULT 'adet' CHECK (char_length(unit) BETWEEN 1 AND 20),
  catalog_item_id uuid REFERENCES public.offer_catalog_items(id) ON DELETE SET NULL,
  note text CHECK (note IS NULL OR char_length(note) <= 300),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.site_survey_photos (
  id uuid PRIMARY KEY,
  survey_id uuid NOT NULL REFERENCES public.site_surveys(id) ON DELETE CASCADE,
  storage_path text NOT NULL CHECK (char_length(storage_path) <= 300),
  caption text CHECK (caption IS NULL OR char_length(caption) <= 200),
  taken_at timestamptz NOT NULL DEFAULT now(),
  include_in_offer boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS site_surveys_created_idx ON public.site_surveys (created_at DESC);
CREATE INDEX IF NOT EXISTS site_surveys_customer_idx ON public.site_surveys (customer_id);
CREATE INDEX IF NOT EXISTS site_surveys_offer_idx ON public.site_surveys (offer_id);
CREATE INDEX IF NOT EXISTS site_survey_items_survey_idx ON public.site_survey_items (survey_id, position);
CREATE INDEX IF NOT EXISTS site_survey_photos_survey_idx ON public.site_survey_photos (survey_id, taken_at);

-- Keşif numarası: KSF-YYYY-NNNN (yıl içinde sıralı).
CREATE OR REPLACE FUNCTION public.site_surveys_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  yr text;
  next_no integer;
BEGIN
  yr := to_char(COALESCE(NEW.surveyed_at, now()), 'YYYY');
  PERFORM pg_advisory_xact_lock(hashtext('site-survey-no-' || yr));
  SELECT COALESCE(MAX(split_part(survey_no, '-', 3)::integer), 0) + 1
    INTO next_no
    FROM public.site_surveys
   WHERE survey_no LIKE 'KSF-' || yr || '-%';
  NEW.survey_no := 'KSF-' || yr || '-' || lpad(next_no::text, 4, '0');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS site_surveys_before_insert ON public.site_surveys;
CREATE TRIGGER site_surveys_before_insert
BEFORE INSERT ON public.site_surveys
FOR EACH ROW EXECUTE FUNCTION public.site_surveys_before_insert();

-- Numara ve oluşturan değişmez.
CREATE OR REPLACE FUNCTION public.site_surveys_before_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.survey_no := OLD.survey_no;
  NEW.created_by := OLD.created_by;
  NEW.created_at := OLD.created_at;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS site_surveys_before_update ON public.site_surveys;
CREATE TRIGGER site_surveys_before_update
BEFORE UPDATE ON public.site_surveys
FOR EACH ROW EXECUTE FUNCTION public.site_surveys_before_update();

ALTER TABLE public.site_surveys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_survey_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_survey_photos ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl text;
  op text;
  pol text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['site_surveys', 'site_survey_items', 'site_survey_photos'] LOOP
    FOREACH op IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
      pol := 'project managers ' || lower(op) || ' ' || tbl;
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = tbl AND policyname = pol
      ) THEN
        IF op = 'INSERT' THEN
          EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK ((SELECT public.can_manage_projects(auth.uid())))', pol, tbl);
        ELSIF op = 'UPDATE' THEN
          EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING ((SELECT public.can_manage_projects(auth.uid()))) WITH CHECK ((SELECT public.can_manage_projects(auth.uid())))', pol, tbl);
        ELSE
          EXECUTE format('CREATE POLICY %I ON public.%I FOR %s TO authenticated USING ((SELECT public.can_manage_projects(auth.uid())))', pol, tbl, op);
        END IF;
      END IF;
    END LOOP;
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_surveys TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_survey_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_survey_photos TO authenticated;
REVOKE ALL ON public.site_surveys FROM anon;
REVOKE ALL ON public.site_survey_items FROM anon;
REVOKE ALL ON public.site_survey_photos FROM anon;

-- Keşif fotoğrafları: özel depo, yönetici + teknik ofis.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('site-surveys', 'site-surveys', false, 15728640,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  op text;
  pol text;
BEGIN
  FOREACH op IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
    pol := 'site surveys ' || lower(op);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = pol
    ) THEN
      IF op = 'INSERT' THEN
        EXECUTE format('CREATE POLICY %I ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = %L AND (SELECT public.can_manage_projects(auth.uid())))', pol, 'site-surveys');
      ELSIF op = 'UPDATE' THEN
        EXECUTE format('CREATE POLICY %I ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = %L AND (SELECT public.can_manage_projects(auth.uid()))) WITH CHECK (bucket_id = %L AND (SELECT public.can_manage_projects(auth.uid())))', pol, 'site-surveys', 'site-surveys');
      ELSE
        EXECUTE format('CREATE POLICY %I ON storage.objects FOR %s TO authenticated USING (bucket_id = %L AND (SELECT public.can_manage_projects(auth.uid())))', pol, op, 'site-surveys');
      END IF;
    END IF;
  END LOOP;
END $$;

-- Müşteri portalından teknik servis/arızaya ilişkin kayıt açılması, özel
-- dosya yüklenmesi ve yöneticinin kaydı bir iş emrine bağlaması için temel.

CREATE TABLE public.technical_service_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_no bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 3 AND 180),
  equipment_type text NOT NULL
    CHECK (
      equipment_type IN (
        'transformer',
        'generator',
        'ev_charger',
        'panel',
        'electrical_installation',
        'other'
      )
    ),
  equipment_details text
    CHECK (equipment_details IS NULL OR char_length(equipment_details) <= 500),
  description text NOT NULL
    CHECK (char_length(btrim(description)) BETWEEN 10 AND 4000),
  location text NOT NULL CHECK (char_length(btrim(location)) BETWEEN 3 AND 500),
  location_url text
    CHECK (
      location_url IS NULL
      OR (
        char_length(location_url) <= 2000
        AND location_url ~ '^https://'
      )
    ),
  urgency text NOT NULL DEFAULT 'normal'
    CHECK (urgency IN ('normal', 'high', 'critical')),
  contact_name text NOT NULL
    CHECK (char_length(btrim(contact_name)) BETWEEN 2 AND 180),
  contact_phone text NOT NULL
    CHECK (char_length(btrim(contact_phone)) BETWEEN 8 AND 32),
  status text NOT NULL DEFAULT 'new'
    CHECK (
      status IN (
        'new',
        'reviewing',
        'planned',
        'on_site',
        'resolved',
        'closed',
        'cancelled'
      )
    ),
  admin_note text CHECK (admin_note IS NULL OR char_length(admin_note) <= 2000),
  converted_work_order_id uuid UNIQUE
    REFERENCES public.work_orders(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX technical_service_requests_customer_created_idx
  ON public.technical_service_requests(customer_id, created_at DESC);
CREATE INDEX technical_service_requests_status_created_idx
  ON public.technical_service_requests(status, created_at DESC);
CREATE INDEX technical_service_requests_created_by_idx
  ON public.technical_service_requests(created_by);

CREATE TABLE public.technical_service_request_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL
    REFERENCES public.technical_service_requests(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE
    CHECK (NULLIF(btrim(storage_path), '') IS NOT NULL),
  file_name text NOT NULL
    CHECK (char_length(btrim(file_name)) BETWEEN 1 AND 255),
  mime_type text NOT NULL
    CHECK (
      mime_type IN (
        'image/jpeg',
        'image/png',
        'image/webp',
        'video/mp4',
        'video/quicktime'
      )
    ),
  size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 52428800),
  uploaded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX technical_service_request_media_request_created_idx
  ON public.technical_service_request_media(request_id, created_at);
CREATE INDEX technical_service_request_media_uploaded_by_idx
  ON public.technical_service_request_media(uploaded_by);

DROP TRIGGER IF EXISTS technical_service_requests_set_updated_at
ON public.technical_service_requests;
CREATE TRIGGER technical_service_requests_set_updated_at
  BEFORE UPDATE ON public.technical_service_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.technical_service_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.technical_service_request_media ENABLE ROW LEVEL SECURITY;

-- 2026-05-30 sonrasında yeni tablolar Data API'ye otomatik açılmayabildiği
-- için erişimler RLS'den ayrı olarak açıkça verilir.
GRANT SELECT, INSERT, UPDATE ON public.technical_service_requests TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.technical_service_request_media TO authenticated;
GRANT ALL ON public.technical_service_requests,
  public.technical_service_request_media TO service_role;
GRANT USAGE, SELECT
  ON SEQUENCE public.technical_service_requests_request_no_seq
  TO authenticated;

CREATE POLICY "technical_service_requests_managers_all"
ON public.technical_service_requests
FOR ALL TO authenticated
USING (public.can_manage_projects((SELECT auth.uid())))
WITH CHECK (public.can_manage_projects((SELECT auth.uid())));

CREATE POLICY "technical_service_requests_customer_read"
ON public.technical_service_requests
FOR SELECT TO authenticated
USING (
  created_by = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.customers AS customer
    WHERE customer.id = technical_service_requests.customer_id
      AND customer.contact_user_id = (SELECT auth.uid())
  )
);

CREATE POLICY "technical_service_requests_customer_insert"
ON public.technical_service_requests
FOR INSERT TO authenticated
WITH CHECK (
  created_by = (SELECT auth.uid())
  AND status = 'new'
  AND admin_note IS NULL
  AND converted_work_order_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.customers AS customer
    WHERE customer.id = technical_service_requests.customer_id
      AND customer.contact_user_id = (SELECT auth.uid())
  )
);

CREATE POLICY "technical_service_request_media_managers_all"
ON public.technical_service_request_media
FOR ALL TO authenticated
USING (public.can_manage_projects((SELECT auth.uid())))
WITH CHECK (public.can_manage_projects((SELECT auth.uid())));

CREATE POLICY "technical_service_request_media_customer_read"
ON public.technical_service_request_media
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.technical_service_requests AS request
    JOIN public.customers AS customer ON customer.id = request.customer_id
    WHERE request.id = technical_service_request_media.request_id
      AND request.created_by = (SELECT auth.uid())
      AND customer.contact_user_id = (SELECT auth.uid())
  )
);

CREATE POLICY "technical_service_request_media_customer_insert"
ON public.technical_service_request_media
FOR INSERT TO authenticated
WITH CHECK (
  uploaded_by = (SELECT auth.uid())
  AND (storage.foldername(storage_path))[1] = (SELECT auth.uid())::text
  AND (storage.foldername(storage_path))[2] = request_id::text
  AND EXISTS (
    SELECT 1
    FROM public.technical_service_requests AS request
    JOIN public.customers AS customer ON customer.id = request.customer_id
    WHERE request.id = technical_service_request_media.request_id
      AND request.created_by = (SELECT auth.uid())
      AND customer.contact_user_id = (SELECT auth.uid())
  )
);

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'technical-service-requests',
  'technical-service-requests',
  false,
  52428800,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'video/mp4',
    'video/quicktime'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "technical_service_storage_managers_all"
ON storage.objects
FOR ALL TO authenticated
USING (
  bucket_id = 'technical-service-requests'
  AND public.can_manage_projects((SELECT auth.uid()))
)
WITH CHECK (
  bucket_id = 'technical-service-requests'
  AND public.can_manage_projects((SELECT auth.uid()))
);

CREATE POLICY "technical_service_storage_customer_upload"
ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'technical-service-requests'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  AND EXISTS (
    SELECT 1
    FROM public.technical_service_requests AS request
    JOIN public.customers AS customer ON customer.id = request.customer_id
    WHERE request.id::text = (storage.foldername(name))[2]
      AND request.created_by = (SELECT auth.uid())
      AND customer.contact_user_id = (SELECT auth.uid())
  )
);

CREATE POLICY "technical_service_storage_customer_read"
ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'technical-service-requests'
  AND EXISTS (
    SELECT 1
    FROM public.technical_service_request_media AS media
    JOIN public.technical_service_requests AS request
      ON request.id = media.request_id
    JOIN public.customers AS customer ON customer.id = request.customer_id
    WHERE media.storage_path = storage.objects.name
      AND request.created_by = (SELECT auth.uid())
      AND customer.contact_user_id = (SELECT auth.uid())
  )
);

-- İş emri oluşturulduktan sonra yalnız operasyon yöneticisi bu bağlantıyı
-- kurabilir. Müşteri uyuşmazlığı engellenir; yanlış firmaya kayıt bağlanamaz.
CREATE OR REPLACE FUNCTION public.mark_technical_service_request_converted(
  target_request_id uuid,
  target_work_order_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  request_customer_id uuid;
  order_customer_id uuid;
  order_status public.work_status;
BEGIN
  IF NOT public.can_manage_projects((SELECT auth.uid())) THEN
    RAISE EXCEPTION 'Bu işlem için operasyon yönetim yetkisi gerekir';
  END IF;

  SELECT customer_id INTO request_customer_id
  FROM public.technical_service_requests
  WHERE id = target_request_id;

  IF request_customer_id IS NULL THEN
    RAISE EXCEPTION 'Teknik servis talebi bulunamadı';
  END IF;

  SELECT customer_id, status INTO order_customer_id, order_status
  FROM public.work_orders
  WHERE id = target_work_order_id;

  IF order_customer_id IS NULL OR order_customer_id <> request_customer_id THEN
    RAISE EXCEPTION 'İş emri ile teknik servis talebinin müşterisi uyuşmuyor';
  END IF;

  UPDATE public.technical_service_requests
  SET converted_work_order_id = target_work_order_id,
      status = CASE
        WHEN order_status = 'draft' THEN 'reviewing'
        ELSE 'planned'
      END
  WHERE id = target_request_id;
END;
$$;

REVOKE ALL
ON FUNCTION public.mark_technical_service_request_converted(uuid, uuid)
FROM PUBLIC, anon;
GRANT EXECUTE
ON FUNCTION public.mark_technical_service_request_converted(uuid, uuid)
TO authenticated;

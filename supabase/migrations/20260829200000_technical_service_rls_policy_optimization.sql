-- Yönetici ve müşteri politikalarını her işlem için tek permissive policy'de
-- birleştirir. Erişim kapsamı aynı kalır; Postgres daha az policy değerlendirir.
-- Storage INSERT kuralındaki gölgelenen `name` alanı da açıkça objects.name
-- olarak düzeltilir.

DROP POLICY IF EXISTS "technical_service_requests_managers_all"
ON public.technical_service_requests;
DROP POLICY IF EXISTS "technical_service_requests_customer_read"
ON public.technical_service_requests;
DROP POLICY IF EXISTS "technical_service_requests_customer_insert"
ON public.technical_service_requests;

CREATE POLICY "technical_service_requests_read"
ON public.technical_service_requests
FOR SELECT TO authenticated
USING (
  public.can_manage_projects((SELECT auth.uid()))
  OR (
    created_by = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.customers AS customer
      WHERE customer.id = technical_service_requests.customer_id
        AND customer.contact_user_id = (SELECT auth.uid())
    )
  )
);

CREATE POLICY "technical_service_requests_insert"
ON public.technical_service_requests
FOR INSERT TO authenticated
WITH CHECK (
  public.can_manage_projects((SELECT auth.uid()))
  OR (
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
  )
);

CREATE POLICY "technical_service_requests_manager_update"
ON public.technical_service_requests
FOR UPDATE TO authenticated
USING (public.can_manage_projects((SELECT auth.uid())))
WITH CHECK (public.can_manage_projects((SELECT auth.uid())));

CREATE POLICY "technical_service_requests_manager_delete"
ON public.technical_service_requests
FOR DELETE TO authenticated
USING (public.can_manage_projects((SELECT auth.uid())));

DROP POLICY IF EXISTS "technical_service_request_media_managers_all"
ON public.technical_service_request_media;
DROP POLICY IF EXISTS "technical_service_request_media_customer_read"
ON public.technical_service_request_media;
DROP POLICY IF EXISTS "technical_service_request_media_customer_insert"
ON public.technical_service_request_media;

CREATE POLICY "technical_service_request_media_read"
ON public.technical_service_request_media
FOR SELECT TO authenticated
USING (
  public.can_manage_projects((SELECT auth.uid()))
  OR EXISTS (
    SELECT 1
    FROM public.technical_service_requests AS request
    JOIN public.customers AS customer ON customer.id = request.customer_id
    WHERE request.id = technical_service_request_media.request_id
      AND request.created_by = (SELECT auth.uid())
      AND customer.contact_user_id = (SELECT auth.uid())
  )
);

CREATE POLICY "technical_service_request_media_insert"
ON public.technical_service_request_media
FOR INSERT TO authenticated
WITH CHECK (
  public.can_manage_projects((SELECT auth.uid()))
  OR (
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
  )
);

CREATE POLICY "technical_service_request_media_manager_update"
ON public.technical_service_request_media
FOR UPDATE TO authenticated
USING (public.can_manage_projects((SELECT auth.uid())))
WITH CHECK (public.can_manage_projects((SELECT auth.uid())));

CREATE POLICY "technical_service_request_media_manager_delete"
ON public.technical_service_request_media
FOR DELETE TO authenticated
USING (public.can_manage_projects((SELECT auth.uid())));

DROP POLICY IF EXISTS "technical_service_storage_managers_all"
ON storage.objects;
DROP POLICY IF EXISTS "technical_service_storage_customer_upload"
ON storage.objects;
DROP POLICY IF EXISTS "technical_service_storage_customer_read"
ON storage.objects;

CREATE POLICY "technical_service_storage_read"
ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'technical-service-requests'
  AND (
    public.can_manage_projects((SELECT auth.uid()))
    OR EXISTS (
      SELECT 1
      FROM public.technical_service_request_media AS media
      JOIN public.technical_service_requests AS request
        ON request.id = media.request_id
      JOIN public.customers AS customer ON customer.id = request.customer_id
      WHERE media.storage_path = storage.objects.name
        AND request.created_by = (SELECT auth.uid())
        AND customer.contact_user_id = (SELECT auth.uid())
    )
  )
);

CREATE POLICY "technical_service_storage_insert"
ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'technical-service-requests'
  AND (
    public.can_manage_projects((SELECT auth.uid()))
    OR (
      (storage.foldername(storage.objects.name))[1] = (SELECT auth.uid())::text
      AND EXISTS (
        SELECT 1
        FROM public.technical_service_requests AS request
        JOIN public.customers AS customer ON customer.id = request.customer_id
        WHERE request.id::text = (storage.foldername(storage.objects.name))[2]
          AND request.created_by = (SELECT auth.uid())
          AND customer.contact_user_id = (SELECT auth.uid())
      )
    )
  )
);

CREATE POLICY "technical_service_storage_manager_update"
ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'technical-service-requests'
  AND public.can_manage_projects((SELECT auth.uid()))
)
WITH CHECK (
  bucket_id = 'technical-service-requests'
  AND public.can_manage_projects((SELECT auth.uid()))
);

CREATE POLICY "technical_service_storage_manager_delete"
ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'technical-service-requests'
  AND public.can_manage_projects((SELECT auth.uid()))
);

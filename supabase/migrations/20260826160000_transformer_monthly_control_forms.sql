-- Aylık trafo kontrol kayıtlarına gerçek kontrol formu dosyasını bağlar.
-- Dosyalar yalnızca yöneticilerin erişebildiği özel bir Storage bucket'ında tutulur.

ALTER TABLE public.transformer_monthly_checks
  ADD COLUMN control_form_storage_path text,
  ADD COLUMN control_form_file_name text,
  ADD COLUMN control_form_mime_type text,
  ADD COLUMN control_form_size_bytes bigint,
  ADD COLUMN control_form_uploaded_at timestamptz,
  ADD COLUMN control_form_uploaded_by uuid
    REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD CONSTRAINT transformer_monthly_checks_control_form_mime_type_check
    CHECK (
      control_form_mime_type IS NULL
      OR control_form_mime_type IN (
        'application/pdf',
        'image/jpeg',
        'image/png',
        'image/webp'
      )
    ),
  ADD CONSTRAINT transformer_monthly_checks_control_form_size_check
    CHECK (
      control_form_size_bytes IS NULL
      OR control_form_size_bytes > 0
    ),
  ADD CONSTRAINT transformer_monthly_checks_control_form_metadata_check
    CHECK (
      (
        control_form_storage_path IS NULL
        AND control_form_file_name IS NULL
        AND control_form_mime_type IS NULL
        AND control_form_size_bytes IS NULL
        AND control_form_uploaded_at IS NULL
        AND control_form_uploaded_by IS NULL
      )
      OR (
        NULLIF(trim(control_form_storage_path), '') IS NOT NULL
        AND NULLIF(trim(control_form_file_name), '') IS NOT NULL
        AND control_form_mime_type IS NOT NULL
        AND control_form_size_bytes IS NOT NULL
        AND control_form_uploaded_at IS NOT NULL
      )
    );

CREATE UNIQUE INDEX transformer_monthly_checks_control_form_storage_path_key
  ON public.transformer_monthly_checks(control_form_storage_path)
  WHERE control_form_storage_path IS NOT NULL;

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'transformer-control-forms',
  'transformer-control-forms',
  false,
  20971520,
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "transformer_control_forms_admin_all" ON storage.objects;
CREATE POLICY "transformer_control_forms_admin_all"
ON storage.objects
FOR ALL TO authenticated
USING (
  bucket_id = 'transformer-control-forms'
  AND public.has_role((SELECT auth.uid()), 'admin')
)
WITH CHECK (
  bucket_id = 'transformer-control-forms'
  AND public.has_role((SELECT auth.uid()), 'admin')
  AND (storage.foldername(name))[1] = 'contracts'
  AND EXISTS (
    SELECT 1
    FROM public.transformer_responsibility_contracts AS contract
    WHERE contract.id::text = (storage.foldername(name))[2]
  )
);

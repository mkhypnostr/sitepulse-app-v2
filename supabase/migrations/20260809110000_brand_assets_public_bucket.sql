-- E-posta şablonlarında (send-notification-email) kalıcı, herkese açık bir
-- HTTPS logo URL'i gerekiyor. PUBLIC_APP_URL gibi opsiyonel/dışsal bir
-- domaine bağımlı olmak yerine, projenin kendi Supabase Storage'ında kalıcı
-- bir public bucket kullanılır.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'brand-assets',
  'brand-assets',
  true,
  2097152,
  ARRAY['image/png', 'image/svg+xml']::TEXT[]
)
ON CONFLICT (id) DO UPDATE
SET public = true,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "brand_assets_public_read" ON storage.objects;
CREATE POLICY "brand_assets_public_read" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'brand-assets');

DROP POLICY IF EXISTS "brand_assets_admin_write" ON storage.objects;
CREATE POLICY "brand_assets_admin_write" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'brand-assets' AND public.has_role((SELECT auth.uid()), 'admin'))
  WITH CHECK (bucket_id = 'brand-assets' AND public.has_role((SELECT auth.uid()), 'admin'));

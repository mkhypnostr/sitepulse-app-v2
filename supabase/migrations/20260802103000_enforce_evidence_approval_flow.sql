-- Kanıt, açıklama ve yönetici onayı zinciri:
-- İlerleme/kapanış yalnızca yetkili saha kullanıcısından gelir;
-- onaylı yüzde, yönetici incelemesine kadar değişmez.

ALTER TABLE public.photos
  ADD COLUMN IF NOT EXISTS is_document BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.submit_progress_update(
  target_work_order_id UUID,
  new_pct INTEGER,
  progress_note TEXT,
  evidence_storage_path TEXT,
  evidence_photo_type public.photo_type DEFAULT 'saha'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  normalized_note TEXT := trim(COALESCE(progress_note, ''));
  current_progress INTEGER;
  current_status public.work_status;
  evidence_mime_type TEXT;
  evidence_is_document BOOLEAN;
  new_photo_id UUID;
  new_update_id UUID;
  is_contractor BOOLEAN := public.has_role((SELECT auth.uid()), 'contractor');
  is_technical_office BOOLEAN := public.has_role((SELECT auth.uid()), 'technical_office');
BEGIN
  IF current_user_id IS NULL OR NOT (is_contractor OR is_technical_office) THEN
    RAISE EXCEPTION 'İlerleme bildirimini yalnızca atanmış taşeron veya teknik ofis gönderebilir';
  END IF;
  IF is_contractor AND NOT EXISTS (
    SELECT 1
    FROM public.work_order_assignments assignment
    WHERE assignment.work_order_id = target_work_order_id
      AND assignment.contractor_id = current_user_id
  ) THEN
    RAISE EXCEPTION 'Bu iş emri size atanmamış';
  END IF;
  IF new_pct IS NULL OR new_pct < 5 OR new_pct > 100 OR mod(new_pct, 5) <> 0 THEN
    RAISE EXCEPTION 'İlerleme 5 ile 100 arasında ve 5''in katı olmalıdır';
  END IF;
  IF char_length(normalized_note) < 10 THEN
    RAISE EXCEPTION 'Yapılan iş açıklaması en az 10 karakter olmalıdır';
  END IF;
  IF evidence_storage_path IS NULL OR trim(evidence_storage_path) = '' THEN
    RAISE EXCEPTION 'Yeni bir fotoğraf veya PDF belge zorunludur';
  END IF;
  IF evidence_storage_path NOT LIKE current_user_id::TEXT || '/' || target_work_order_id::TEXT || '/%' THEN
    RAISE EXCEPTION 'Kanıt dosyası bu kullanıcıya ve iş emrine ait değil';
  END IF;

  SELECT lower(COALESCE(object.metadata->>'mimetype', ''))
  INTO evidence_mime_type
  FROM storage.objects object
  WHERE object.bucket_id = 'work-photos'
    AND object.name = evidence_storage_path;

  IF evidence_mime_type IS NULL THEN
    RAISE EXCEPTION 'Kanıt dosyası yüklenmemiş';
  END IF;
  IF evidence_mime_type <> 'application/pdf' AND evidence_mime_type NOT LIKE 'image/%' THEN
    RAISE EXCEPTION 'Kanıt yalnızca fotoğraf veya PDF belge olabilir';
  END IF;
  evidence_is_document := evidence_mime_type = 'application/pdf';

  SELECT progress_pct, status
  INTO current_progress, current_status
  FROM public.work_orders
  WHERE id = target_work_order_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'İş emri bulunamadı'; END IF;
  IF current_status IN ('completed', 'cancelled', 'review_pending') THEN
    RAISE EXCEPTION 'Bu iş emrinin ilerlemesi bu durumda değiştirilemez';
  END IF;
  IF new_pct <= current_progress THEN
    RAISE EXCEPTION 'İlerleme mevcut onaylı değerden yüksek olmalıdır';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.progress_updates progress
    WHERE progress.work_order_id = target_work_order_id
      AND progress.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'Bu iş emri için zaten yönetici onayı bekleyen bir ilerleme vardır';
  END IF;

  INSERT INTO public.photos (
    work_order_id, uploaded_by, storage_path, caption, photo_type, show_to_customer, is_document
  ) VALUES (
    target_work_order_id, current_user_id, evidence_storage_path,
    normalized_note, evidence_photo_type, false, evidence_is_document
  ) RETURNING id INTO new_photo_id;

  INSERT INTO public.progress_updates (
    work_order_id, contractor_id, pct, note, status, evidence_photo_id
  ) VALUES (
    target_work_order_id, current_user_id, new_pct, normalized_note, 'pending', new_photo_id
  ) RETURNING id INTO new_update_id;

  RETURN new_update_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_work_for_review(
  target_work_order_id UUID,
  submitted_completion_note TEXT,
  completion_photo_ids UUID[]
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  current_progress INTEGER;
  current_status public.work_status;
  normalized_note TEXT := trim(COALESCE(submitted_completion_note, ''));
  distinct_evidence_count INTEGER;
  valid_evidence_count INTEGER;
  new_submission_id UUID;
  is_contractor BOOLEAN := public.has_role((SELECT auth.uid()), 'contractor');
  is_technical_office BOOLEAN := public.has_role((SELECT auth.uid()), 'technical_office');
BEGIN
  IF current_user_id IS NULL OR NOT (is_contractor OR is_technical_office) THEN
    RAISE EXCEPTION 'İş bitirme kaydını yalnızca atanmış taşeron veya teknik ofis gönderebilir';
  END IF;
  IF is_contractor AND NOT EXISTS (
    SELECT 1 FROM public.work_order_assignments assignment
    WHERE assignment.work_order_id = target_work_order_id
      AND assignment.contractor_id = current_user_id
  ) THEN
    RAISE EXCEPTION 'Bu iş emri size atanmamış';
  END IF;
  IF char_length(normalized_note) < 10 THEN
    RAISE EXCEPTION 'İş bitiş açıklaması en az 10 karakter olmalıdır';
  END IF;

  SELECT progress_pct, status
  INTO current_progress, current_status
  FROM public.work_orders
  WHERE id = target_work_order_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'İş emri bulunamadı'; END IF;
  IF current_status IN ('completed', 'cancelled', 'review_pending') THEN
    RAISE EXCEPTION 'Bu iş emri kontrole gönderilemez';
  END IF;
  IF current_progress <> 100 THEN
    RAISE EXCEPTION 'İşi kontrole göndermek için onaylı ilerleme %%100 olmalıdır';
  END IF;

  SELECT count(DISTINCT photo_id)
  INTO distinct_evidence_count
  FROM unnest(COALESCE(completion_photo_ids, ARRAY[]::UUID[])) AS selected(photo_id);

  IF distinct_evidence_count < 1 OR distinct_evidence_count > 5 THEN
    RAISE EXCEPTION 'Kapanış için en az 1, en fazla 5 fotoğraf veya belge seçin';
  END IF;

  SELECT count(*)
  INTO valid_evidence_count
  FROM public.photos photo
  WHERE photo.id = ANY(completion_photo_ids)
    AND photo.work_order_id = target_work_order_id
    AND photo.uploaded_by = current_user_id;

  IF valid_evidence_count <> distinct_evidence_count THEN
    RAISE EXCEPTION 'Seçilen kanıtlar bu işe ve kullanıcıya ait olmalıdır';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.work_completion_submissions submission
    WHERE submission.work_order_id = target_work_order_id
      AND submission.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'Bu iş için zaten kapanış onayı bekleyen bir kayıt vardır';
  END IF;

  INSERT INTO public.work_completion_submissions (work_order_id, submitted_by, note)
  VALUES (target_work_order_id, current_user_id, normalized_note)
  RETURNING id INTO new_submission_id;

  INSERT INTO public.work_completion_evidence (submission_id, photo_id)
  SELECT new_submission_id, photo_id
  FROM (SELECT DISTINCT unnest(completion_photo_ids) AS photo_id) selected;

  UPDATE public.work_orders
  SET status = 'review_pending'::public.work_status,
      completion_note = normalized_note,
      completion_submitted_at = now(),
      completion_submitted_by = current_user_id,
      review_note = NULL,
      reviewed_at = NULL,
      reviewed_by = NULL,
      updated_at = now()
  WHERE id = target_work_order_id;

  RETURN new_submission_id;
END;
$$;

-- İlerleme kayıtları yalnızca güvenli RPC fonksiyonlarından oluşur.
DROP POLICY IF EXISTS "pu_admin_all" ON public.progress_updates;
DROP POLICY IF EXISTS "pu_contractor_insert" ON public.progress_updates;

CREATE POLICY "pu_admin_read" ON public.progress_updates
FOR SELECT TO authenticated
USING (public.has_role((SELECT auth.uid()), 'admin'));

GRANT SELECT ON public.progress_updates TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.progress_updates FROM authenticated;

REVOKE ALL ON FUNCTION public.submit_progress_update(UUID, INTEGER, TEXT, TEXT, public.photo_type) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_work_for_review(UUID, TEXT, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_progress_update(UUID, INTEGER, TEXT, TEXT, public.photo_type) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_work_for_review(UUID, TEXT, UUID[]) TO authenticated;

-- Teknik ofis, kendi hesabıyla kanıt ekleyebilir; finansal veya onay yetkisi kazanmaz.
DROP POLICY IF EXISTS "photos_technical_office_write" ON public.photos;
CREATE POLICY "photos_technical_office_write" ON public.photos
FOR INSERT TO authenticated
WITH CHECK (
  public.has_role((SELECT auth.uid()), 'technical_office')
  AND uploaded_by = (SELECT auth.uid())
);

DROP POLICY IF EXISTS "wp_technical_office_upload" ON storage.objects;
CREATE POLICY "wp_technical_office_upload" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'work-photos'
  AND public.has_role((SELECT auth.uid()), 'technical_office')
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
);

DROP POLICY IF EXISTS "wp_technical_office_read" ON storage.objects;
CREATE POLICY "wp_technical_office_read" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'work-photos'
  AND public.has_role((SELECT auth.uid()), 'technical_office')
);

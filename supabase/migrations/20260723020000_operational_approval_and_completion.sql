-- Operasyon akışı: ilerlemeyi yalnızca atanmış taşeron gönderir,
-- yüzdeler 5'in katıdır ve iş kapanışı 1-5 seçilmiş fotoğrafla onaya gider.

CREATE TABLE IF NOT EXISTS public.work_completion_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id UUID NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  submitted_by UUID NOT NULL REFERENCES public.profiles(id),
  note TEXT NOT NULL CHECK (char_length(trim(note)) >= 10),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'revision_requested')),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by UUID REFERENCES public.profiles(id),
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  CONSTRAINT work_completion_review_state_check CHECK (
    (status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR
    (status <> 'pending' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS work_completion_one_pending_idx
  ON public.work_completion_submissions(work_order_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS work_completion_order_submitted_idx
  ON public.work_completion_submissions(work_order_id, submitted_at DESC);

CREATE TABLE IF NOT EXISTS public.work_completion_evidence (
  submission_id UUID NOT NULL
    REFERENCES public.work_completion_submissions(id) ON DELETE CASCADE,
  photo_id UUID NOT NULL REFERENCES public.photos(id) ON DELETE RESTRICT,
  PRIMARY KEY (submission_id, photo_id)
);

ALTER TABLE public.work_completion_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_completion_evidence ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.work_completion_submissions, public.work_completion_evidence TO authenticated;
GRANT ALL ON public.work_completion_submissions, public.work_completion_evidence TO service_role;

DROP POLICY IF EXISTS "completion_submissions_admin_read" ON public.work_completion_submissions;
CREATE POLICY "completion_submissions_admin_read"
ON public.work_completion_submissions FOR SELECT TO authenticated
USING (public.has_role((SELECT auth.uid()), 'admin'));

DROP POLICY IF EXISTS "completion_submissions_contractor_read" ON public.work_completion_submissions;
CREATE POLICY "completion_submissions_contractor_read"
ON public.work_completion_submissions FOR SELECT TO authenticated
USING (
  submitted_by = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.work_order_assignments assignment
    WHERE assignment.work_order_id = work_completion_submissions.work_order_id
      AND assignment.contractor_id = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS "completion_evidence_admin_read" ON public.work_completion_evidence;
CREATE POLICY "completion_evidence_admin_read"
ON public.work_completion_evidence FOR SELECT TO authenticated
USING (public.has_role((SELECT auth.uid()), 'admin'));

DROP POLICY IF EXISTS "completion_evidence_contractor_read" ON public.work_completion_evidence;
CREATE POLICY "completion_evidence_contractor_read"
ON public.work_completion_evidence FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.work_completion_submissions submission
    WHERE submission.id = work_completion_evidence.submission_id
      AND submission.submitted_by = (SELECT auth.uid())
  )
);

DROP FUNCTION IF EXISTS public.submit_work_for_review(UUID, TEXT);

CREATE FUNCTION public.submit_work_for_review(
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
  current_progress INT;
  current_status public.work_status;
  normalized_note TEXT := trim(COALESCE(submitted_completion_note, ''));
  distinct_photo_count INT;
  valid_photo_count INT;
  new_submission_id UUID;
BEGIN
  IF current_user_id IS NULL
     OR NOT public.has_role(current_user_id, 'contractor') THEN
    RAISE EXCEPTION 'İş bitirme kaydını yalnızca taşeron gönderebilir';
  END IF;
  IF NOT EXISTS (
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
  INTO distinct_photo_count
  FROM unnest(COALESCE(completion_photo_ids, ARRAY[]::UUID[])) AS selected(photo_id);

  IF distinct_photo_count < 1 OR distinct_photo_count > 5 THEN
    RAISE EXCEPTION 'Kapanış için en az 1, en fazla 5 fotoğraf seçin';
  END IF;

  SELECT count(*)
  INTO valid_photo_count
  FROM public.photos photo
  WHERE photo.id = ANY(completion_photo_ids)
    AND photo.work_order_id = target_work_order_id
    AND photo.uploaded_by = current_user_id;

  IF valid_photo_count <> distinct_photo_count THEN
    RAISE EXCEPTION 'Seçilen fotoğraflar bu işe ve kullanıcıya ait olmalıdır';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.work_completion_submissions submission
    WHERE submission.work_order_id = target_work_order_id
      AND submission.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'Bu iş için zaten kapanış onayı bekleyen bir kayıt vardır';
  END IF;

  INSERT INTO public.work_completion_submissions (
    work_order_id, submitted_by, note
  ) VALUES (
    target_work_order_id, current_user_id, normalized_note
  )
  RETURNING id INTO new_submission_id;

  INSERT INTO public.work_completion_evidence (submission_id, photo_id)
  SELECT new_submission_id, photo_id
  FROM (
    SELECT DISTINCT unnest(completion_photo_ids) AS photo_id
  ) selected;

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

CREATE OR REPLACE FUNCTION public.review_work_completion(
  target_work_order_id UUID,
  approve_completion BOOLEAN,
  manager_review_note TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  current_status public.work_status;
  normalized_note TEXT := NULLIF(trim(COALESCE(manager_review_note, '')), '');
  pending_submission_id UUID;
BEGIN
  IF current_user_id IS NULL OR NOT public.has_role(current_user_id, 'admin') THEN
    RAISE EXCEPTION 'Bu işlem için yönetici yetkisi gerekir';
  END IF;
  IF NOT approve_completion AND normalized_note IS NULL THEN
    RAISE EXCEPTION 'Revizyona gönderirken açıklama zorunludur';
  END IF;

  SELECT status INTO current_status
  FROM public.work_orders
  WHERE id = target_work_order_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'İş emri bulunamadı'; END IF;
  IF current_status <> 'review_pending' THEN
    RAISE EXCEPTION 'Bu iş emri yönetici kontrolünde değil';
  END IF;

  SELECT id INTO pending_submission_id
  FROM public.work_completion_submissions
  WHERE work_order_id = target_work_order_id AND status = 'pending'
  ORDER BY submitted_at DESC
  LIMIT 1
  FOR UPDATE;

  IF pending_submission_id IS NULL THEN
    RAISE EXCEPTION 'Kapanış gönderimi bulunamadı';
  END IF;

  UPDATE public.work_completion_submissions
  SET status = CASE WHEN approve_completion THEN 'approved' ELSE 'revision_requested' END,
      reviewed_by = current_user_id,
      reviewed_at = now(),
      review_note = normalized_note
  WHERE id = pending_submission_id;

  UPDATE public.work_orders
  SET status = CASE
        WHEN approve_completion THEN 'completed'::public.work_status
        ELSE 'in_progress'::public.work_status
      END,
      review_note = normalized_note,
      reviewed_at = now(),
      reviewed_by = current_user_id,
      updated_at = now()
  WHERE id = target_work_order_id;
END;
$$;

-- İş emri ilerleme bildirimi: yalnızca atanmış taşeron, 5'in katı yüzde,
-- yeni kanıt fotoğrafı ve en az 10 karakter açıklama.
CREATE OR REPLACE FUNCTION public.submit_progress_update(
  target_work_order_id UUID,
  new_pct INT,
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
  current_progress INT;
  current_status public.work_status;
  new_photo_id UUID;
  new_update_id UUID;
BEGIN
  IF current_user_id IS NULL OR NOT public.has_role(current_user_id, 'contractor') THEN
    RAISE EXCEPTION 'İlerleme bildirimini yalnızca taşeron gönderebilir';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.work_order_assignments assignment
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
    RAISE EXCEPTION 'Yeni bir kanıt fotoğrafı zorunludur';
  END IF;
  IF evidence_storage_path NOT LIKE current_user_id::TEXT || '/' || target_work_order_id::TEXT || '/%' THEN
    RAISE EXCEPTION 'Kanıt fotoğrafı bu kullanıcıya ve iş emrine ait değil';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM storage.objects object
    WHERE object.bucket_id = 'work-photos' AND object.name = evidence_storage_path
  ) THEN
    RAISE EXCEPTION 'Kanıt fotoğrafı yüklenmemiş';
  END IF;

  SELECT progress_pct, status INTO current_progress, current_status
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
    WHERE progress.work_order_id = target_work_order_id AND progress.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'Bu iş emri için zaten yönetici onayı bekleyen bir ilerleme vardır';
  END IF;

  INSERT INTO public.photos (
    work_order_id, uploaded_by, storage_path, caption, photo_type, show_to_customer
  ) VALUES (
    target_work_order_id, current_user_id, evidence_storage_path,
    normalized_note, evidence_photo_type, false
  )
  RETURNING id INTO new_photo_id;

  INSERT INTO public.progress_updates (
    work_order_id, contractor_id, pct, note, status, evidence_photo_id
  ) VALUES (
    target_work_order_id, current_user_id, new_pct, normalized_note, 'pending', new_photo_id
  )
  RETURNING id INTO new_update_id;

  RETURN new_update_id;
END;
$$;

-- Proje görevi ilerlemesi de yalnızca atanmış taşeron tarafından,
-- 5'in katı yüzde ve yeni kanıtla gönderilir.
CREATE OR REPLACE FUNCTION public.submit_project_task_progress(
  target_task_id UUID,
  proposed_progress INTEGER,
  progress_note TEXT,
  actual_on DATE DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  current_task public.project_tasks%ROWTYPE;
  new_submission_id UUID;
  unlinked_evidence_count INTEGER;
  unlinked_photo_count INTEGER;
  unlinked_document_count INTEGER;
  normalized_note TEXT := trim(COALESCE(progress_note, ''));
BEGIN
  IF current_user_id IS NULL OR NOT public.has_role(current_user_id, 'contractor') THEN
    RAISE EXCEPTION 'İlerleme göndermek için taşeron yetkisi gerekir';
  END IF;

  SELECT * INTO current_task
  FROM public.project_tasks
  WHERE id = target_task_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Görev bulunamadı'; END IF;
  IF current_task.responsible_id IS DISTINCT FROM current_user_id THEN
    RAISE EXCEPTION 'Bu görev size atanmamış';
  END IF;
  IF current_task.status IN ('completed', 'not_applicable') THEN
    RAISE EXCEPTION 'Bu görev ilerleme gönderimine kapalıdır';
  END IF;
  IF proposed_progress IS NULL
     OR proposed_progress <= current_task.approved_progress_pct
     OR proposed_progress > 100
     OR mod(proposed_progress, 5) <> 0 THEN
    RAISE EXCEPTION 'İlerleme mevcut onaylı orandan yüksek, en fazla 100 ve 5''in katı olmalıdır';
  END IF;
  IF char_length(normalized_note) < 10 THEN
    RAISE EXCEPTION 'Yapılan iş açıklaması en az 10 karakter olmalıdır';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.project_task_progress_submissions submission
    WHERE submission.project_task_id = target_task_id AND submission.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'Bu görev için zaten onay bekleyen bir ilerleme vardır';
  END IF;

  SELECT
    count(*)::INTEGER,
    count(*) FILTER (WHERE evidence_type = 'photo')::INTEGER,
    count(*) FILTER (WHERE evidence_type = 'document')::INTEGER
  INTO unlinked_evidence_count, unlinked_photo_count, unlinked_document_count
  FROM public.project_task_evidence
  WHERE project_task_id = target_task_id
    AND uploaded_by = current_user_id
    AND submission_id IS NULL;

  IF unlinked_evidence_count = 0 THEN
    RAISE EXCEPTION 'Onaya göndermeden önce yeni bir fotoğraf veya belge ekleyin';
  END IF;
  IF current_task.requires_photo AND unlinked_photo_count = 0 THEN
    RAISE EXCEPTION 'Bu görev için yeni bir fotoğraf ekleyin';
  END IF;
  IF current_task.requires_document AND unlinked_document_count = 0 THEN
    RAISE EXCEPTION 'Bu görev için yeni bir PDF belge ekleyin';
  END IF;

  INSERT INTO public.project_task_progress_submissions (
    project_task_id, proposed_pct, note, proposed_actual_date, submitted_by
  ) VALUES (
    target_task_id, proposed_progress, normalized_note, actual_on, current_user_id
  )
  RETURNING id INTO new_submission_id;

  UPDATE public.project_task_evidence
  SET submission_id = new_submission_id
  WHERE project_task_id = target_task_id
    AND uploaded_by = current_user_id
    AND submission_id IS NULL;

  UPDATE public.project_tasks
  SET status = 'external_approval',
      actual_date = COALESCE(actual_on, actual_date)
  WHERE id = target_task_id;

  INSERT INTO public.project_task_activity (
    project_task_id, actor_user_id, old_status, new_status, note
  ) VALUES (
    target_task_id, current_user_id, current_task.status, 'external_approval',
    format('%%%s ilerleme onaya gönderildi: %s', proposed_progress, normalized_note)
  );

  RETURN new_submission_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_work_for_review(UUID, TEXT, UUID[])
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.review_work_completion(UUID, BOOLEAN, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_progress_update(UUID, INT, TEXT, TEXT, public.photo_type)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_project_task_progress(UUID, INTEGER, TEXT, DATE)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.submit_work_for_review(UUID, TEXT, UUID[])
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_work_completion(UUID, BOOLEAN, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_progress_update(UUID, INT, TEXT, TEXT, public.photo_type)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_project_task_progress(UUID, INTEGER, TEXT, DATE)
  TO authenticated;

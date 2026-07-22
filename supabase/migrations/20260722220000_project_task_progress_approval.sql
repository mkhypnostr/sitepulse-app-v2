-- Proje görevlerinde kanıtlı ilerleme gönderimi, yönetici onayı ve denetim kaydı.

DO $$
BEGIN
  CREATE TYPE public.project_progress_submission_status AS ENUM (
    'pending',
    'approved',
    'revision_requested'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE public.project_tasks
  ADD COLUMN IF NOT EXISTS approved_progress_pct INTEGER NOT NULL DEFAULT 0
  CHECK (approved_progress_pct BETWEEN 0 AND 100);

UPDATE public.project_tasks
SET approved_progress_pct = 100
WHERE status = 'completed'
  AND approved_progress_pct = 0;

CREATE TABLE IF NOT EXISTS public.project_task_progress_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_task_id UUID NOT NULL REFERENCES public.project_tasks(id) ON DELETE CASCADE,
  proposed_pct INTEGER NOT NULL CHECK (proposed_pct BETWEEN 1 AND 100),
  note TEXT NOT NULL CHECK (NULLIF(trim(note), '') IS NOT NULL),
  proposed_actual_date DATE,
  status public.project_progress_submission_status NOT NULL DEFAULT 'pending',
  submitted_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  CONSTRAINT project_task_progress_review_state_check CHECK (
    (status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR
    (status <> 'pending' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS project_task_progress_one_pending_idx
  ON public.project_task_progress_submissions(project_task_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS project_task_progress_status_submitted_idx
  ON public.project_task_progress_submissions(status, submitted_at DESC);

CREATE INDEX IF NOT EXISTS project_task_progress_task_submitted_idx
  ON public.project_task_progress_submissions(project_task_id, submitted_at DESC);

ALTER TABLE public.project_task_evidence
  ADD COLUMN IF NOT EXISTS submission_id UUID
  REFERENCES public.project_task_progress_submissions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS project_task_evidence_submission_idx
  ON public.project_task_evidence(submission_id);

ALTER TABLE public.project_task_progress_submissions ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.project_task_progress_submissions TO authenticated;
GRANT ALL ON public.project_task_progress_submissions TO service_role;

DROP POLICY IF EXISTS "project_task_progress_admin_read" ON public.project_task_progress_submissions;
CREATE POLICY "project_task_progress_admin_read"
ON public.project_task_progress_submissions
FOR SELECT TO authenticated
USING (public.has_role((SELECT auth.uid()), 'admin'));

DROP POLICY IF EXISTS "project_task_progress_contractor_read_own" ON public.project_task_progress_submissions;
CREATE POLICY "project_task_progress_contractor_read_own"
ON public.project_task_progress_submissions
FOR SELECT TO authenticated
USING (
  submitted_by = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.project_tasks AS task
    WHERE task.id = project_task_progress_submissions.project_task_id
      AND task.responsible_id = (SELECT auth.uid())
  )
);

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
  normalized_note TEXT := NULLIF(trim(progress_note), '');
BEGIN
  IF current_user_id IS NULL
     OR NOT (
       public.has_role(current_user_id, 'contractor')
       OR public.has_role(current_user_id, 'admin')
     ) THEN
    RAISE EXCEPTION 'İlerleme göndermek için taşeron veya yönetici yetkisi gerekir';
  END IF;

  SELECT *
  INTO current_task
  FROM public.project_tasks
  WHERE id = target_task_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Görev bulunamadı';
  END IF;

  IF NOT public.has_role(current_user_id, 'admin')
     AND current_task.responsible_id IS DISTINCT FROM current_user_id THEN
    RAISE EXCEPTION 'Bu görev size atanmamış';
  END IF;

  IF current_task.status IN ('completed', 'not_applicable') THEN
    RAISE EXCEPTION 'Bu görev ilerleme gönderimine kapalıdır';
  END IF;

  IF proposed_progress IS NULL
     OR proposed_progress <= current_task.approved_progress_pct
     OR proposed_progress > 100 THEN
    RAISE EXCEPTION 'Önerilen ilerleme mevcut onaylı orandan yüksek ve en fazla 100 olmalıdır';
  END IF;

  IF normalized_note IS NULL THEN
    RAISE EXCEPTION 'Yapılan işi açıklayan bir not yazın';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.project_task_progress_submissions AS submission
    WHERE submission.project_task_id = target_task_id
      AND submission.status = 'pending'
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
    project_task_id,
    proposed_pct,
    note,
    proposed_actual_date,
    submitted_by
  )
  VALUES (
    target_task_id,
    proposed_progress,
    normalized_note,
    actual_on,
    current_user_id
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
    project_task_id,
    actor_user_id,
    old_status,
    new_status,
    note
  )
  VALUES (
    target_task_id,
    current_user_id,
    current_task.status,
    'external_approval',
    format('%%%s ilerleme onaya gönderildi: %s', proposed_progress, normalized_note)
  );

  RETURN new_submission_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.review_project_task_progress(
  target_submission_id UUID,
  approve_submission BOOLEAN,
  decision_note TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  current_submission public.project_task_progress_submissions%ROWTYPE;
  current_task public.project_tasks%ROWTYPE;
  normalized_note TEXT := NULLIF(trim(decision_note), '');
  decided_status public.project_task_status;
BEGIN
  IF current_user_id IS NULL OR NOT public.has_role(current_user_id, 'admin') THEN
    RAISE EXCEPTION 'Bu işlem için yönetici yetkisi gerekir';
  END IF;

  SELECT *
  INTO current_submission
  FROM public.project_task_progress_submissions
  WHERE id = target_submission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'İlerleme gönderimi bulunamadı';
  END IF;

  IF current_submission.status <> 'pending' THEN
    RAISE EXCEPTION 'Bu ilerleme gönderimi daha önce sonuçlandırılmış';
  END IF;

  IF NOT approve_submission AND normalized_note IS NULL THEN
    RAISE EXCEPTION 'Revizyon isterken açıklama yazın';
  END IF;

  SELECT *
  INTO current_task
  FROM public.project_tasks
  WHERE id = current_submission.project_task_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Görev bulunamadı';
  END IF;

  IF approve_submission
     AND current_submission.proposed_pct <= current_task.approved_progress_pct THEN
    RAISE EXCEPTION 'Görev ilerlemesi bu gönderimden sonra zaten güncellenmiş';
  END IF;

  UPDATE public.project_task_progress_submissions
  SET status = CASE
        WHEN approve_submission THEN 'approved'::public.project_progress_submission_status
        ELSE 'revision_requested'::public.project_progress_submission_status
      END,
      reviewed_by = current_user_id,
      reviewed_at = now(),
      review_note = normalized_note
  WHERE id = target_submission_id;

  decided_status := CASE
    WHEN NOT approve_submission THEN 'revision_required'::public.project_task_status
    WHEN current_submission.proposed_pct = 100 THEN 'completed'::public.project_task_status
    ELSE 'in_progress'::public.project_task_status
  END;

  UPDATE public.project_tasks
  SET approved_progress_pct = CASE
        WHEN approve_submission THEN current_submission.proposed_pct
        ELSE approved_progress_pct
      END,
      status = decided_status,
      actual_date = CASE
        WHEN approve_submission AND current_submission.proposed_pct = 100
          THEN COALESCE(current_submission.proposed_actual_date, actual_date, CURRENT_DATE)
        ELSE actual_date
      END,
      completed_at = CASE
        WHEN approve_submission AND current_submission.proposed_pct = 100 THEN now()
        ELSE NULL
      END,
      completed_by = CASE
        WHEN approve_submission AND current_submission.proposed_pct = 100 THEN current_user_id
        ELSE NULL
      END
  WHERE id = current_submission.project_task_id;

  INSERT INTO public.project_task_activity (
    project_task_id,
    actor_user_id,
    old_status,
    new_status,
    note
  )
  VALUES (
    current_submission.project_task_id,
    current_user_id,
    current_task.status,
    decided_status,
    CASE
      WHEN approve_submission THEN format(
        '%%%s ilerleme onaylandı%s',
        current_submission.proposed_pct,
        CASE WHEN normalized_note IS NULL THEN '' ELSE ': ' || normalized_note END
      )
      ELSE 'Revizyon istendi: ' || normalized_note
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_project_task_progress(UUID, INTEGER, TEXT, DATE)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.review_project_task_progress(UUID, BOOLEAN, TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.submit_project_task_progress(UUID, INTEGER, TEXT, DATE)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_project_task_progress(UUID, BOOLEAN, TEXT)
  TO authenticated;

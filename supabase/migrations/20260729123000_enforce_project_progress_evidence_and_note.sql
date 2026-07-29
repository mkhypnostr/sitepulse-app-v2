-- Proje görevi ilerlemesi: yalnızca atanmış taşeron/teknik ofis gönderir;
-- en az 10 karakter açıklama ve yeni kanıt olmadan ilerleme gönderilemez.

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
       OR public.has_role(current_user_id, 'technical_office')
     ) THEN
    RAISE EXCEPTION 'İlerleme yalnızca atanmış taşeron veya teknik ofis tarafından gönderilebilir';
  END IF;

  SELECT *
  INTO current_task
  FROM public.project_tasks
  WHERE id = target_task_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Görev bulunamadı';
  END IF;

  IF current_task.responsible_id IS DISTINCT FROM current_user_id THEN
    RAISE EXCEPTION 'Bu görev size atanmamış';
  END IF;

  IF current_task.status IN ('completed', 'not_applicable') THEN
    RAISE EXCEPTION 'Bu görev ilerleme gönderimine kapalıdır';
  END IF;

  IF proposed_progress IS NULL
     OR proposed_progress <= current_task.approved_progress_pct
     OR proposed_progress > 100
     OR proposed_progress % 5 <> 0 THEN
    RAISE EXCEPTION 'Önerilen ilerleme mevcut onaylı orandan yüksek, en fazla 100 ve 5''in katı olmalıdır';
  END IF;

  IF normalized_note IS NULL OR char_length(normalized_note) < 10 THEN
    RAISE EXCEPTION 'Yapılan iş açıklaması en az 10 karakter olmalıdır';
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
    project_task_id, proposed_pct, note, proposed_actual_date, submitted_by
  ) VALUES (
    target_task_id, proposed_progress, normalized_note, actual_on, current_user_id
  ) RETURNING id INTO new_submission_id;

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
    target_task_id,
    current_user_id,
    current_task.status,
    'external_approval',
    format('%%%s ilerleme onaya gönderildi: %s', proposed_progress, normalized_note)
  );

  RETURN new_submission_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_project_task_progress(UUID, INTEGER, TEXT, DATE)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_project_task_progress(UUID, INTEGER, TEXT, DATE)
  TO authenticated;

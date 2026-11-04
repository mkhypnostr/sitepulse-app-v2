-- Proje görevini yönetici/teknik ofis doğrudan işler (kanıtla tamamlama).
--
-- Sorun: İlerleme yalnız göreve atanmış taşeron/teknik ofis tarafından
-- gönderilebiliyordu; görev bir yöneticiye atanmışsa veya sistemde teknik ofis
-- yoksa hiç kimse görevi tamamlayamıyordu.
--
-- Çözüm: Proje yöneten kullanıcı (yönetici, teknik ofis) ilerlemeyi doğrudan
-- onaylı olarak kaydeder. Görevin zorunlu fotoğraf/belge kuralı aynen geçerli;
-- kayıt işlem geçmişine "onaylandı" olarak düşer, kim ve ne zaman yazılır.
-- Taşeron akışı değişmez. Tekrar çalıştırılabilir; veri silmez.

CREATE OR REPLACE FUNCTION public.record_project_task_progress(
  target_task_id uuid,
  new_progress integer,
  progress_note text,
  actual_on date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  current_user_id uuid := (SELECT auth.uid());
  current_task public.project_tasks%ROWTYPE;
  parent_project_status public.project_status;
  normalized_note text := NULLIF(trim(progress_note), '');
  unlinked_photo_count integer;
  unlinked_document_count integer;
  new_submission_id uuid;
  decided_status public.project_task_status;
BEGIN
  IF current_user_id IS NULL OR NOT public.can_manage_projects(current_user_id) THEN
    RAISE EXCEPTION 'Bu işlem için yönetici veya teknik ofis yetkisi gerekir';
  END IF;

  SELECT task.* INTO current_task
  FROM public.project_tasks AS task
  WHERE task.id = target_task_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Görev bulunamadı';
  END IF;

  SELECT project.status INTO parent_project_status
  FROM public.projects AS project
  WHERE project.id = current_task.project_id;
  IF parent_project_status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Tamamlanan veya iptal edilen projenin görevleri değiştirilemez';
  END IF;

  IF current_task.status IN ('completed', 'not_applicable') THEN
    RAISE EXCEPTION 'Bu görev kapalı';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.project_task_progress_submissions AS s
    WHERE s.project_task_id = target_task_id AND s.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'Onay bekleyen bir ilerleme var; önce onu onaylayın veya revizyon isteyin';
  END IF;

  IF new_progress IS NULL
     OR new_progress <= current_task.approved_progress_pct
     OR new_progress > 100
     OR new_progress % 5 <> 0 THEN
    RAISE EXCEPTION 'İlerleme mevcut orandan yüksek, en fazla 100 ve 5''in katı olmalıdır';
  END IF;

  IF normalized_note IS NULL OR char_length(normalized_note) < 10 THEN
    RAISE EXCEPTION 'Açıklama en az 10 karakter olmalıdır';
  END IF;

  SELECT
    count(*) FILTER (WHERE evidence_type = 'photo')::integer,
    count(*) FILTER (WHERE evidence_type = 'document')::integer
  INTO unlinked_photo_count, unlinked_document_count
  FROM public.project_task_evidence
  WHERE project_task_id = target_task_id
    AND uploaded_by = current_user_id
    AND submission_id IS NULL;

  IF new_progress = 100 AND current_task.requires_photo AND unlinked_photo_count = 0 THEN
    RAISE EXCEPTION 'Bu görev için fotoğraf ekleyin';
  END IF;
  IF new_progress = 100 AND current_task.requires_document AND unlinked_document_count = 0 THEN
    RAISE EXCEPTION 'Bu görev için PDF belge ekleyin';
  END IF;

  INSERT INTO public.project_task_progress_submissions (
    project_task_id, proposed_pct, note, proposed_actual_date,
    status, submitted_by, reviewed_by, reviewed_at, review_note
  ) VALUES (
    target_task_id, new_progress, normalized_note, actual_on,
    'approved', current_user_id, current_user_id, now(),
    'Yönetici/teknik ofis tarafından doğrudan işlendi'
  ) RETURNING id INTO new_submission_id;

  UPDATE public.project_task_evidence
  SET submission_id = new_submission_id
  WHERE project_task_id = target_task_id
    AND uploaded_by = current_user_id
    AND submission_id IS NULL;

  decided_status := CASE
    WHEN new_progress = 100 THEN 'completed'::public.project_task_status
    ELSE 'in_progress'::public.project_task_status
  END;

  UPDATE public.project_tasks
  SET approved_progress_pct = new_progress,
      status = decided_status,
      actual_date = CASE
        WHEN new_progress = 100 THEN COALESCE(actual_on, actual_date, CURRENT_DATE)
        ELSE COALESCE(actual_on, actual_date)
      END,
      completed_at = CASE WHEN new_progress = 100 THEN now() ELSE NULL END,
      completed_by = CASE WHEN new_progress = 100 THEN current_user_id ELSE NULL END
  WHERE id = target_task_id;

  INSERT INTO public.project_task_activity (
    project_task_id, actor_user_id, old_status, new_status, note
  ) VALUES (
    target_task_id, current_user_id, current_task.status, decided_status,
    format('%%%s ilerleme doğrudan işlendi: %s', new_progress, normalized_note)
  );

  RETURN new_submission_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_project_task_progress(uuid, integer, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_project_task_progress(uuid, integer, text, date) TO authenticated;

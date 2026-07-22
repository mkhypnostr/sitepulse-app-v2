-- Projelerin taslaktan kapanışa kadar güvenli biçimde yönetilmesi.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status_note TEXT;

UPDATE public.projects
SET status_changed_at = COALESCE(status_changed_at, updated_at, created_at, now())
WHERE status_changed_at IS NULL;

ALTER TABLE public.projects
  ALTER COLUMN status_changed_at SET DEFAULT now(),
  ALTER COLUMN status_changed_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'projects_status_note_length_check'
      AND conrelid = 'public.projects'::regclass
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_status_note_length_check
      CHECK (status_note IS NULL OR length(status_note) <= 1000);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_project_lifecycle(
  target_project_id UUID,
  new_status public.project_status,
  change_note TEXT DEFAULT NULL
)
RETURNS public.project_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  current_status public.project_status;
  normalized_note TEXT := NULLIF(trim(change_note), '');
BEGIN
  IF current_user_id IS NULL OR NOT public.has_role(current_user_id, 'admin') THEN
    RAISE EXCEPTION 'Bu işlem için yönetici yetkisi gerekir';
  END IF;

  SELECT status
  INTO current_status
  FROM public.projects
  WHERE id = target_project_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proje bulunamadı';
  END IF;

  IF current_status = new_status THEN
    RETURN current_status;
  END IF;

  IF NOT (
    (current_status = 'draft' AND new_status = 'active') OR
    (current_status = 'active' AND new_status IN ('on_hold', 'completed', 'cancelled')) OR
    (current_status = 'on_hold' AND new_status IN ('active', 'cancelled')) OR
    (current_status = 'completed' AND new_status = 'active')
  ) THEN
    RAISE EXCEPTION 'Bu proje durum geçişine izin verilmiyor';
  END IF;

  IF (
    new_status IN ('on_hold', 'cancelled') OR
    (current_status = 'completed' AND new_status = 'active')
  ) AND normalized_note IS NULL THEN
    RAISE EXCEPTION 'Bu durum değişikliği için kısa bir açıklama yazın';
  END IF;

  IF new_status = 'completed' AND EXISTS (
    SELECT 1
    FROM public.project_tasks
    WHERE project_id = target_project_id
      AND status NOT IN ('completed', 'not_applicable')
  ) THEN
    RAISE EXCEPTION 'Projeyi tamamlamak için bütün uygulanabilir görevleri tamamlayın';
  END IF;

  UPDATE public.projects
  SET
    status = new_status,
    start_date = CASE
      WHEN new_status = 'active' AND start_date IS NULL THEN CURRENT_DATE
      ELSE start_date
    END,
    status_changed_at = now(),
    status_note = normalized_note
  WHERE id = target_project_id;

  RETURN new_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_project_details(
  target_project_id UUID,
  project_name TEXT,
  project_external_reference_no TEXT DEFAULT NULL,
  project_location_url TEXT DEFAULT NULL,
  project_province TEXT DEFAULT NULL,
  project_district TEXT DEFAULT NULL,
  project_neighborhood TEXT DEFAULT NULL,
  project_block_no TEXT DEFAULT NULL,
  project_parcel_no TEXT DEFAULT NULL,
  project_area NUMERIC DEFAULT NULL,
  target_manager_id UUID DEFAULT NULL,
  project_start_date DATE DEFAULT NULL,
  project_target_end_date DATE DEFAULT NULL,
  visible_to_customer BOOLEAN DEFAULT false,
  project_description TEXT DEFAULT NULL,
  project_admin_notes TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  current_status public.project_status;
  normalized_location_url TEXT := NULLIF(trim(project_location_url), '');
BEGIN
  IF current_user_id IS NULL OR NOT public.has_role(current_user_id, 'admin') THEN
    RAISE EXCEPTION 'Bu işlem için yönetici yetkisi gerekir';
  END IF;

  SELECT status
  INTO current_status
  FROM public.projects
  WHERE id = target_project_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proje bulunamadı';
  END IF;

  IF current_status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Tamamlanan veya iptal edilen projeyi önce yeniden aktifleştirin';
  END IF;

  IF NULLIF(trim(project_name), '') IS NULL THEN
    RAISE EXCEPTION 'Proje adı zorunludur';
  END IF;
  IF normalized_location_url IS NULL OR normalized_location_url !~* '^https://' THEN
    RAISE EXCEPTION 'Geçerli bir güvenli harita bağlantısı zorunludur';
  END IF;
  IF length(normalized_location_url) > 2048 THEN
    RAISE EXCEPTION 'Harita bağlantısı çok uzun';
  END IF;
  IF project_area IS NOT NULL AND project_area <= 0 THEN
    RAISE EXCEPTION 'Alan sıfırdan büyük olmalıdır';
  END IF;
  IF project_start_date IS NOT NULL
     AND project_target_end_date IS NOT NULL
     AND project_target_end_date < project_start_date THEN
    RAISE EXCEPTION 'Hedef bitiş tarihi başlangıçtan önce olamaz';
  END IF;
  IF target_manager_id IS NOT NULL
     AND NOT public.has_role(target_manager_id, 'admin') THEN
    RAISE EXCEPTION 'Proje sorumlusu yönetici rolünde olmalıdır';
  END IF;

  UPDATE public.projects
  SET
    name = trim(project_name),
    external_reference_no = NULLIF(trim(project_external_reference_no), ''),
    location_url = normalized_location_url,
    province = NULLIF(trim(project_province), ''),
    district = NULLIF(trim(project_district), ''),
    neighborhood = NULLIF(trim(project_neighborhood), ''),
    block_no = NULLIF(trim(project_block_no), ''),
    parcel_no = NULLIF(trim(project_parcel_no), ''),
    area = project_area,
    manager_id = target_manager_id,
    start_date = project_start_date,
    target_end_date = project_target_end_date,
    show_to_customer = visible_to_customer,
    description = NULLIF(trim(project_description), ''),
    admin_notes = NULLIF(trim(project_admin_notes), '')
  WHERE id = target_project_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_draft_project(target_project_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  current_status public.project_status;
BEGIN
  IF current_user_id IS NULL OR NOT public.has_role(current_user_id, 'admin') THEN
    RAISE EXCEPTION 'Bu işlem için yönetici yetkisi gerekir';
  END IF;

  SELECT status
  INTO current_status
  FROM public.projects
  WHERE id = target_project_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proje bulunamadı';
  END IF;
  IF current_status <> 'draft' THEN
    RAISE EXCEPTION 'Yalnızca taslak projeler silinebilir';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.project_tasks
    WHERE project_id = target_project_id
      AND (
        status <> 'not_started' OR
        responsible_id IS NOT NULL OR
        planned_date IS NOT NULL OR
        completed_at IS NOT NULL OR
        completed_by IS NOT NULL OR
        note IS NOT NULL
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.project_task_activity AS activity
    JOIN public.project_tasks AS task ON task.id = activity.project_task_id
    WHERE task.project_id = target_project_id
  ) THEN
    RAISE EXCEPTION 'Üzerinde çalışma yapılan taslak proje silinemez';
  END IF;

  DELETE FROM public.projects WHERE id = target_project_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_project_task(
  target_task_id UUID,
  new_status public.project_task_status,
  assigned_user_id UUID DEFAULT NULL,
  planned_on DATE DEFAULT NULL,
  task_system TEXT DEFAULT NULL,
  task_note TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  previous_status public.project_task_status;
  parent_project_status public.project_status;
BEGIN
  IF current_user_id IS NULL OR NOT public.has_role(current_user_id, 'admin') THEN
    RAISE EXCEPTION 'Bu işlem için yönetici yetkisi gerekir';
  END IF;

  SELECT task.status, project.status
  INTO previous_status, parent_project_status
  FROM public.project_tasks AS task
  JOIN public.projects AS project ON project.id = task.project_id
  WHERE task.id = target_task_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Görev bulunamadı';
  END IF;
  IF parent_project_status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Tamamlanan veya iptal edilen projenin görevleri değiştirilemez';
  END IF;
  IF assigned_user_id IS NOT NULL
     AND NOT public.has_role(assigned_user_id, 'admin') THEN
    RAISE EXCEPTION 'Görev sorumlusu yönetici rolünde olmalıdır';
  END IF;

  UPDATE public.project_tasks
  SET
    status = new_status,
    responsible_id = assigned_user_id,
    planned_date = planned_on,
    external_system = NULLIF(trim(task_system), ''),
    note = NULLIF(trim(task_note), ''),
    completed_at = CASE
      WHEN new_status = 'completed' THEN COALESCE(completed_at, now())
      ELSE NULL
    END,
    completed_by = CASE
      WHEN new_status = 'completed' THEN COALESCE(completed_by, current_user_id)
      ELSE NULL
    END
  WHERE id = target_task_id;

  IF previous_status IS DISTINCT FROM new_status THEN
    INSERT INTO public.project_task_activity (
      project_task_id,
      actor_user_id,
      old_status,
      new_status,
      note
    ) VALUES (
      target_task_id,
      current_user_id,
      previous_status,
      new_status,
      NULLIF(trim(task_note), '')
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.update_project_lifecycle(UUID, public.project_status, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_project_details(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, UUID, DATE, DATE, BOOLEAN, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_draft_project(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_project_task(
  UUID, public.project_task_status, UUID, DATE, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.update_project_lifecycle(UUID, public.project_status, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_project_details(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, UUID, DATE, DATE, BOOLEAN, TEXT, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_draft_project(UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_project_task(
  UUID, public.project_task_status, UUID, DATE, TEXT, TEXT
) TO authenticated;

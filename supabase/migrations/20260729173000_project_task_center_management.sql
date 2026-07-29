-- Proje görevlerinin görev merkezinden güvenli yönetimi.
-- Kanıt, ilerleme ve geçmiş kayıtları ayrı akışta korunur.

CREATE OR REPLACE FUNCTION public.manage_project_task_from_task_center(
  target_task_id UUID,
  task_title TEXT,
  assigned_user_id UUID DEFAULT NULL,
  planned_on DATE DEFAULT NULL,
  task_note TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  current_status public.project_task_status;
  parent_project_status public.project_status;
BEGIN
  IF current_user_id IS NULL OR NOT public.has_role(current_user_id, 'admin') THEN
    RAISE EXCEPTION 'Proje görevi düzenleme yalnızca yönetici yetkisindedir';
  END IF;

  IF NULLIF(trim(task_title), '') IS NULL OR char_length(trim(task_title)) < 3 THEN
    RAISE EXCEPTION 'Görev başlığı en az 3 karakter olmalıdır';
  END IF;

  SELECT task.status, project.status
    INTO current_status, parent_project_status
  FROM public.project_tasks AS task
  JOIN public.projects AS project ON project.id = task.project_id
  WHERE task.id = target_task_id
  FOR UPDATE OF task;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proje görevi bulunamadı';
  END IF;

  IF parent_project_status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Kapalı projenin görevleri değiştirilemez';
  END IF;

  IF assigned_user_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = assigned_user_id) THEN
    RAISE EXCEPTION 'Atanacak kullanıcı bulunamadı';
  END IF;

  UPDATE public.project_tasks
  SET task_name = trim(task_title),
      responsible_id = assigned_user_id,
      planned_date = planned_on,
      note = NULLIF(trim(task_note), '')
  WHERE id = target_task_id;

  INSERT INTO public.project_task_activity (
    project_task_id, actor_user_id, old_status, new_status, note
  ) VALUES (
    target_task_id, current_user_id, current_status, current_status,
    'Görev Merkezi güncellemesi'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_project_task_from_task_center(target_task_id UUID)
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
    RAISE EXCEPTION 'Proje görevi kaldırma yalnızca yönetici yetkisindedir';
  END IF;

  SELECT task.status, project.status
    INTO previous_status, parent_project_status
  FROM public.project_tasks AS task
  JOIN public.projects AS project ON project.id = task.project_id
  WHERE task.id = target_task_id
  FOR UPDATE OF task;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proje görevi bulunamadı';
  END IF;

  IF parent_project_status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Kapalı projenin görevleri değiştirilemez';
  END IF;

  IF previous_status = 'external_approval' THEN
    RAISE EXCEPTION 'Onay bekleyen görev önce onay veya revizyon akışıyla sonuçlandırılmalıdır';
  END IF;

  UPDATE public.project_tasks
  SET status = 'not_applicable',
      responsible_id = NULL,
      planned_date = NULL
  WHERE id = target_task_id;

  INSERT INTO public.project_task_activity (
    project_task_id, actor_user_id, old_status, new_status, note
  ) VALUES (
    target_task_id, current_user_id, previous_status, 'not_applicable',
    'Görev Merkezi üzerinden aktif listeden kaldırıldı'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.manage_project_task_from_task_center(UUID, TEXT, UUID, DATE, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_project_task_from_task_center(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manage_project_task_from_task_center(UUID, TEXT, UUID, DATE, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_project_task_from_task_center(UUID) TO authenticated;

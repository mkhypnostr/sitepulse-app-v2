-- 1) Proje kalıcı silinince bağımsız görevler silinmesin, yalnızca proje
-- bağlantısı kopsun (operational_tasks.project_id zaten ON DELETE SET NULL
-- ile tanımlı; bu fonksiyon o davranışı bozmadan tutarlı hale getirilir).
CREATE OR REPLACE FUNCTION public.delete_project_permanently(target_project_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
BEGIN
  IF current_user_id IS NULL OR NOT public.has_role(current_user_id, 'admin') THEN
    RAISE EXCEPTION 'Proje silme yalnızca yönetici yetkisindedir';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = target_project_id) THEN
    RAISE EXCEPTION 'Proje bulunamadı';
  END IF;

  PERFORM set_config('app.skip_activity_log', 'on', true);
  DELETE FROM public.activity_logs
  WHERE project_id = target_project_id
     OR work_order_id IN (SELECT id FROM public.work_orders WHERE project_id = target_project_id);
  UPDATE public.operational_tasks SET project_id = NULL WHERE project_id = target_project_id;
  DELETE FROM public.work_orders WHERE project_id = target_project_id;
  DELETE FROM public.project_tasks WHERE project_id = target_project_id;
  DELETE FROM public.projects WHERE id = target_project_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_project_permanently(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_project_permanently(UUID) TO authenticated;

-- 2) Proje görevini Görev Merkezi'nden düzenleme, teknik ofis için de açılır
-- (teknik ofis zaten proje görevi ilerlemesini onaylayabiliyor; tutarlı olur).
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
  IF current_user_id IS NULL OR NOT public.can_manage_projects(current_user_id) THEN
    RAISE EXCEPTION 'Proje görevi düzenleme için operasyon yönetim yetkisi gerekir';
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

REVOKE ALL ON FUNCTION public.manage_project_task_from_task_center(UUID, TEXT, UUID, DATE, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manage_project_task_from_task_center(UUID, TEXT, UUID, DATE, TEXT) TO authenticated;

-- 3) Bağımsız görev düzenlemesinde teknik ofis de artık sorumlu ataması
-- yapabilir (imza değiştiği için eski fonksiyon önce kaldırılır).
DROP FUNCTION IF EXISTS public.update_operational_task_technical(UUID, TEXT, TEXT, UUID, UUID, DATE, public.project_task_status);

CREATE FUNCTION public.update_operational_task_technical(
  target_task_id UUID,
  task_title TEXT,
  task_description TEXT DEFAULT NULL,
  target_project_id UUID DEFAULT NULL,
  target_customer_id UUID DEFAULT NULL,
  assigned_user_id UUID DEFAULT NULL,
  planned_on DATE DEFAULT NULL,
  new_status public.project_task_status DEFAULT 'not_started'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  current_status public.project_task_status;
BEGIN
  IF current_user_id IS NULL OR NOT public.can_manage_projects(current_user_id) THEN
    RAISE EXCEPTION 'Bu işlem için operasyon yönetim yetkisi gerekir';
  END IF;
  IF NULLIF(trim(task_title), '') IS NULL THEN
    RAISE EXCEPTION 'Görev adı zorunludur';
  END IF;

  SELECT status INTO current_status FROM public.operational_tasks WHERE id = target_task_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Görev bulunamadı'; END IF;
  IF current_status = 'external_approval' AND new_status IS DISTINCT FROM current_status THEN
    RAISE EXCEPTION 'Onay bekleyen görev yalnızca onay akışıyla değişir';
  END IF;
  IF new_status IS DISTINCT FROM current_status AND new_status NOT IN ('not_started', 'blocked', 'not_applicable') THEN
    RAISE EXCEPTION 'İlerleme ve tamamlanma yalnızca kanıtlı onay akışıyla değişir';
  END IF;
  IF target_project_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.projects WHERE id = target_project_id) THEN
    RAISE EXCEPTION 'Bağlanacak proje bulunamadı';
  END IF;
  IF target_customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.customers WHERE id = target_customer_id) THEN
    RAISE EXCEPTION 'Bağlanacak müşteri bulunamadı';
  END IF;
  IF assigned_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = assigned_user_id) THEN
    RAISE EXCEPTION 'Atanacak kullanıcı bulunamadı';
  END IF;

  UPDATE public.operational_tasks
  SET title = trim(task_title),
      description = NULLIF(trim(task_description), ''),
      project_id = target_project_id,
      customer_id = target_customer_id,
      assigned_to = assigned_user_id,
      planned_date = planned_on,
      status = new_status,
      updated_at = now()
  WHERE id = target_task_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_operational_task_technical(UUID, TEXT, TEXT, UUID, UUID, UUID, DATE, public.project_task_status) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_operational_task_technical(UUID, TEXT, TEXT, UUID, UUID, UUID, DATE, public.project_task_status) TO authenticated;

-- 4) Saha görevi (iş emri) düzenleme ve yeniden atama teknik ofise de açılır.
-- Bu fonksiyon ticari alanlara dokunmaz (onlar update_work_order_commercials
-- ile ayrı ve hâlâ yalnızca admin yetkisindedir).
CREATE OR REPLACE FUNCTION public.update_work_order_task(
  target_work_order_id UUID,
  task_title TEXT,
  task_description TEXT,
  planned_at TIMESTAMPTZ,
  assigned_user_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
BEGIN
  IF current_user_id IS NULL OR NOT public.can_manage_projects(current_user_id) THEN
    RAISE EXCEPTION 'Saha görevi düzenleme için operasyon yönetim yetkisi gerekir';
  END IF;

  IF NULLIF(trim(task_title), '') IS NULL OR char_length(trim(task_title)) < 3 THEN
    RAISE EXCEPTION 'Görev başlığı en az 3 karakter olmalıdır';
  END IF;

  IF planned_at IS NULL THEN
    RAISE EXCEPTION 'Planlanan tarih zorunludur';
  END IF;

  IF assigned_user_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = assigned_user_id) THEN
    RAISE EXCEPTION 'Seçilen sorumlu kullanıcı bulunamadı';
  END IF;

  UPDATE public.work_orders
  SET title = trim(task_title),
      description = NULLIF(trim(task_description), ''),
      scheduled_at = planned_at,
      updated_at = now()
  WHERE id = target_work_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Saha görevi bulunamadı';
  END IF;

  DELETE FROM public.work_order_assignments
  WHERE work_order_id = target_work_order_id;

  IF assigned_user_id IS NOT NULL THEN
    INSERT INTO public.work_order_assignments (work_order_id, contractor_id)
    VALUES (target_work_order_id, assigned_user_id);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.update_work_order_task(UUID, TEXT, TEXT, TIMESTAMPTZ, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_work_order_task(UUID, TEXT, TEXT, TIMESTAMPTZ, UUID) TO authenticated;

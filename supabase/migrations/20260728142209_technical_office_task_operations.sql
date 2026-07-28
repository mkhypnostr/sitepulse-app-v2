-- Teknik Ofis proje ve görev planlamasını yürütebilir; kişi atama, silme ve
-- finans işlemleri yalnızca yöneticide kalır. Bu fonksiyonlar SECURITY DEFINER
-- olsa da her çağrıda oturum ve rol denetimi yapar; PUBLIC erişimi kaldırılır.

CREATE OR REPLACE FUNCTION public.create_project_task(
  target_project_id UUID,
  target_process_id UUID,
  new_task_name TEXT,
  assigned_user_id UUID DEFAULT NULL,
  planned_on DATE DEFAULT NULL,
  task_note TEXT DEFAULT NULL,
  required_photo BOOLEAN DEFAULT FALSE,
  required_document BOOLEAN DEFAULT FALSE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  next_task_order INTEGER;
  new_task_id UUID;
BEGIN
  IF current_user_id IS NULL OR NOT public.can_manage_projects(current_user_id) THEN
    RAISE EXCEPTION 'Bu işlem için proje yönetim yetkisi gerekir';
  END IF;

  IF NOT public.has_role(current_user_id, 'admin'::public.app_role)
     AND assigned_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'Görev atama yalnızca yönetici yetkisindedir';
  END IF;

  IF NULLIF(trim(new_task_name), '') IS NULL THEN
    RAISE EXCEPTION 'Görev adı zorunludur';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.project_processes
    WHERE id = target_process_id AND project_id = target_project_id
  ) THEN
    RAISE EXCEPTION 'Geçerli bir proje süreci seçin';
  END IF;

  SELECT COALESCE(MAX(task_order), 0) + 1 INTO next_task_order
  FROM public.project_tasks
  WHERE process_id = target_process_id AND phase_order = 999;

  INSERT INTO public.project_tasks (
    project_id, process_id, phase_name, phase_order, task_name, task_order,
    responsible_id, planned_date, note, requires_photo, requires_document
  ) VALUES (
    target_project_id, target_process_id, 'Ek Görevler', 999, trim(new_task_name), next_task_order,
    assigned_user_id, planned_on, NULLIF(trim(task_note), ''), required_photo, required_document
  ) RETURNING id INTO new_task_id;

  INSERT INTO public.project_task_activity (
    project_task_id, actor_user_id, old_status, new_status, note
  ) VALUES (
    new_task_id, current_user_id, NULL, 'not_started'::public.project_task_status,
    'Görev oluşturuldu'
  );

  RETURN new_task_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_project_task_technical(
  target_task_id UUID,
  new_status public.project_task_status,
  planned_on DATE DEFAULT NULL,
  task_system TEXT DEFAULT NULL,
  task_note TEXT DEFAULT NULL,
  actual_on DATE DEFAULT NULL
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
  IF current_user_id IS NULL OR NOT public.can_manage_projects(current_user_id) THEN
    RAISE EXCEPTION 'Bu işlem için proje yönetim yetkisi gerekir';
  END IF;

  SELECT task.status, project.status
    INTO previous_status, parent_project_status
  FROM public.project_tasks AS task
  JOIN public.projects AS project ON project.id = task.project_id
  WHERE task.id = target_task_id
  FOR UPDATE OF task;

  IF NOT FOUND THEN RAISE EXCEPTION 'Görev bulunamadı'; END IF;
  IF parent_project_status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Kapalı projenin görevleri değiştirilemez';
  END IF;
  IF previous_status = 'external_approval' AND new_status IS DISTINCT FROM previous_status THEN
    RAISE EXCEPTION 'Onay bekleyen görev yalnızca onay akışıyla değişir';
  END IF;
  IF new_status IS DISTINCT FROM previous_status
     AND new_status NOT IN ('not_started', 'blocked', 'not_applicable') THEN
    RAISE EXCEPTION 'İlerleme ve tamamlanma yalnızca kanıtlı onay akışıyla değişir';
  END IF;

  UPDATE public.project_tasks
  SET status = new_status,
      planned_date = planned_on,
      actual_date = actual_on,
      external_system = NULLIF(trim(task_system), ''),
      note = NULLIF(trim(task_note), '')
  WHERE id = target_task_id;

  INSERT INTO public.project_task_activity (
    project_task_id, actor_user_id, old_status, new_status, note
  ) VALUES (
    target_task_id, current_user_id, previous_status, new_status,
    NULLIF(trim(task_note), '')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_operational_task(
  task_title TEXT,
  task_description TEXT DEFAULT NULL,
  target_project_id UUID DEFAULT NULL,
  target_customer_id UUID DEFAULT NULL,
  assigned_user_id UUID DEFAULT NULL,
  planned_on DATE DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  new_task_id UUID;
BEGIN
  IF current_user_id IS NULL OR NOT public.can_manage_projects(current_user_id) THEN
    RAISE EXCEPTION 'Bu işlem için operasyon yönetim yetkisi gerekir';
  END IF;
  IF NOT public.has_role(current_user_id, 'admin'::public.app_role)
     AND assigned_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'Görev atama yalnızca yönetici yetkisindedir';
  END IF;
  IF NULLIF(trim(task_title), '') IS NULL THEN
    RAISE EXCEPTION 'Görev adı zorunludur';
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

  INSERT INTO public.operational_tasks (
    title, description, project_id, customer_id, assigned_to, planned_date, created_by
  ) VALUES (
    trim(task_title), NULLIF(trim(task_description), ''), target_project_id,
    target_customer_id, assigned_user_id, planned_on, current_user_id
  ) RETURNING id INTO new_task_id;
  RETURN new_task_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_operational_task_technical(
  target_task_id UUID,
  task_title TEXT,
  task_description TEXT DEFAULT NULL,
  target_project_id UUID DEFAULT NULL,
  target_customer_id UUID DEFAULT NULL,
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
  IF new_status IS DISTINCT FROM current_status
     AND new_status NOT IN ('not_started', 'blocked', 'not_applicable') THEN
    RAISE EXCEPTION 'İlerleme ve tamamlanma yalnızca kanıtlı onay akışıyla değişir';
  END IF;
  IF target_project_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.projects WHERE id = target_project_id) THEN
    RAISE EXCEPTION 'Bağlanacak proje bulunamadı';
  END IF;
  IF target_customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.customers WHERE id = target_customer_id) THEN
    RAISE EXCEPTION 'Bağlanacak müşteri bulunamadı';
  END IF;

  UPDATE public.operational_tasks
  SET title = trim(task_title),
      description = NULLIF(trim(task_description), ''),
      project_id = target_project_id,
      customer_id = target_customer_id,
      planned_date = planned_on,
      status = new_status,
      updated_at = now()
  WHERE id = target_task_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_project_task(UUID, UUID, TEXT, UUID, DATE, TEXT, BOOLEAN, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_project_task_technical(UUID, public.project_task_status, DATE, TEXT, TEXT, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_operational_task(TEXT, TEXT, UUID, UUID, UUID, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_operational_task_technical(UUID, TEXT, TEXT, UUID, UUID, DATE, public.project_task_status) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_project_task(UUID, UUID, TEXT, UUID, DATE, TEXT, BOOLEAN, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_project_task_technical(UUID, public.project_task_status, DATE, TEXT, TEXT, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_operational_task(TEXT, TEXT, UUID, UUID, UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_operational_task_technical(UUID, TEXT, TEXT, UUID, UUID, DATE, public.project_task_status) TO authenticated;

-- Görevler için finansal iş emrinden bağımsız, ortak operasyon kaydı.
-- Proje içi kontrol listeleri project_tasks üzerinde kalır; bağımsız görevler
-- operational_tasks üzerinde tutulur. Arayüz ikisini de yalnızca "Görev" diye sunar.

CREATE TABLE IF NOT EXISTS public.operational_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL CHECK (NULLIF(trim(title), '') IS NOT NULL),
  description TEXT,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  assigned_to UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  status public.project_task_status NOT NULL DEFAULT 'not_started',
  planned_date DATE,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS operational_tasks_project_id_idx ON public.operational_tasks(project_id);
CREATE INDEX IF NOT EXISTS operational_tasks_assigned_to_idx ON public.operational_tasks(assigned_to);
CREATE INDEX IF NOT EXISTS operational_tasks_status_idx ON public.operational_tasks(status);
CREATE INDEX IF NOT EXISTS operational_tasks_planned_date_idx ON public.operational_tasks(planned_date);

ALTER TABLE public.operational_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "operational_tasks_admin_all" ON public.operational_tasks;
CREATE POLICY "operational_tasks_admin_all" ON public.operational_tasks
FOR ALL TO authenticated
USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

DROP POLICY IF EXISTS "operational_tasks_operational_read" ON public.operational_tasks;
CREATE POLICY "operational_tasks_operational_read" ON public.operational_tasks
FOR SELECT TO authenticated
USING (public.can_manage_projects((SELECT auth.uid())));

DROP POLICY IF EXISTS "operational_tasks_assignee_read" ON public.operational_tasks;
CREATE POLICY "operational_tasks_assignee_read" ON public.operational_tasks
FOR SELECT TO authenticated
USING (assigned_to = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.list_task_assignees()
RETURNS TABLE(id UUID, full_name TEXT, role public.app_role)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.can_manage_projects((SELECT auth.uid())) THEN
    RAISE EXCEPTION 'Bu işlem için operasyon yönetim yetkisi gerekir';
  END IF;

  RETURN QUERY
  SELECT profile.id, profile.full_name, user_role.role
  FROM public.profiles AS profile
  JOIN public.user_roles AS user_role ON user_role.user_id = profile.id
  ORDER BY profile.full_name NULLS LAST, user_role.role;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_project_task(
  target_project_id UUID,
  target_process_id UUID,
  new_task_name TEXT,
  assigned_user_id UUID DEFAULT NULL,
  planned_on DATE DEFAULT NULL,
  task_note TEXT DEFAULT NULL,
  required_photo BOOLEAN DEFAULT false,
  required_document BOOLEAN DEFAULT false
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  next_task_order INTEGER;
  selected_process public.project_processes%ROWTYPE;
  new_task_id UUID;
BEGIN
  IF current_user_id IS NULL OR NOT public.can_manage_projects(current_user_id) THEN
    RAISE EXCEPTION 'Bu işlem için proje yönetim yetkisi gerekir';
  END IF;
  IF NULLIF(trim(new_task_name), '') IS NULL THEN
    RAISE EXCEPTION 'Görev adı zorunludur';
  END IF;

  SELECT * INTO selected_process
  FROM public.project_processes
  WHERE id = target_process_id AND project_id = target_project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Geçerli bir proje süreci seçin';
  END IF;

  IF assigned_user_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = assigned_user_id) THEN
    RAISE EXCEPTION 'Atanacak kullanıcı bulunamadı';
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
  IF NULLIF(trim(task_title), '') IS NULL THEN
    RAISE EXCEPTION 'Görev adı zorunludur';
  END IF;
  IF target_project_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.projects WHERE id = target_project_id) THEN
    RAISE EXCEPTION 'Bağlanacak proje bulunamadı';
  END IF;
  IF target_customer_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.customers WHERE id = target_customer_id) THEN
    RAISE EXCEPTION 'Bağlanacak müşteri bulunamadı';
  END IF;
  IF assigned_user_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = assigned_user_id) THEN
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

REVOKE ALL ON FUNCTION public.list_task_assignees() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_project_task(UUID, UUID, TEXT, UUID, DATE, TEXT, BOOLEAN, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_operational_task(TEXT, TEXT, UUID, UUID, UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_task_assignees() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_project_task(UUID, UUID, TEXT, UUID, DATE, TEXT, BOOLEAN, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_operational_task(TEXT, TEXT, UUID, UUID, UUID, DATE) TO authenticated;

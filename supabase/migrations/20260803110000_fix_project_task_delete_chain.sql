-- Proje silinirken bağlı süreç görevlerinden doğan log FK hatasını önler.
-- Bağımsız görevler etkilenmez; yalnızca target_project_id ile bağlı kayıtlar temizlenir.

CREATE OR REPLACE FUNCTION private.capture_activity_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  old_row JSONB := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  new_row JSONB := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  row_data JSONB := COALESCE(new_row, old_row);
  resolved_project_id UUID;
  resolved_work_order_id UUID;
  current_actor_id UUID := (SELECT auth.uid());
BEGIN
  IF current_setting('app.skip_activity_log', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND old_row = new_row THEN RETURN NEW; END IF;

  IF TG_TABLE_NAME = 'projects' THEN
    resolved_project_id := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE (row_data->>'id')::UUID END;
  ELSIF TG_TABLE_NAME = 'project_tasks' THEN
    -- Parent project may be in the middle of a cascade delete. A historical
    -- task deletion log must never recreate a FK dependency on that project.
    resolved_project_id := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE (row_data->>'project_id')::UUID END;
  ELSIF TG_TABLE_NAME = 'work_orders' THEN
    resolved_work_order_id := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE (row_data->>'id')::UUID END;
    resolved_project_id := NULLIF(row_data->>'project_id', '')::UUID;
  ELSIF TG_TABLE_NAME IN ('work_order_assignments', 'work_order_materials') THEN
    resolved_work_order_id := (row_data->>'work_order_id')::UUID;
    SELECT project_id INTO resolved_project_id FROM public.work_orders WHERE id = resolved_work_order_id;
  END IF;

  IF current_actor_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = current_actor_id) THEN
    current_actor_id := NULL;
  END IF;

  INSERT INTO public.activity_logs (project_id, work_order_id, entity_type, entity_id, action, actor_id, old_data, new_data)
  VALUES (resolved_project_id, resolved_work_order_id, TG_TABLE_NAME, (row_data->>'id')::UUID,
    CASE TG_OP WHEN 'INSERT' THEN 'created' WHEN 'UPDATE' THEN 'updated' ELSE 'deleted' END,
    current_actor_id, old_row, new_row);

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

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
  DELETE FROM public.operational_tasks WHERE project_id = target_project_id;
  DELETE FROM public.work_orders WHERE project_id = target_project_id;
  DELETE FROM public.project_tasks WHERE project_id = target_project_id;
  DELETE FROM public.projects WHERE id = target_project_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_project_permanently(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_project_permanently(UUID) TO authenticated;

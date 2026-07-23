-- Bağımsız görevler, bütün profillere atama, güvenli planlama/malzeme akışı
-- ve silinemez operasyon geçmişi.

ALTER TABLE public.work_orders
  ALTER COLUMN customer_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS public.activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  work_order_id UUID REFERENCES public.work_orders(id) ON DELETE SET NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'deleted')),
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  old_data JSONB,
  new_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_logs_project_created_idx
  ON public.activity_logs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_logs_work_order_created_idx
  ON public.activity_logs(work_order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_logs_actor_created_idx
  ON public.activity_logs(actor_id, created_at DESC);

ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.activity_logs TO authenticated;
GRANT ALL ON public.activity_logs TO service_role;

DROP POLICY IF EXISTS "activity_logs_admin_read" ON public.activity_logs;
CREATE POLICY "activity_logs_admin_read"
  ON public.activity_logs
  FOR SELECT
  TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'));

CREATE SCHEMA IF NOT EXISTS private;

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
  IF TG_OP = 'UPDATE' AND old_row = new_row THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'projects' THEN
    resolved_project_id := (row_data->>'id')::UUID;
  ELSIF TG_TABLE_NAME = 'project_tasks' THEN
    resolved_project_id := (row_data->>'project_id')::UUID;
  ELSIF TG_TABLE_NAME = 'work_orders' THEN
    resolved_work_order_id := (row_data->>'id')::UUID;
    resolved_project_id := NULLIF(row_data->>'project_id', '')::UUID;
  ELSIF TG_TABLE_NAME IN ('work_order_assignments', 'work_order_materials') THEN
    resolved_work_order_id := (row_data->>'work_order_id')::UUID;
    SELECT project_id INTO resolved_project_id
    FROM public.work_orders
    WHERE id = resolved_work_order_id;
  END IF;

  IF current_actor_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = current_actor_id) THEN
    current_actor_id := NULL;
  END IF;

  INSERT INTO public.activity_logs (
    project_id,
    work_order_id,
    entity_type,
    entity_id,
    action,
    actor_id,
    old_data,
    new_data
  ) VALUES (
    resolved_project_id,
    resolved_work_order_id,
    TG_TABLE_NAME,
    (row_data->>'id')::UUID,
    CASE TG_OP
      WHEN 'INSERT' THEN 'created'
      WHEN 'UPDATE' THEN 'updated'
      ELSE 'deleted'
    END,
    current_actor_id,
    old_row,
    new_row
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.capture_activity_log() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS projects_activity_log ON public.projects;
CREATE TRIGGER projects_activity_log
AFTER INSERT OR UPDATE OR DELETE ON public.projects
FOR EACH ROW EXECUTE FUNCTION private.capture_activity_log();

DROP TRIGGER IF EXISTS project_tasks_activity_log ON public.project_tasks;
CREATE TRIGGER project_tasks_activity_log
AFTER INSERT OR UPDATE OR DELETE ON public.project_tasks
FOR EACH ROW EXECUTE FUNCTION private.capture_activity_log();

DROP TRIGGER IF EXISTS work_orders_activity_log ON public.work_orders;
CREATE TRIGGER work_orders_activity_log
AFTER INSERT OR UPDATE OR DELETE ON public.work_orders
FOR EACH ROW EXECUTE FUNCTION private.capture_activity_log();

DROP TRIGGER IF EXISTS work_order_assignments_activity_log ON public.work_order_assignments;
CREATE TRIGGER work_order_assignments_activity_log
AFTER INSERT OR UPDATE OR DELETE ON public.work_order_assignments
FOR EACH ROW EXECUTE FUNCTION private.capture_activity_log();

DROP TRIGGER IF EXISTS work_order_materials_activity_log ON public.work_order_materials;
CREATE TRIGGER work_order_materials_activity_log
AFTER INSERT OR UPDATE OR DELETE ON public.work_order_materials
FOR EACH ROW EXECUTE FUNCTION private.capture_activity_log();

CREATE OR REPLACE FUNCTION public.create_work_order(
  target_customer_id UUID,
  order_title TEXT,
  order_description TEXT,
  order_location TEXT,
  order_scheduled_at TIMESTAMPTZ,
  order_customer_amount NUMERIC,
  order_contractor_labor_amount NUMERIC,
  order_estimated_material_cost NUMERIC,
  visible_to_customer BOOLEAN,
  assigned_contractor_id UUID DEFAULT NULL,
  order_location_url TEXT DEFAULT NULL,
  order_work_scope_type TEXT DEFAULT 'labor_only',
  order_default_material_source TEXT DEFAULT 'none',
  target_project_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  new_work_order_id UUID;
  normalized_location_url TEXT := NULLIF(trim(order_location_url), '');
  normalized_location TEXT := NULLIF(trim(order_location), '');
  resolved_customer_id UUID := target_customer_id;
  resolved_show_to_customer BOOLEAN := visible_to_customer;
  selected_project public.projects%ROWTYPE;
BEGIN
  IF current_user_id IS NULL OR NOT public.has_role(current_user_id, 'admin') THEN
    RAISE EXCEPTION 'Bu işlem için yönetici yetkisi gerekir';
  END IF;
  IF NULLIF(trim(order_title), '') IS NULL THEN
    RAISE EXCEPTION 'Görev başlığı zorunludur';
  END IF;
  IF order_customer_amount < 0 OR order_contractor_labor_amount < 0 OR order_estimated_material_cost < 0 THEN
    RAISE EXCEPTION 'Ticari tutarlar negatif olamaz';
  END IF;

  IF target_project_id IS NOT NULL THEN
    SELECT * INTO selected_project
    FROM public.projects
    WHERE id = target_project_id;

    IF selected_project.id IS NULL THEN
      RAISE EXCEPTION 'Seçilen proje bulunamadı';
    END IF;
    IF selected_project.status IN ('completed', 'cancelled') THEN
      RAISE EXCEPTION 'Tamamlanan veya iptal edilen projeye yeni görev atanamaz';
    END IF;

    resolved_customer_id := selected_project.customer_id;
    resolved_show_to_customer := selected_project.show_to_customer AND visible_to_customer;
    normalized_location_url := NULLIF(trim(selected_project.location_url), '');
    normalized_location := NULLIF(
      concat_ws(' / ', selected_project.province, selected_project.district, selected_project.neighborhood),
      ''
    );
  END IF;

  IF resolved_customer_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.customers WHERE id = resolved_customer_id) THEN
    RAISE EXCEPTION 'Seçilen müşteri bulunamadı';
  END IF;
  IF resolved_customer_id IS NULL THEN
    resolved_show_to_customer := false;
  END IF;
  IF normalized_location_url IS NULL OR normalized_location_url !~* '^https://' THEN
    RAISE EXCEPTION 'Görev veya bağlı proje için geçerli bir harita bağlantısı zorunludur';
  END IF;
  IF length(normalized_location_url) > 2048 THEN
    RAISE EXCEPTION 'Harita bağlantısı çok uzun';
  END IF;
  IF order_work_scope_type NOT IN ('labor_only', 'labor_and_material') THEN
    RAISE EXCEPTION 'Geçersiz iş kapsamı';
  END IF;
  IF order_default_material_source NOT IN ('none', 'nes_stock', 'contractor', 'customer_site') THEN
    RAISE EXCEPTION 'Geçersiz malzeme kaynağı';
  END IF;
  IF order_work_scope_type = 'labor_only' THEN
    order_default_material_source := 'none';
  ELSIF order_default_material_source = 'none' THEN
    RAISE EXCEPTION 'Malzemeli işlerde malzeme kaynağı seçilmelidir';
  END IF;

  INSERT INTO public.work_orders (
    project_id, customer_id, title, description, location, location_url, scheduled_at,
    show_to_customer, created_by, work_scope_type, default_material_source
  ) VALUES (
    target_project_id, resolved_customer_id, trim(order_title),
    NULLIF(trim(order_description), ''), normalized_location, normalized_location_url,
    order_scheduled_at, resolved_show_to_customer, current_user_id,
    order_work_scope_type, order_default_material_source
  )
  RETURNING id INTO new_work_order_id;

  INSERT INTO public.work_order_financials (
    work_order_id, total_amount, customer_amount,
    contractor_labor_amount, estimated_material_cost
  ) VALUES (
    new_work_order_id, order_contractor_labor_amount, order_customer_amount,
    order_contractor_labor_amount, order_estimated_material_cost
  );

  IF assigned_contractor_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = assigned_contractor_id) THEN
      RAISE EXCEPTION 'Seçilen sorumlu kullanıcı bulunamadı';
    END IF;
    INSERT INTO public.work_order_assignments (work_order_id, contractor_id)
    VALUES (new_work_order_id, assigned_contractor_id);
  END IF;

  RETURN new_work_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_work_order_schedule(
  target_work_order_id UUID,
  new_scheduled_at TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
BEGIN
  IF current_user_id IS NULL OR NOT public.has_role(current_user_id, 'admin') THEN
    RAISE EXCEPTION 'Planlanan tarihi yalnızca yönetici değiştirebilir';
  END IF;
  IF new_scheduled_at IS NULL THEN
    RAISE EXCEPTION 'Planlanan tarih zorunludur';
  END IF;
  IF EXTRACT(MINUTE FROM new_scheduled_at) NOT IN (0, 30)
     OR EXTRACT(SECOND FROM new_scheduled_at) <> 0 THEN
    RAISE EXCEPTION 'Saat yalnızca 00 veya 30 dakika olabilir';
  END IF;

  UPDATE public.work_orders
  SET scheduled_at = new_scheduled_at,
      updated_at = now()
  WHERE id = target_work_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Görev bulunamadı';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_external_work_order_material(
  target_work_order_id UUID,
  material_name TEXT,
  material_quantity NUMERIC,
  material_unit TEXT,
  source_type TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  new_material_id UUID;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Oturum bulunamadı';
  END IF;
  IF NOT public.has_role(current_user_id, 'admin')
     AND NOT EXISTS (
       SELECT 1 FROM public.work_order_assignments assignment
       WHERE assignment.work_order_id = target_work_order_id
         AND assignment.contractor_id = current_user_id
     ) THEN
    RAISE EXCEPTION 'Bu göreve malzeme ekleme yetkiniz yok';
  END IF;
  IF NULLIF(trim(material_name), '') IS NULL OR material_quantity <= 0 THEN
    RAISE EXCEPTION 'Malzeme adı ve sıfırdan büyük miktar zorunludur';
  END IF;
  IF material_unit NOT IN ('adet', 'metre', 'kg', 'litre') THEN
    RAISE EXCEPTION 'Geçersiz malzeme birimi';
  END IF;
  IF source_type NOT IN ('contractor', 'customer_site') THEN
    RAISE EXCEPTION 'Geçersiz malzeme kaynağı';
  END IF;

  UPDATE public.work_orders
  SET work_scope_type = 'labor_and_material',
      default_material_source = source_type,
      updated_at = now()
  WHERE id = target_work_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Görev bulunamadı';
  END IF;

  INSERT INTO public.work_order_materials (
    work_order_id, custom_material_name, quantity, unit,
    is_nes_stock, material_source, added_by
  ) VALUES (
    target_work_order_id, trim(material_name), material_quantity, material_unit,
    false, source_type, current_user_id
  )
  RETURNING id INTO new_material_id;

  RETURN new_material_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_work_order_schedule(UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_work_order_schedule(UUID, TIMESTAMPTZ)
  TO authenticated;

REVOKE ALL ON FUNCTION public.add_external_work_order_material(UUID, TEXT, NUMERIC, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_external_work_order_material(UUID, TEXT, NUMERIC, TEXT, TEXT)
  TO authenticated;

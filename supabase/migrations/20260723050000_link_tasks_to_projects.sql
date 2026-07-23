-- Projeler ile saha görevlerini tek akışta birleştirir.

ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS project_id UUID
    REFERENCES public.projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS work_orders_project_id_idx
  ON public.work_orders(project_id);

COMMENT ON COLUMN public.work_orders.project_id IS
  'Görevin bağlı olduğu proje; bağımsız görevlerde NULL kalır';

DROP FUNCTION IF EXISTS public.create_work_order(
  UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, NUMERIC, NUMERIC, NUMERIC,
  BOOLEAN, UUID, TEXT, TEXT, TEXT
);

CREATE FUNCTION public.create_work_order(
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
    SELECT *
    INTO selected_project
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

  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = resolved_customer_id) THEN
    RAISE EXCEPTION 'Geçerli bir müşteri seçilmelidir';
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
    IF NOT public.has_role(assigned_contractor_id, 'contractor') THEN
      RAISE EXCEPTION 'Seçilen kullanıcı taşeron rolünde değil';
    END IF;
    INSERT INTO public.work_order_assignments (work_order_id, contractor_id)
    VALUES (new_work_order_id, assigned_contractor_id);
  END IF;

  RETURN new_work_order_id;
END;
$$;

DROP POLICY IF EXISTS "Contractors can view projects linked to assigned tasks"
  ON public.projects;
CREATE POLICY "Contractors can view projects linked to assigned tasks"
  ON public.projects
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.work_orders AS work_order
      JOIN public.work_order_assignments AS assignment
        ON assignment.work_order_id = work_order.id
      WHERE work_order.project_id = projects.id
        AND assignment.contractor_id = (SELECT auth.uid())
    )
  );

REVOKE ALL ON FUNCTION public.create_work_order(
  UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, NUMERIC, NUMERIC, NUMERIC,
  BOOLEAN, UUID, TEXT, TEXT, TEXT, UUID
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_work_order(
  UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, NUMERIC, NUMERIC, NUMERIC,
  BOOLEAN, UUID, TEXT, TEXT, TEXT, UUID
) TO authenticated;

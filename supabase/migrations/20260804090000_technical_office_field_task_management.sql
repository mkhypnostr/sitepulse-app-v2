-- Teknik ofisin saha görevi (iş emri) oluşturabilmesini ve müşteri
-- görünürlüğünü değiştirebilmesini sağlar, ancak ticari/finansal alanlara
-- (satış ve işçilik bedelleri) hiçbir şekilde dokunmaz. Bu alanlar hâlâ
-- yalnızca create_work_order / update_work_order_commercials üzerinden ve
-- yalnızca admin tarafından yönetilir; work_order_financials tablosu RLS
-- ile zaten yalnızca admin'e açık.

CREATE OR REPLACE FUNCTION public.create_work_order_technical(
  target_customer_id UUID,
  order_title TEXT,
  order_description TEXT,
  order_location TEXT,
  order_scheduled_at TIMESTAMPTZ,
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
  IF current_user_id IS NULL OR NOT public.can_manage_projects(current_user_id) THEN
    RAISE EXCEPTION 'Bu işlem için operasyon yönetim yetkisi gerekir';
  END IF;
  IF NULLIF(trim(order_title), '') IS NULL THEN
    RAISE EXCEPTION 'Görev başlığı zorunludur';
  END IF;

  IF target_project_id IS NOT NULL THEN
    SELECT * INTO selected_project FROM public.projects WHERE id = target_project_id;
    IF selected_project.id IS NULL THEN RAISE EXCEPTION 'Seçilen proje bulunamadı'; END IF;
    IF selected_project.status IN ('completed', 'cancelled') THEN
      RAISE EXCEPTION 'Tamamlanan veya iptal edilen projeye yeni görev atanamaz';
    END IF;
    resolved_customer_id := selected_project.customer_id;
    resolved_show_to_customer := selected_project.show_to_customer AND visible_to_customer;
    normalized_location_url := NULLIF(trim(selected_project.location_url), '');
    normalized_location := NULLIF(concat_ws(' / ', selected_project.province, selected_project.district, selected_project.neighborhood), '');
  END IF;

  IF resolved_customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.customers WHERE id = resolved_customer_id) THEN
    RAISE EXCEPTION 'Seçilen müşteri bulunamadı';
  END IF;
  IF resolved_customer_id IS NULL THEN resolved_show_to_customer := false; END IF;
  IF normalized_location_url IS NULL OR normalized_location_url !~* '^https://' THEN
    RAISE EXCEPTION 'Görev veya bağlı proje için geçerli bir harita bağlantısı zorunludur';
  END IF;
  IF length(normalized_location_url) > 2048 THEN RAISE EXCEPTION 'Harita bağlantısı çok uzun'; END IF;
  IF order_work_scope_type NOT IN ('labor_only', 'labor_and_material') THEN RAISE EXCEPTION 'Geçersiz iş kapsamı'; END IF;
  IF order_default_material_source NOT IN ('none', 'nes_stock', 'contractor', 'customer_site') THEN RAISE EXCEPTION 'Geçersiz malzeme kaynağı'; END IF;
  IF order_work_scope_type = 'labor_only' THEN
    order_default_material_source := 'none';
  ELSIF order_default_material_source = 'none' THEN
    RAISE EXCEPTION 'Malzemeli işlerde malzeme kaynağı seçilmelidir';
  END IF;

  INSERT INTO public.work_orders (
    project_id, customer_id, title, description, location, location_url, scheduled_at,
    show_to_customer, created_by, work_scope_type, default_material_source
  ) VALUES (
    target_project_id, resolved_customer_id, trim(order_title), NULLIF(trim(order_description), ''),
    normalized_location, normalized_location_url, order_scheduled_at, resolved_show_to_customer,
    current_user_id, order_work_scope_type, order_default_material_source
  ) RETURNING id INTO new_work_order_id;

  -- Ticari tutarlar 0 varsayılanla oluşturulur; yalnızca admin
  -- update_work_order_commercials ile doldurabilir.
  INSERT INTO public.work_order_financials (work_order_id) VALUES (new_work_order_id);

  IF assigned_contractor_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = assigned_contractor_id) THEN RAISE EXCEPTION 'Seçilen sorumlu kullanıcı bulunamadı'; END IF;
    INSERT INTO public.work_order_assignments (work_order_id, contractor_id)
    VALUES (new_work_order_id, assigned_contractor_id);
  END IF;
  RETURN new_work_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_work_order_technical(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN, UUID, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_work_order_technical(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN, UUID, TEXT, TEXT, TEXT, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_work_order_customer_visibility(
  target_work_order_id UUID,
  visible BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  target_customer_id UUID;
BEGIN
  IF current_user_id IS NULL OR NOT public.can_manage_projects(current_user_id) THEN
    RAISE EXCEPTION 'Bu işlem için operasyon yönetim yetkisi gerekir';
  END IF;

  SELECT customer_id INTO target_customer_id FROM public.work_orders WHERE id = target_work_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Saha görevi bulunamadı';
  END IF;
  IF visible AND target_customer_id IS NULL THEN
    RAISE EXCEPTION 'Müşterisi olmayan görev müşteriye gösterilemez';
  END IF;

  UPDATE public.work_orders
  SET show_to_customer = visible, updated_at = now()
  WHERE id = target_work_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_work_order_customer_visibility(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_work_order_customer_visibility(UUID, BOOLEAN) TO authenticated;

-- Müşteri kartı: teknik ofis fatura bilgisini düzenleyebilir; portal kullanıcı
-- eşleştirmesi ise yalnızca yönetici tarafından yapılır.
-- İş ticari bilgisi: müşteriye satış, işçilik ve malzeme olarak ayrı tutulur.

ALTER TABLE public.work_order_financials
  ADD COLUMN IF NOT EXISTS customer_labor_amount NUMERIC(14,2) NOT NULL DEFAULT 0
    CHECK (customer_labor_amount >= 0),
  ADD COLUMN IF NOT EXISTS customer_material_amount NUMERIC(14,2) NOT NULL DEFAULT 0
    CHECK (customer_material_amount >= 0);

-- Mevcut işlerde tek tutar daha önce toplam satış olarak tutuluyordu. Veri
-- kaybetmemek için o toplamı satış işçiliğine aktarır, satış malzemesini sıfır
-- başlatırız. Yönetici gerekirse karttan sonradan dağıtabilir.
UPDATE public.work_order_financials
SET customer_labor_amount = customer_amount,
    customer_material_amount = 0
WHERE customer_labor_amount = 0
  AND customer_material_amount = 0
  AND customer_amount > 0;

ALTER TABLE public.work_order_financials
  DROP CONSTRAINT IF EXISTS work_order_financials_customer_sale_split_check,
  ADD CONSTRAINT work_order_financials_customer_sale_split_check
    CHECK (customer_amount = customer_labor_amount + customer_material_amount);

CREATE OR REPLACE FUNCTION public.save_customer_details(
  customer_name TEXT,
  customer_contact TEXT,
  customer_billing_title TEXT,
  customer_tax_office TEXT,
  customer_tax_no TEXT,
  customer_billing_address TEXT,
  target_contact_user_id UUID DEFAULT NULL,
  target_customer_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  is_administrator BOOLEAN := public.has_role(current_user_id, 'admin'::public.app_role);
  saved_customer_id UUID;
  existing_contact_user_id UUID;
BEGIN
  IF current_user_id IS NULL
     OR NOT (is_administrator OR public.has_role(current_user_id, 'technical_office'::public.app_role)) THEN
    RAISE EXCEPTION 'Bu işlem için müşteri yönetim yetkisi gerekir';
  END IF;
  IF NULLIF(trim(customer_name), '') IS NULL THEN
    RAISE EXCEPTION 'Müşteri / firma adı zorunludur';
  END IF;
  IF customer_tax_no IS NOT NULL AND NULLIF(trim(customer_tax_no), '') IS NOT NULL
     AND char_length(trim(customer_tax_no)) NOT BETWEEN 4 AND 32 THEN
    RAISE EXCEPTION 'Vergi numarası 4 ile 32 karakter arasında olmalıdır';
  END IF;

  IF target_customer_id IS NOT NULL THEN
    SELECT contact_user_id INTO existing_contact_user_id
    FROM public.customers
    WHERE id = target_customer_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Müşteri bulunamadı';
    END IF;
  END IF;

  IF is_administrator AND target_contact_user_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.user_roles
       WHERE user_id = target_contact_user_id
         AND role = 'customer'::public.app_role
     ) THEN
    RAISE EXCEPTION 'Portal kullanıcısı müşteri rolünde olmalıdır';
  END IF;

  IF target_customer_id IS NULL THEN
    INSERT INTO public.customers (
      name, contact, contact_user_id, billing_title, tax_office, tax_no,
      billing_address, created_by
    ) VALUES (
      trim(customer_name), NULLIF(trim(customer_contact), ''),
      CASE WHEN is_administrator THEN target_contact_user_id ELSE NULL END,
      NULLIF(trim(customer_billing_title), ''), NULLIF(trim(customer_tax_office), ''),
      NULLIF(trim(customer_tax_no), ''), NULLIF(trim(customer_billing_address), ''),
      current_user_id
    ) RETURNING id INTO saved_customer_id;
  ELSE
    UPDATE public.customers
    SET name = trim(customer_name),
        contact = NULLIF(trim(customer_contact), ''),
        contact_user_id = CASE WHEN is_administrator THEN target_contact_user_id ELSE existing_contact_user_id END,
        billing_title = NULLIF(trim(customer_billing_title), ''),
        tax_office = NULLIF(trim(customer_tax_office), ''),
        tax_no = NULLIF(trim(customer_tax_no), ''),
        billing_address = NULLIF(trim(customer_billing_address), '')
    WHERE id = target_customer_id
    RETURNING id INTO saved_customer_id;
  END IF;

  RETURN saved_customer_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_customer_details(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_customer_details(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, UUID)
  TO authenticated;

-- Teknik ofis müşteri kartını yalnızca bu kontrollü fonksiyonla değiştirir;
-- portal kullanıcı eşleştirmesini doğrudan değiştiremez.
DROP POLICY IF EXISTS "technical_office_customers_insert" ON public.customers;
DROP POLICY IF EXISTS "technical_office_customers_update" ON public.customers;

DROP FUNCTION IF EXISTS public.create_work_order(
  UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, NUMERIC, NUMERIC, NUMERIC,
  BOOLEAN, UUID, TEXT, TEXT, TEXT, UUID
);

CREATE FUNCTION public.create_work_order(
  target_customer_id UUID,
  order_title TEXT,
  order_description TEXT,
  order_location TEXT,
  order_scheduled_at TIMESTAMPTZ,
  order_customer_labor_amount NUMERIC,
  order_customer_material_amount NUMERIC,
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
  customer_sale_total NUMERIC := COALESCE(order_customer_labor_amount, 0) + COALESCE(order_customer_material_amount, 0);
BEGIN
  IF current_user_id IS NULL OR NOT public.has_role(current_user_id, 'admin') THEN
    RAISE EXCEPTION 'Bu işlem için yönetici yetkisi gerekir';
  END IF;
  IF NULLIF(trim(order_title), '') IS NULL THEN
    RAISE EXCEPTION 'Görev başlığı zorunludur';
  END IF;
  IF COALESCE(order_customer_labor_amount, 0) < 0
     OR COALESCE(order_customer_material_amount, 0) < 0
     OR COALESCE(order_contractor_labor_amount, 0) < 0
     OR COALESCE(order_estimated_material_cost, 0) < 0 THEN
    RAISE EXCEPTION 'Ticari tutarlar negatif olamaz';
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

  INSERT INTO public.work_order_financials (
    work_order_id, total_amount, customer_amount, customer_labor_amount,
    customer_material_amount, contractor_labor_amount, estimated_material_cost
  ) VALUES (
    new_work_order_id, order_contractor_labor_amount, customer_sale_total,
    order_customer_labor_amount, order_customer_material_amount,
    order_contractor_labor_amount, order_estimated_material_cost
  );

  IF assigned_contractor_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = assigned_contractor_id) THEN RAISE EXCEPTION 'Seçilen sorumlu kullanıcı bulunamadı'; END IF;
    INSERT INTO public.work_order_assignments (work_order_id, contractor_id)
    VALUES (new_work_order_id, assigned_contractor_id);
  END IF;
  RETURN new_work_order_id;
END;
$$;

DROP FUNCTION IF EXISTS public.update_work_order_commercials(UUID, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT);

CREATE FUNCTION public.update_work_order_commercials(
  target_work_order_id UUID,
  new_customer_labor_amount NUMERIC,
  new_customer_material_amount NUMERIC,
  new_contractor_labor_amount NUMERIC,
  new_estimated_material_cost NUMERIC,
  new_work_scope_type TEXT,
  new_default_material_source TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  customer_sale_total NUMERIC := COALESCE(new_customer_labor_amount, 0) + COALESCE(new_customer_material_amount, 0);
BEGIN
  IF current_user_id IS NULL OR NOT public.has_role(current_user_id, 'admin') THEN RAISE EXCEPTION 'Bu işlem için yönetici yetkisi gerekir'; END IF;
  IF COALESCE(new_customer_labor_amount, 0) < 0 OR COALESCE(new_customer_material_amount, 0) < 0
     OR COALESCE(new_contractor_labor_amount, 0) < 0 OR COALESCE(new_estimated_material_cost, 0) < 0 THEN
    RAISE EXCEPTION 'Ticari tutarlar negatif olamaz';
  END IF;
  IF new_work_scope_type NOT IN ('labor_only', 'labor_and_material') THEN RAISE EXCEPTION 'Geçersiz iş kapsamı'; END IF;
  IF new_default_material_source NOT IN ('none', 'nes_stock', 'contractor', 'customer_site') THEN RAISE EXCEPTION 'Geçersiz malzeme kaynağı'; END IF;
  IF new_work_scope_type = 'labor_only' THEN new_default_material_source := 'none';
  ELSIF new_default_material_source = 'none' THEN RAISE EXCEPTION 'Malzemeli işlerde malzeme kaynağı seçilmelidir'; END IF;

  UPDATE public.work_orders
  SET work_scope_type = new_work_scope_type, default_material_source = new_default_material_source, updated_at = now()
  WHERE id = target_work_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Görev bulunamadı'; END IF;

  UPDATE public.work_order_financials
  SET total_amount = new_contractor_labor_amount,
      customer_amount = customer_sale_total,
      customer_labor_amount = new_customer_labor_amount,
      customer_material_amount = new_customer_material_amount,
      contractor_labor_amount = new_contractor_labor_amount,
      estimated_material_cost = new_estimated_material_cost,
      updated_at = now()
  WHERE work_order_id = target_work_order_id;

  IF NOT FOUND THEN
    INSERT INTO public.work_order_financials (
      work_order_id, total_amount, customer_amount, customer_labor_amount,
      customer_material_amount, contractor_labor_amount, estimated_material_cost
    ) VALUES (
      target_work_order_id, new_contractor_labor_amount, customer_sale_total,
      new_customer_labor_amount, new_customer_material_amount,
      new_contractor_labor_amount, new_estimated_material_cost
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.create_work_order(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, NUMERIC, NUMERIC, NUMERIC, NUMERIC, BOOLEAN, UUID, TEXT, TEXT, TEXT, UUID)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_work_order_commercials(UUID, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_work_order(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, NUMERIC, NUMERIC, NUMERIC, NUMERIC, BOOLEAN, UUID, TEXT, TEXT, TEXT, UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_work_order_commercials(UUID, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT)
  TO authenticated;

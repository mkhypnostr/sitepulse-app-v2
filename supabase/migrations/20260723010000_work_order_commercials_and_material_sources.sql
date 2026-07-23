-- Yöneticiye özel ticari tutarlar ve iş emri malzeme kaynağı sınıflandırması.

ALTER TABLE public.work_order_financials
  ADD COLUMN IF NOT EXISTS customer_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (customer_amount >= 0),
  ADD COLUMN IF NOT EXISTS contractor_labor_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (contractor_labor_amount >= 0),
  ADD COLUMN IF NOT EXISTS estimated_material_cost NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (estimated_material_cost >= 0);

-- Eski kayıtlarda mevcut toplam bedeli müşteri satış bedeli olarak koru.
UPDATE public.work_order_financials
SET customer_amount = total_amount
WHERE customer_amount = 0 AND total_amount > 0;

COMMENT ON COLUMN public.work_order_financials.total_amount IS
  'Eski kayıtlarla geriye dönük uyumluluk alanı; yeni hakedişler contractor_labor_amount üzerinden hesaplanır';

ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS work_scope_type TEXT NOT NULL DEFAULT 'labor_only'
    CHECK (work_scope_type IN ('labor_only', 'labor_and_material')),
  ADD COLUMN IF NOT EXISTS default_material_source TEXT NOT NULL DEFAULT 'none'
    CHECK (default_material_source IN ('none', 'nes_stock', 'contractor', 'customer_site'));

ALTER TABLE public.work_order_materials
  ADD COLUMN IF NOT EXISTS material_source TEXT NOT NULL DEFAULT 'contractor'
    CHECK (material_source IN ('nes_stock', 'contractor', 'customer_site'));

UPDATE public.work_order_materials
SET material_source = CASE WHEN is_nes_stock THEN 'nes_stock' ELSE 'contractor' END;

ALTER TABLE public.work_order_materials
  DROP CONSTRAINT IF EXISTS work_order_materials_material_source_match;
ALTER TABLE public.work_order_materials
  ADD CONSTRAINT work_order_materials_material_source_match CHECK (
    (material_source = 'nes_stock' AND is_nes_stock = true AND stock_item_id IS NOT NULL)
    OR
    (material_source IN ('contractor', 'customer_site')
      AND is_nes_stock = false
      AND NULLIF(trim(custom_material_name), '') IS NOT NULL)
  );

DROP FUNCTION IF EXISTS public.create_work_order(
  UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, NUMERIC, BOOLEAN, UUID, TEXT
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
  order_default_material_source TEXT DEFAULT 'none'
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
BEGIN
  IF current_user_id IS NULL OR NOT public.has_role(current_user_id, 'admin') THEN
    RAISE EXCEPTION 'Bu işlem için yönetici yetkisi gerekir';
  END IF;
  IF NULLIF(trim(order_title), '') IS NULL THEN
    RAISE EXCEPTION 'İş emri başlığı zorunludur';
  END IF;
  IF order_customer_amount < 0 OR order_contractor_labor_amount < 0 OR order_estimated_material_cost < 0 THEN
    RAISE EXCEPTION 'Ticari tutarlar negatif olamaz';
  END IF;
  IF normalized_location_url IS NULL OR normalized_location_url !~* '^https://' THEN
    RAISE EXCEPTION 'Geçerli bir güvenli harita bağlantısı zorunludur';
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
    customer_id, title, description, location, location_url, scheduled_at,
    show_to_customer, created_by, work_scope_type, default_material_source
  ) VALUES (
    target_customer_id, trim(order_title), NULLIF(trim(order_description), ''),
    NULLIF(trim(order_location), ''), normalized_location_url, order_scheduled_at,
    visible_to_customer, current_user_id, order_work_scope_type, order_default_material_source
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

CREATE OR REPLACE FUNCTION public.update_work_order_commercials(
  target_work_order_id UUID,
  new_customer_amount NUMERIC,
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
BEGIN
  IF current_user_id IS NULL OR NOT public.has_role(current_user_id, 'admin') THEN
    RAISE EXCEPTION 'Bu işlem için yönetici yetkisi gerekir';
  END IF;
  IF new_customer_amount < 0 OR new_contractor_labor_amount < 0 OR new_estimated_material_cost < 0 THEN
    RAISE EXCEPTION 'Ticari tutarlar negatif olamaz';
  END IF;
  IF new_work_scope_type NOT IN ('labor_only', 'labor_and_material') THEN
    RAISE EXCEPTION 'Geçersiz iş kapsamı';
  END IF;
  IF new_default_material_source NOT IN ('none', 'nes_stock', 'contractor', 'customer_site') THEN
    RAISE EXCEPTION 'Geçersiz malzeme kaynağı';
  END IF;
  IF new_work_scope_type = 'labor_only' THEN
    new_default_material_source := 'none';
  ELSIF new_default_material_source = 'none' THEN
    RAISE EXCEPTION 'Malzemeli işlerde malzeme kaynağı seçilmelidir';
  END IF;

  UPDATE public.work_orders
  SET work_scope_type = new_work_scope_type,
      default_material_source = new_default_material_source,
      updated_at = now()
  WHERE id = target_work_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'İş emri bulunamadı';
  END IF;

  UPDATE public.work_order_financials
  SET total_amount = new_contractor_labor_amount,
      customer_amount = new_customer_amount,
      contractor_labor_amount = new_contractor_labor_amount,
      estimated_material_cost = new_estimated_material_cost,
      updated_at = now()
  WHERE work_order_id = target_work_order_id;

  IF NOT FOUND THEN
    INSERT INTO public.work_order_financials (
      work_order_id, total_amount, customer_amount,
      contractor_labor_amount, estimated_material_cost
    ) VALUES (
      target_work_order_id, new_contractor_labor_amount, new_customer_amount,
      new_contractor_labor_amount, new_estimated_material_cost
    );
  END IF;
END;
$$;

-- NES stok tüketiminde kaynak açıkça NES deposu olarak kaydedilir.
CREATE OR REPLACE FUNCTION public.consume_stock_item(
  target_stock_item_id UUID,
  target_work_order_id UUID,
  consumed_quantity NUMERIC,
  movement_note TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  available_quantity NUMERIC;
  item_unit public.stock_unit;
BEGIN
  IF current_user_id IS NULL THEN RAISE EXCEPTION 'Oturum bulunamadı'; END IF;
  IF consumed_quantity <= 0 THEN RAISE EXCEPTION 'Miktar sıfırdan büyük olmalıdır'; END IF;
  IF NOT public.has_role(current_user_id, 'admin')
     AND NOT EXISTS (
       SELECT 1 FROM public.work_order_assignments a
       WHERE a.work_order_id = target_work_order_id AND a.contractor_id = current_user_id
     ) THEN
    RAISE EXCEPTION 'Bu iş emri size atanmamış';
  END IF;

  SELECT quantity, unit INTO available_quantity, item_unit
  FROM public.stock_items WHERE id = target_stock_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Malzeme bulunamadı'; END IF;
  IF item_unit = 'adet' AND consumed_quantity <> trunc(consumed_quantity) THEN
    RAISE EXCEPTION 'Adet biriminde küsurat kullanılamaz';
  END IF;
  IF available_quantity < consumed_quantity THEN
    RAISE EXCEPTION 'Yetersiz stok. Mevcut: %', available_quantity;
  END IF;

  INSERT INTO public.stock_movements (
    stock_item_id, work_order_id, contractor_id, quantity, note
  ) VALUES (
    target_stock_item_id, target_work_order_id, current_user_id,
    consumed_quantity, NULLIF(trim(movement_note), '')
  );

  INSERT INTO public.work_order_materials (
    work_order_id, stock_item_id, quantity, unit, is_nes_stock,
    material_source, added_by
  ) VALUES (
    target_work_order_id, target_stock_item_id, consumed_quantity,
    item_unit::TEXT, true, 'nes_stock', current_user_id
  );
END;
$$;

-- Onaylanan hakediş tutarı yalnızca yöneticiye özel taşeron işçilik bedeli
-- üzerinden hesaplanır. Eski total_amount verisine dokunulmaz.
CREATE OR REPLACE FUNCTION public.review_progress_update(
  target_progress_update_id UUID,
  approve_update BOOLEAN,
  manager_review_note TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  normalized_review_note TEXT := NULLIF(trim(COALESCE(manager_review_note, '')), '');
  current_update public.progress_updates%ROWTYPE;
  current_progress INT;
  contractor_total NUMERIC;
  approval_amount NUMERIC;
BEGIN
  IF current_user_id IS NULL OR NOT public.has_role(current_user_id, 'admin') THEN
    RAISE EXCEPTION 'Bu işlem için yönetici yetkisi gerekir';
  END IF;
  IF NOT approve_update AND normalized_review_note IS NULL THEN
    RAISE EXCEPTION 'Reddetme açıklaması zorunludur';
  END IF;

  SELECT * INTO current_update
  FROM public.progress_updates
  WHERE id = target_progress_update_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'İlerleme talebi bulunamadı'; END IF;
  IF current_update.status <> 'pending' THEN
    RAISE EXCEPTION 'Bu ilerleme talebi daha önce sonuçlandırılmış';
  END IF;

  SELECT progress_pct INTO current_progress
  FROM public.work_orders
  WHERE id = current_update.work_order_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'İş emri bulunamadı'; END IF;

  IF approve_update THEN
    IF current_update.pct <= current_progress THEN
      RAISE EXCEPTION 'Talep edilen ilerleme mevcut onaylı ilerlemeden yüksek değil';
    END IF;

    UPDATE public.work_orders
    SET progress_pct = current_update.pct,
        status = CASE
          WHEN current_update.pct > 0 THEN 'in_progress'::public.work_status
          ELSE status
        END,
        updated_at = now()
    WHERE id = current_update.work_order_id;

    SELECT contractor_labor_amount INTO contractor_total
    FROM public.work_order_financials
    WHERE work_order_id = current_update.work_order_id
    FOR UPDATE;

    IF FOUND THEN
      approval_amount := round(contractor_total * current_update.pct / 100, 2);
      UPDATE public.work_order_financials
      SET approved_progress_pct = current_update.pct, updated_at = now()
      WHERE work_order_id = current_update.work_order_id;

      INSERT INTO public.progress_approvals (
        work_order_id, approved_pct, approved_amount, approved_by
      ) VALUES (
        current_update.work_order_id, current_update.pct, approval_amount, current_user_id
      );
    END IF;
  END IF;

  UPDATE public.progress_updates
  SET status = CASE WHEN approve_update THEN 'approved' ELSE 'rejected' END,
      reviewed_by = current_user_id,
      reviewed_at = now(),
      review_note = normalized_review_note
  WHERE id = target_progress_update_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_work_order(
  UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, NUMERIC, NUMERIC, NUMERIC,
  BOOLEAN, UUID, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_work_order_commercials(
  UUID, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.review_progress_update(UUID, BOOLEAN, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_work_order(
  UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, NUMERIC, NUMERIC, NUMERIC,
  BOOLEAN, UUID, TEXT, TEXT, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_work_order_commercials(
  UUID, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_progress_update(UUID, BOOLEAN, TEXT)
  TO authenticated;

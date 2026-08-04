-- Stok kataloğu, NES deposu/taşeron/müşteri-şantiye malzeme kaynağı ayrımı ve
-- NES deposu kullanımında otomatik stok düşümü zaten mevcuttu
-- (consume_stock_item + apply_stock_movement trigger'ı, work_order_materials
-- .material_source CHECK kısıtı). Burada düzeltilen tek şey: bu iki fonksiyon
-- yalnızca admin veya o göreve atanmış taşeronu kabul ediyordu; arayüz
-- "Kullanılan Malzemeler" bölümünü teknik ofise de gösterdiği için teknik
-- ofis kullanıcıları "Bu iş emri size atanmamış" hatası alıyordu. İzin
-- kontrolü can_manage_projects (admin veya teknik ofis) ile genişletildi.

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
  IF NOT public.can_manage_projects(current_user_id)
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
  IF NOT public.can_manage_projects(current_user_id)
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

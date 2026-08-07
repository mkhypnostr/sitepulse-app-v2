-- İş Emri Yaşam Döngüsü standardı — RPC ve DB seviyesi doğrulama.
-- Kural: sorumlu taşeron + planlanan başlangıç-bitiş tarih-saati + konum
-- (location_url) olmadan bir iş emri 'draft' dışına çıkamaz. Müşteri
-- (customer_id) her zaman opsiyoneldir.

-- Var olan 2 taslak-olmayan kayıt yeni planned_end_at alanını hiç görmedi;
-- yeni kısıtlama onları geriye dönük bozmasın diye makul bir varsayılanla
-- (başlangıç + 2 saat) dolduruyoruz. Yönetici daha sonra düzeltebilir.
UPDATE public.work_orders
SET planned_end_at = scheduled_at + INTERVAL '2 hours'
WHERE status <> 'draft' AND planned_end_at IS NULL AND scheduled_at IS NOT NULL;

-- CREATE OR REPLACE yalnızca parametre TİPLERİ aynıysa yerine geçer; yeni
-- parametre eklemek (order_planned_end_at, save_as_draft) tip listesini
-- değiştirdiği için eski imzalar overload olarak DB'de kalır ve PostgREST'in
-- "could not choose the best candidate function" hatasına yol açar. Eski
-- imzaları burada açıkça düşürüyoruz.
DROP FUNCTION IF EXISTS public.create_work_order(uuid, text, text, text, timestamptz, numeric, numeric, numeric, numeric, boolean, uuid, text, text, text, uuid);
DROP FUNCTION IF EXISTS public.create_work_order_technical(uuid, text, text, text, timestamptz, boolean, uuid, text, text, text, uuid);
DROP FUNCTION IF EXISTS public.update_work_order_task(uuid, text, text, timestamptz, uuid);

-- ---------------------------------------------------------------------
-- create_work_order (admin)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_work_order(
  target_customer_id uuid,
  order_title text,
  order_description text,
  order_location text,
  order_scheduled_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  order_customer_labor_amount numeric DEFAULT 0,
  order_customer_material_amount numeric DEFAULT 0,
  order_contractor_labor_amount numeric DEFAULT 0,
  order_estimated_material_cost numeric DEFAULT 0,
  visible_to_customer boolean DEFAULT false,
  assigned_contractor_id uuid DEFAULT NULL::uuid,
  order_location_url text DEFAULT NULL::text,
  order_work_scope_type text DEFAULT 'labor_only'::text,
  order_default_material_source text DEFAULT 'none'::text,
  target_project_id uuid DEFAULT NULL::uuid,
  order_planned_end_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  save_as_draft boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  new_work_order_id UUID;
  normalized_location_url TEXT := NULLIF(trim(order_location_url), '');
  normalized_location TEXT := NULLIF(trim(order_location), '');
  resolved_customer_id UUID := target_customer_id;
  resolved_show_to_customer BOOLEAN := visible_to_customer;
  selected_project public.projects%ROWTYPE;
  customer_sale_total NUMERIC := COALESCE(order_customer_labor_amount, 0) + COALESCE(order_customer_material_amount, 0);
  resolved_status public.work_status;
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
    normalized_location_url := COALESCE(normalized_location_url, NULLIF(trim(selected_project.location_url), ''));
    normalized_location := COALESCE(normalized_location, NULLIF(concat_ws(' / ', selected_project.province, selected_project.district, selected_project.neighborhood), ''));
  END IF;

  -- Müşteri her zaman opsiyoneldir.
  IF resolved_customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.customers WHERE id = resolved_customer_id) THEN
    RAISE EXCEPTION 'Seçilen müşteri bulunamadı';
  END IF;
  IF resolved_customer_id IS NULL THEN resolved_show_to_customer := false; END IF;

  IF normalized_location_url IS NOT NULL AND normalized_location_url !~* '^https://' THEN
    RAISE EXCEPTION 'Harita bağlantısı https:// ile başlamalıdır';
  END IF;
  IF normalized_location_url IS NOT NULL AND length(normalized_location_url) > 2048 THEN
    RAISE EXCEPTION 'Harita bağlantısı çok uzun';
  END IF;
  IF order_work_scope_type NOT IN ('labor_only', 'labor_and_material') THEN RAISE EXCEPTION 'Geçersiz iş kapsamı'; END IF;
  IF order_default_material_source NOT IN ('none', 'nes_stock', 'contractor', 'customer_site') THEN RAISE EXCEPTION 'Geçersiz malzeme kaynağı'; END IF;
  IF order_work_scope_type = 'labor_only' THEN
    order_default_material_source := 'none';
  ELSIF order_default_material_source = 'none' THEN
    RAISE EXCEPTION 'Malzemeli işlerde malzeme kaynağı seçilmelidir';
  END IF;

  IF order_scheduled_at IS NOT NULL AND order_planned_end_at IS NOT NULL
     AND order_planned_end_at <= order_scheduled_at THEN
    RAISE EXCEPTION 'Planlanan bitiş, başlangıçtan sonra olmalıdır';
  END IF;

  -- İş Emri Yaşam Döngüsü kuralı: taslak dışında sorumlu taşeron + planlanan
  -- başlangıç-bitiş + konum zorunludur. Müşteri her zaman opsiyoneldir.
  IF save_as_draft THEN
    resolved_status := 'draft';
  ELSE
    IF assigned_contractor_id IS NULL THEN
      RAISE EXCEPTION 'İş emri aktif hale gelmeden önce sorumlu bir taşeron atanmalıdır (taslak olarak kaydedebilirsiniz)';
    END IF;
    IF order_scheduled_at IS NULL OR order_planned_end_at IS NULL THEN
      RAISE EXCEPTION 'İş emri aktif hale gelmeden önce planlanan başlangıç ve bitiş tarih-saati girilmelidir (taslak olarak kaydedebilirsiniz)';
    END IF;
    IF normalized_location_url IS NULL THEN
      RAISE EXCEPTION 'İş emri aktif hale gelmeden önce geçerli bir harita/konum bağlantısı girilmelidir (taslak olarak kaydedebilirsiniz)';
    END IF;
    resolved_status := 'planned';
  END IF;

  INSERT INTO public.work_orders (
    project_id, customer_id, title, description, location, location_url, scheduled_at,
    planned_end_at, status, show_to_customer, created_by, work_scope_type, default_material_source
  ) VALUES (
    target_project_id, resolved_customer_id, trim(order_title), NULLIF(trim(order_description), ''),
    normalized_location, normalized_location_url, order_scheduled_at, order_planned_end_at,
    resolved_status, resolved_show_to_customer,
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

  -- Taslakta atama kalıcı hale gelmez; taşerona bildirim yalnızca iş emri
  -- gerçekten aktifleştiğinde (draft dışına çıktığında) gönderilmelidir.
  IF NOT save_as_draft AND assigned_contractor_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = assigned_contractor_id) THEN RAISE EXCEPTION 'Seçilen sorumlu kullanıcı bulunamadı'; END IF;
    INSERT INTO public.work_order_assignments (work_order_id, contractor_id)
    VALUES (new_work_order_id, assigned_contractor_id);
  END IF;
  RETURN new_work_order_id;
END;
$function$;

-- ---------------------------------------------------------------------
-- create_work_order_technical (admin veya teknik ofis)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_work_order_technical(
  target_customer_id uuid,
  order_title text,
  order_description text,
  order_location text,
  order_scheduled_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  visible_to_customer boolean DEFAULT false,
  assigned_contractor_id uuid DEFAULT NULL::uuid,
  order_location_url text DEFAULT NULL::text,
  order_work_scope_type text DEFAULT 'labor_only'::text,
  order_default_material_source text DEFAULT 'none'::text,
  target_project_id uuid DEFAULT NULL::uuid,
  order_planned_end_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  save_as_draft boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  new_work_order_id UUID;
  normalized_location_url TEXT := NULLIF(trim(order_location_url), '');
  normalized_location TEXT := NULLIF(trim(order_location), '');
  resolved_customer_id UUID := target_customer_id;
  resolved_show_to_customer BOOLEAN := visible_to_customer;
  selected_project public.projects%ROWTYPE;
  resolved_status public.work_status;
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
    normalized_location_url := COALESCE(normalized_location_url, NULLIF(trim(selected_project.location_url), ''));
    normalized_location := COALESCE(normalized_location, NULLIF(concat_ws(' / ', selected_project.province, selected_project.district, selected_project.neighborhood), ''));
  END IF;

  IF resolved_customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.customers WHERE id = resolved_customer_id) THEN
    RAISE EXCEPTION 'Seçilen müşteri bulunamadı';
  END IF;
  IF resolved_customer_id IS NULL THEN resolved_show_to_customer := false; END IF;

  IF normalized_location_url IS NOT NULL AND normalized_location_url !~* '^https://' THEN
    RAISE EXCEPTION 'Harita bağlantısı https:// ile başlamalıdır';
  END IF;
  IF normalized_location_url IS NOT NULL AND length(normalized_location_url) > 2048 THEN
    RAISE EXCEPTION 'Harita bağlantısı çok uzun';
  END IF;
  IF order_work_scope_type NOT IN ('labor_only', 'labor_and_material') THEN RAISE EXCEPTION 'Geçersiz iş kapsamı'; END IF;
  IF order_default_material_source NOT IN ('none', 'nes_stock', 'contractor', 'customer_site') THEN RAISE EXCEPTION 'Geçersiz malzeme kaynağı'; END IF;
  IF order_work_scope_type = 'labor_only' THEN
    order_default_material_source := 'none';
  ELSIF order_default_material_source = 'none' THEN
    RAISE EXCEPTION 'Malzemeli işlerde malzeme kaynağı seçilmelidir';
  END IF;

  IF order_scheduled_at IS NOT NULL AND order_planned_end_at IS NOT NULL
     AND order_planned_end_at <= order_scheduled_at THEN
    RAISE EXCEPTION 'Planlanan bitiş, başlangıçtan sonra olmalıdır';
  END IF;

  IF save_as_draft THEN
    resolved_status := 'draft';
  ELSE
    IF assigned_contractor_id IS NULL THEN
      RAISE EXCEPTION 'İş emri aktif hale gelmeden önce sorumlu bir taşeron atanmalıdır (taslak olarak kaydedebilirsiniz)';
    END IF;
    IF order_scheduled_at IS NULL OR order_planned_end_at IS NULL THEN
      RAISE EXCEPTION 'İş emri aktif hale gelmeden önce planlanan başlangıç ve bitiş tarih-saati girilmelidir (taslak olarak kaydedebilirsiniz)';
    END IF;
    IF normalized_location_url IS NULL THEN
      RAISE EXCEPTION 'İş emri aktif hale gelmeden önce geçerli bir harita/konum bağlantısı girilmelidir (taslak olarak kaydedebilirsiniz)';
    END IF;
    resolved_status := 'planned';
  END IF;

  INSERT INTO public.work_orders (
    project_id, customer_id, title, description, location, location_url, scheduled_at,
    planned_end_at, status, show_to_customer, created_by, work_scope_type, default_material_source
  ) VALUES (
    target_project_id, resolved_customer_id, trim(order_title), NULLIF(trim(order_description), ''),
    normalized_location, normalized_location_url, order_scheduled_at, order_planned_end_at,
    resolved_status, resolved_show_to_customer,
    current_user_id, order_work_scope_type, order_default_material_source
  ) RETURNING id INTO new_work_order_id;

  INSERT INTO public.work_order_financials (work_order_id) VALUES (new_work_order_id);

  IF NOT save_as_draft AND assigned_contractor_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = assigned_contractor_id) THEN RAISE EXCEPTION 'Seçilen sorumlu kullanıcı bulunamadı'; END IF;
    INSERT INTO public.work_order_assignments (work_order_id, contractor_id)
    VALUES (new_work_order_id, assigned_contractor_id);
  END IF;
  RETURN new_work_order_id;
END;
$function$;

-- ---------------------------------------------------------------------
-- update_work_order_task (mevcut iş emrini düzenle / yeniden ata)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_work_order_task(
  target_work_order_id uuid,
  task_title text,
  task_description text,
  planned_at timestamp with time zone,
  assigned_user_id uuid DEFAULT NULL::uuid,
  order_planned_end_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  order_location_url text DEFAULT NULL::text,
  save_as_draft boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  current_row public.work_orders%ROWTYPE;
  normalized_location_url TEXT := NULLIF(trim(order_location_url), '');
  resolved_planned_end_at TIMESTAMPTZ;
  resolved_status public.work_status;
BEGIN
  IF current_user_id IS NULL OR NOT public.can_manage_projects(current_user_id) THEN
    RAISE EXCEPTION 'Saha görevi düzenleme için operasyon yönetim yetkisi gerekir';
  END IF;

  IF NULLIF(trim(task_title), '') IS NULL OR char_length(trim(task_title)) < 3 THEN
    RAISE EXCEPTION 'Görev başlığı en az 3 karakter olmalıdır';
  END IF;

  IF assigned_user_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = assigned_user_id) THEN
    RAISE EXCEPTION 'Seçilen sorumlu kullanıcı bulunamadı';
  END IF;

  SELECT * INTO current_row FROM public.work_orders WHERE id = target_work_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Saha görevi bulunamadı';
  END IF;

  -- location_url ve planned_end_at gönderilmezse mevcut değerleri korunur
  -- (bu RPC bu parametreleri opsiyonel bırakır — yalnızca değiştirmek
  -- isteyen çağıran gönderir). tasks.tsx'teki görev düzenleme ekranı bu
  -- alanları hiç göndermiyor; gönderilmediğinde NULL'a çekmek mevcut
  -- planlanan bitiş tarihini/konumu her düzenlemede sessizce siler.
  IF order_location_url IS NULL THEN
    normalized_location_url := current_row.location_url;
  END IF;
  resolved_planned_end_at := COALESCE(order_planned_end_at, current_row.planned_end_at);
  IF normalized_location_url IS NOT NULL AND normalized_location_url !~* '^https://' THEN
    RAISE EXCEPTION 'Harita bağlantısı https:// ile başlamalıdır';
  END IF;

  IF planned_at IS NOT NULL AND resolved_planned_end_at IS NOT NULL
     AND resolved_planned_end_at <= planned_at THEN
    RAISE EXCEPTION 'Planlanan bitiş, başlangıçtan sonra olmalıdır';
  END IF;

  -- Statü yalnızca hâlâ 'draft' veya 'planned' aşamasındaki (işe henüz
  -- başlanmamış) kayıtlarda bu RPC tarafından belirlenir; iş başladıktan
  -- sonraki (in_progress/review_pending/completed/cancelled) statüler bu
  -- düzenlemeyle değiştirilmez, yalnızca alanlar güncellenir.
  IF current_row.status IN ('draft', 'planned') THEN
    IF save_as_draft THEN
      resolved_status := 'draft';
    ELSE
      IF assigned_user_id IS NULL THEN
        RAISE EXCEPTION 'İş emri aktif hale gelmeden önce sorumlu bir taşeron atanmalıdır (taslak olarak kaydedebilirsiniz)';
      END IF;
      IF planned_at IS NULL OR resolved_planned_end_at IS NULL THEN
        RAISE EXCEPTION 'İş emri aktif hale gelmeden önce planlanan başlangıç ve bitiş tarih-saati girilmelidir (taslak olarak kaydedebilirsiniz)';
      END IF;
      IF normalized_location_url IS NULL THEN
        RAISE EXCEPTION 'İş emri aktif hale gelmeden önce geçerli bir harita/konum bağlantısı girilmelidir (taslak olarak kaydedebilirsiniz)';
      END IF;
      resolved_status := 'planned';
    END IF;
  ELSE
    -- İş zaten başlamış: alanlar boşaltılamaz (sorumlu hariç — reassignment
    -- ayrıca korunuyor), statüye dokunulmaz.
    resolved_status := current_row.status;
    IF planned_at IS NULL OR resolved_planned_end_at IS NULL OR normalized_location_url IS NULL THEN
      RAISE EXCEPTION 'Devam eden bir iş emrinde planlanan tarihler ve konum boş bırakılamaz';
    END IF;
  END IF;

  UPDATE public.work_orders
  SET title = trim(task_title),
      description = NULLIF(trim(task_description), ''),
      scheduled_at = planned_at,
      planned_end_at = resolved_planned_end_at,
      location_url = normalized_location_url,
      status = resolved_status,
      updated_at = now()
  WHERE id = target_work_order_id;

  DELETE FROM public.work_order_assignments
  WHERE work_order_id = target_work_order_id;

  IF resolved_status <> 'draft' AND assigned_user_id IS NOT NULL THEN
    INSERT INTO public.work_order_assignments (work_order_id, contractor_id)
    VALUES (target_work_order_id, assigned_user_id);
  END IF;
END;
$function$;

-- ---------------------------------------------------------------------
-- DB seviyesi emniyet ağı: RLS "wo_admin_all" adminlere work_orders'a
-- doğrudan yazma izni verdiği için, RPC dışından yapılan bir UPDATE de
-- aynı kuralı ihlal edebilir. Bu trigger aynı invaryantı DB seviyesinde
-- tekrar zorunlu kılar.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_enforce_work_order_lifecycle_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status <> 'draft' THEN
    IF NEW.scheduled_at IS NULL OR NEW.planned_end_at IS NULL
       OR NEW.location_url IS NULL OR trim(NEW.location_url) = '' THEN
      RAISE EXCEPTION 'İş emri taslak dışına çıkmak için planlanan başlangıç-bitiş tarih-saati ve konum bağlantısı gerektirir';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_enforce_work_order_lifecycle_fields() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_work_order_lifecycle_fields ON public.work_orders;
CREATE TRIGGER enforce_work_order_lifecycle_fields
BEFORE INSERT OR UPDATE ON public.work_orders
FOR EACH ROW EXECUTE FUNCTION public.trg_enforce_work_order_lifecycle_fields();

-- Sorumlu taşeron kontrolü ayrı bir tabloda (work_order_assignments)
-- olduğu için ve create akışında work_orders satırı, work_order_assignments
-- satırından ÖNCE eklendiği için bu kontrol commit anına ertelenir
-- (DEFERRABLE INITIALLY DEFERRED) — aksi halde her INSERT anında henüz
-- eklenmemiş atamayı görüp yanlışlıkla reddederdi.
CREATE OR REPLACE FUNCTION public.trg_enforce_work_order_lifecycle_contractor()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  final_row public.work_orders%ROWTYPE;
BEGIN
  SELECT * INTO final_row FROM public.work_orders WHERE id = NEW.id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF final_row.status <> 'draft' AND NOT EXISTS (
    SELECT 1 FROM public.work_order_assignments WHERE work_order_id = final_row.id
  ) THEN
    RAISE EXCEPTION 'İş emri taslak dışına çıkmak için sorumlu bir taşeron atanmış olmalıdır';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_enforce_work_order_lifecycle_contractor() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_work_order_lifecycle_contractor ON public.work_orders;
CREATE CONSTRAINT TRIGGER enforce_work_order_lifecycle_contractor
AFTER INSERT OR UPDATE ON public.work_orders
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.trg_enforce_work_order_lifecycle_contractor();

-- scheduled_at zaten yarım saat hizalı olmak zorunda (scheduled_at_half_hour,
-- önceki bir migration'dan); planned_end_at da aynı UI deseniyle
-- (halfHourOptions) doldurulacağı için aynı kısıtlama tutarlılık adına
-- buraya da eklenir.
ALTER TABLE public.work_orders
  ADD CONSTRAINT planned_end_at_half_hour
  CHECK (
    planned_end_at IS NULL OR (
      EXTRACT(minute FROM planned_end_at) = ANY (ARRAY[0::numeric, 30::numeric])
      AND EXTRACT(second FROM planned_end_at) = 0::numeric
    )
  );

-- Bu migration'daki DROP FUNCTION + CREATE OR REPLACE FUNCTION adımları
-- (yukarıda) her üç fonksiyon için de PostgreSQL'in varsayılan ACL'sini
-- (PUBLIC dahil EXECUTE) sıfırlamıştı; bu da anon rolünün admin/teknik-ofis
-- yetkisi gerektiren bu RPC'leri çağırabilmesine (fonksiyon içindeki
-- has_role/can_manage_projects kontrolüyle reddedilse de) yol açıyordu.
-- Bu üç fonksiyon her zaman yalnızca authenticated tarafından çağrılmalıdır
-- (bkz. önceki migration'lardaki aynı REVOKE/GRANT deseni).
REVOKE ALL ON FUNCTION public.create_work_order(
  target_customer_id uuid, order_title text, order_description text, order_location text,
  order_scheduled_at timestamp with time zone, order_customer_labor_amount numeric,
  order_customer_material_amount numeric, order_contractor_labor_amount numeric,
  order_estimated_material_cost numeric, visible_to_customer boolean, assigned_contractor_id uuid,
  order_location_url text, order_work_scope_type text, order_default_material_source text,
  target_project_id uuid, order_planned_end_at timestamp with time zone, save_as_draft boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_work_order(
  target_customer_id uuid, order_title text, order_description text, order_location text,
  order_scheduled_at timestamp with time zone, order_customer_labor_amount numeric,
  order_customer_material_amount numeric, order_contractor_labor_amount numeric,
  order_estimated_material_cost numeric, visible_to_customer boolean, assigned_contractor_id uuid,
  order_location_url text, order_work_scope_type text, order_default_material_source text,
  target_project_id uuid, order_planned_end_at timestamp with time zone, save_as_draft boolean
) TO authenticated;

REVOKE ALL ON FUNCTION public.create_work_order_technical(
  target_customer_id uuid, order_title text, order_description text, order_location text,
  order_scheduled_at timestamp with time zone, visible_to_customer boolean, assigned_contractor_id uuid,
  order_location_url text, order_work_scope_type text, order_default_material_source text,
  target_project_id uuid, order_planned_end_at timestamp with time zone, save_as_draft boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_work_order_technical(
  target_customer_id uuid, order_title text, order_description text, order_location text,
  order_scheduled_at timestamp with time zone, visible_to_customer boolean, assigned_contractor_id uuid,
  order_location_url text, order_work_scope_type text, order_default_material_source text,
  target_project_id uuid, order_planned_end_at timestamp with time zone, save_as_draft boolean
) TO authenticated;

REVOKE ALL ON FUNCTION public.update_work_order_task(
  target_work_order_id uuid, task_title text, task_description text, planned_at timestamp with time zone,
  assigned_user_id uuid, order_planned_end_at timestamp with time zone, order_location_url text,
  save_as_draft boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_work_order_task(
  target_work_order_id uuid, task_title text, task_description text, planned_at timestamp with time zone,
  assigned_user_id uuid, order_planned_end_at timestamp with time zone, order_location_url text,
  save_as_draft boolean
) TO authenticated;

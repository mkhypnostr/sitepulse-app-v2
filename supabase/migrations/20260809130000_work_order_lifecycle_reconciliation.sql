-- Reconciliation migration — PR #58 incelemesindeki 3 bloklayıcı konuyu,
-- canlıdaki gerçek durumu bozmadan düzeltir.
--
-- BAĞLAM: 20260809100000/100500/110000/120000 dosyaları canlıya MCP
-- apply_migration ile uygulandı, ancak supabase_migrations.schema_migrations
-- tablosuna bu dosyalardaki tarih önekleriyle DEĞİL, çağrı anına göre
-- otomatik üretilen farklı versiyon numaralarıyla kaydedildi:
--   20260809100000 -> canlıda 20260807122739 (work_order_lifecycle_schema)
--   20260809100500 -> canlıda 20260807123130 (work_order_lifecycle_rpc_guardrails)
--                      + 20260807123402 (work_order_planned_end_half_hour_constraint — ayrı kayıt)
--   20260809110000 -> canlıda 20260807124652 (brand_assets_public_bucket)
--   20260809120000 -> canlıda 20260807130001 (work_order_lifecycle_email_triggers)
-- Bu dört migration dosyasının içeriği (round-2 düzeltmelerinden ÖNCEKİ,
-- ilk uygulanan hâliyle) canlıdaki gerçek pg_catalog durumuyla tek tek
-- doğrulandı (enum, kolonlar, CHECK constraint'ler, trigger'lar, storage
-- bucket/policy'ler, RPC gövdeleri — hepsi birebir eşleşiyor). Bu yüzden o
-- 4 dosya bu commit'te ORİJİNAL (ilk uygulanan) hâline geri döndürüldü;
-- round-2 düzeltmeleri onların içine gömülmek yerine bu YENİ, ayrı
-- migration'a taşındı. Geçmiş kaydı (schema_migrations), bu migration'dan
-- BAĞIMSIZ olarak `supabase migration repair` ile ayrıca düzeltilecek.
--
-- Bu migration yalnızca CREATE OR REPLACE FUNCTION ve REVOKE/GRANT içerir —
-- hepsi idempotenttir; ALTER TYPE / ADD COLUMN / ADD CONSTRAINT gibi tekrar
-- çalıştırıldığında "already exists" hatası verecek DDL yoktur.

-- ---------------------------------------------------------------------
-- Fix 4: update_work_order_task — order_planned_end_at gönderilmezse
-- mevcut planned_end_at değeri korunur (önceden NULL'a çekiliyordu).
-- tasks.tsx'teki gerçek görev düzenleme ekranı bu parametreyi hiç
-- göndermediği için bu, canlıda HER düzenlemede planlanan bitiş tarihini
-- sessizce siliyordu (rollback'li SQL harness ile doğrulanmış, gerçek bug).
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
  -- isteyen çağıran gönderir).
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
-- Fix 3: anon EXECUTE izni kaldırıldı; yalnızca authenticated çağırabilir.
-- Önceki DROP FUNCTION + CREATE OR REPLACE adımı (ilk uygulamada)
-- PostgreSQL'in varsayılan PUBLIC/anon EXECUTE iznini geri getirmişti.
-- Canlıda has_function_privilege('anon', ..., 'EXECUTE') = true olduğu
-- doğrulandı; bu üç fonksiyon her zaman yalnızca authenticated tarafından
-- çağrılmalıydı (fonksiyon içi has_role/can_manage_projects kontrolleri
-- zaten var, bu ek bir savunma katmanıdır).
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.create_work_order(
  uuid, text, text, text, timestamptz, numeric, numeric, numeric, numeric, boolean, uuid, text, text, text, uuid, timestamptz, boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_work_order(
  uuid, text, text, text, timestamptz, numeric, numeric, numeric, numeric, boolean, uuid, text, text, text, uuid, timestamptz, boolean
) TO authenticated;

REVOKE ALL ON FUNCTION public.create_work_order_technical(
  uuid, text, text, text, timestamptz, boolean, uuid, text, text, text, uuid, timestamptz, boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_work_order_technical(
  uuid, text, text, text, timestamptz, boolean, uuid, text, text, text, uuid, timestamptz, boolean
) TO authenticated;

REVOKE ALL ON FUNCTION public.update_work_order_task(
  uuid, text, text, timestamptz, uuid, timestamptz, text, boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_work_order_task(
  uuid, text, text, timestamptz, uuid, timestamptz, text, boolean
) TO authenticated;

-- ---------------------------------------------------------------------
-- Fix 1: Müşteri nihai kapanış e-postası kaldırıldı. work_orders.show_to_customer
-- bir müşteri PORTAL GÖRÜNÜRLÜK alanıdır, e-posta bildirim izni değildir —
-- ilk sürümde bu ikisi yanlışlıkla karıştırılmıştı. Ayrı, amaca uygun bir
-- müşteri bildirim tercihi alanı eklenmeden bu özellik uygulanmamalı;
-- sonraki bir pakete bırakıldı.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_notify_completion_decision()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  order_row public.work_orders%ROWTYPE;
  contractor_recipient JSONB;
  admins JSONB;
  recipients JSONB := '[]'::jsonb;
  reviewer_email TEXT;
BEGIN
  IF OLD.status IS DISTINCT FROM 'pending' OR NEW.status = 'pending' THEN RETURN NEW; END IF;

  SELECT * INTO order_row FROM public.work_orders WHERE id = NEW.work_order_id;

  contractor_recipient := public.notification_email_for_user(NEW.submitted_by);
  IF contractor_recipient IS NOT NULL AND contractor_recipient->>'email' IS NOT NULL THEN
    recipients := recipients || jsonb_build_array(contractor_recipient);
  END IF;

  IF NEW.status = 'approved' THEN
    -- Onaylandı/kapandı: taşeron + tüm adminler (kararı veren admin dahil).
    admins := public.notification_emails_for_roles(ARRAY['admin']::public.app_role[]);
  ELSE
    -- Revizyon istendi: taşeron + diğer adminler (kararı veren admin hariç).
    reviewer_email := lower(COALESCE(public.notification_email_for_user(NEW.reviewed_by)->>'email', ''));
    SELECT COALESCE(jsonb_agg(entry), '[]'::jsonb) INTO admins
    FROM jsonb_array_elements(public.notification_emails_for_roles(ARRAY['admin']::public.app_role[])) AS entry
    WHERE lower(entry->>'email') IS DISTINCT FROM reviewer_email;
  END IF;
  recipients := recipients || admins;

  IF jsonb_array_length(recipients) > 0 THEN
    PERFORM public.send_notification_email(
      'approval_decision',
      recipients,
      jsonb_build_object(
        'taskName', COALESCE(order_row.title, 'Saha görevi'),
        'decision', CASE WHEN NEW.status = 'approved' THEN 'approved' ELSE 'rejected' END,
        'note', NEW.review_note
      )
    );
  END IF;

  RETURN NEW;
END;
$function$;

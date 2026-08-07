-- İş Emri Yaşam Döngüsü e-posta bildirim standardı:
--   1) iş emri atandı      -> taşeron + tüm adminler (ayrı atama zamanı / planlanan başlangıç / planlanan bitiş)
--   2) taşeron tamamladı   -> tüm adminler
--   3) revizyon istendi    -> taşeron + diğer adminler (kararı veren admin hariç)
--   4) onaylandı/kapandı   -> taşeron + tüm adminler
-- WhatsApp bildirim sistemine (send-whatsapp-notification, trg_notify_whatsapp_*) dokunulmadı.
--
-- NOT: Müşteriye nihai kapanış e-postası bu pakete DAHİL DEĞİLDİR. İlk
-- sürümde work_orders.show_to_customer (müşteri portalında bu işi göster/
-- gösterme alanı) yanlışlıkla bir "e-posta bildirim izni" gibi kullanılmıştı
-- — bu ikisi farklı kavramlar. Ayrı, amaca uygun bir müşteri bildirim
-- tercihi alanı eklenmeden bu özellik uygulanmamalı; sonraki bir pakete
-- bırakıldı.

-- 1) Görev atandı: taşeron + tüm adminler, atama zamanı/planlanan başlangıç/bitiş ayrı alanlar.
CREATE OR REPLACE FUNCTION public.trg_notify_work_order_assigned()
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
BEGIN
  SELECT * INTO order_row FROM public.work_orders WHERE id = NEW.work_order_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  contractor_recipient := public.notification_email_for_user(NEW.contractor_id);
  IF contractor_recipient IS NOT NULL AND contractor_recipient->>'email' IS NOT NULL THEN
    recipients := recipients || jsonb_build_array(contractor_recipient);
  END IF;

  admins := public.notification_emails_for_roles(ARRAY['admin']::public.app_role[]);
  recipients := recipients || admins;

  IF jsonb_array_length(recipients) = 0 THEN RETURN NEW; END IF;

  -- jsonb_build_object, timestamptz değerlerini otomatik olarak ISO 8601'e
  -- çevirir; biçimlendirme (Europe/Istanbul) edge function tarafında yapılır.
  PERFORM public.send_notification_email(
    'task_assigned',
    recipients,
    jsonb_build_object(
      'taskName', COALESCE(order_row.title, 'Saha görevi'),
      'assignedAt', NEW.created_at,
      'plannedStart', order_row.scheduled_at,
      'plannedEnd', order_row.planned_end_at
    )
  );
  RETURN NEW;
END;
$function$;

-- 2) Taşeron tamamladı: tüm adminler (WhatsApp eşdeğeriyle tutarlı olarak yalnızca 'admin' rolü).
CREATE OR REPLACE FUNCTION public.trg_notify_completion_pending()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  admins JSONB;
  order_row public.work_orders%ROWTYPE;
BEGIN
  IF NEW.status <> 'pending' THEN RETURN NEW; END IF;
  admins := public.notification_emails_for_roles(ARRAY['admin']::public.app_role[]);
  IF jsonb_array_length(admins) = 0 THEN RETURN NEW; END IF;

  SELECT * INTO order_row FROM public.work_orders WHERE id = NEW.work_order_id;

  PERFORM public.send_notification_email(
    'approval_pending',
    admins,
    jsonb_build_object('taskName', COALESCE(order_row.title, 'Saha görevi') || ' — iş bitirme onayı')
  );
  RETURN NEW;
END;
$function$;

-- 3+4) Onay kararı: revizyon istendi (taşeron + diğer adminler) veya
-- onaylandı/kapandı (taşeron + tüm adminler). Müşteri e-postası bu pakete
-- dahil değil (yukarıdaki nota bakın).
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

REVOKE ALL ON FUNCTION public.trg_notify_work_order_assigned() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_notify_completion_pending() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_notify_completion_decision() FROM PUBLIC, anon, authenticated;

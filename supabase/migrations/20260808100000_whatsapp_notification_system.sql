-- WhatsApp bildirim sistemi (Twilio): iş emri atama, ilerleme gönderimi,
-- iş bitirme gönderimi ve admin onayı olaylarında send-whatsapp-notification
-- edge function'ını pg_net ile tetikler. E-posta bildirim sistemiyle aynı
-- paylaşılan anahtarı (vault: notification_webhook_secret) kullanır.

-- ---------------------------------------------------------------------
-- Telefon numarası çözümleme yardımcıları (profiles.phone, boşsa atlanır)
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notification_phone_for_user(target_user_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object('phone', trim(p.phone), 'name', NULLIF(trim(p.full_name), ''))
  FROM public.profiles p
  WHERE p.id = target_user_id AND p.phone IS NOT NULL AND trim(p.phone) <> '';
$$;
REVOKE ALL ON FUNCTION public.notification_phone_for_user(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.notification_phones_for_roles(target_roles public.app_role[])
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_agg(row_data), '[]'::jsonb)
  FROM (
    SELECT DISTINCT ON (p.id)
      jsonb_build_object('phone', trim(p.phone), 'name', NULLIF(trim(p.full_name), '')) AS row_data
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.role = ANY(target_roles) AND p.phone IS NOT NULL AND trim(p.phone) <> ''
    ORDER BY p.id
  ) dedup;
$$;
REVOKE ALL ON FUNCTION public.notification_phones_for_roles(public.app_role[]) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- Gönderim: send-whatsapp-notification edge function'ını pg_net ile,
-- Vault'taki paylaşılan anahtarla çağırır. Asenkron (fire-and-forget).
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.send_whatsapp_notification(
  recipients JSONB,
  message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  webhook_secret TEXT;
  function_url TEXT := 'https://nyfocdnlbknxpxbeeapj.supabase.co/functions/v1/send-whatsapp-notification';
BEGIN
  IF recipients IS NULL OR jsonb_array_length(recipients) = 0 THEN
    RETURN;
  END IF;

  SELECT decrypted_secret INTO webhook_secret
  FROM vault.decrypted_secrets
  WHERE name = 'notification_webhook_secret'
  LIMIT 1;

  IF webhook_secret IS NULL THEN
    RAISE WARNING 'notification_webhook_secret bulunamadı; WhatsApp mesajı gönderilemedi.';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', webhook_secret
    ),
    body := jsonb_build_object(
      'recipients', recipients,
      'message', message
    ),
    timeout_milliseconds := 8000
  );
END;
$$;
REVOKE ALL ON FUNCTION public.send_whatsapp_notification(JSONB, TEXT) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1) Taşerona iş emri atanınca
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_notify_whatsapp_work_order_assigned()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  order_row public.work_orders%ROWTYPE;
  recipient JSONB;
BEGIN
  SELECT * INTO order_row FROM public.work_orders WHERE id = NEW.work_order_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  recipient := public.notification_phone_for_user(NEW.contractor_id);
  IF recipient IS NULL OR recipient->>'phone' IS NULL THEN RETURN NEW; END IF;

  PERFORM public.send_whatsapp_notification(
    jsonb_build_array(recipient),
    format(
      '🔔 Yeni iş emri atandı: %s. Lütfen uygulamayı açıp onaylayın.',
      COALESCE(order_row.title, 'Saha görevi')
    )
  );
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_notify_whatsapp_work_order_assigned() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS notify_whatsapp_work_order_assigned ON public.work_order_assignments;
CREATE TRIGGER notify_whatsapp_work_order_assigned
AFTER INSERT ON public.work_order_assignments
FOR EACH ROW EXECUTE FUNCTION public.trg_notify_whatsapp_work_order_assigned();

-- ---------------------------------------------------------------------
-- 2) Taşeron ilerleme yüzdesi gönderince (submit_progress_update)
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_notify_whatsapp_progress_submitted()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  admins JSONB;
  order_row public.work_orders%ROWTYPE;
  contractor_name TEXT;
BEGIN
  IF NEW.status <> 'pending' THEN RETURN NEW; END IF;
  admins := public.notification_phones_for_roles(ARRAY['admin']::public.app_role[]);
  IF jsonb_array_length(admins) = 0 THEN RETURN NEW; END IF;

  SELECT * INTO order_row FROM public.work_orders WHERE id = NEW.work_order_id;
  SELECT full_name INTO contractor_name FROM public.profiles WHERE id = NEW.contractor_id;

  PERFORM public.send_whatsapp_notification(
    admins,
    format(
      '✅ %s iş emrini onayladı: %s',
      COALESCE(NULLIF(trim(contractor_name), ''), 'Taşeron'),
      COALESCE(order_row.title, 'Saha görevi')
    )
  );
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_notify_whatsapp_progress_submitted() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS notify_whatsapp_progress_submitted ON public.progress_updates;
CREATE TRIGGER notify_whatsapp_progress_submitted
AFTER INSERT ON public.progress_updates
FOR EACH ROW EXECUTE FUNCTION public.trg_notify_whatsapp_progress_submitted();

-- ---------------------------------------------------------------------
-- 3) Taşeron işi tamamlayıp gönderince (submit_work_for_review)
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_notify_whatsapp_completion_pending()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  admins JSONB;
  order_row public.work_orders%ROWTYPE;
  contractor_name TEXT;
BEGIN
  IF NEW.status <> 'pending' THEN RETURN NEW; END IF;
  admins := public.notification_phones_for_roles(ARRAY['admin']::public.app_role[]);
  IF jsonb_array_length(admins) = 0 THEN RETURN NEW; END IF;

  SELECT * INTO order_row FROM public.work_orders WHERE id = NEW.work_order_id;
  SELECT full_name INTO contractor_name FROM public.profiles WHERE id = NEW.submitted_by;

  PERFORM public.send_whatsapp_notification(
    admins,
    format(
      '📋 %s iş emrini tamamladı, inceleme bekliyor: %s',
      COALESCE(NULLIF(trim(contractor_name), ''), 'Taşeron'),
      COALESCE(order_row.title, 'Saha görevi')
    )
  );
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_notify_whatsapp_completion_pending() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS notify_whatsapp_completion_pending ON public.work_completion_submissions;
CREATE TRIGGER notify_whatsapp_completion_pending
AFTER INSERT ON public.work_completion_submissions
FOR EACH ROW EXECUTE FUNCTION public.trg_notify_whatsapp_completion_pending();

-- ---------------------------------------------------------------------
-- 4) Admin onaylayınca (iş emri tamamlandı ve kapatıldı) — ikisine de
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_notify_whatsapp_completion_approved()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  order_row public.work_orders%ROWTYPE;
  contractor_recipient JSONB;
  admins JSONB;
  recipients JSONB := '[]'::jsonb;
BEGIN
  IF OLD.status IS DISTINCT FROM 'pending' OR NEW.status <> 'approved' THEN RETURN NEW; END IF;

  SELECT * INTO order_row FROM public.work_orders WHERE id = NEW.work_order_id;

  contractor_recipient := public.notification_phone_for_user(NEW.submitted_by);
  IF contractor_recipient IS NOT NULL AND contractor_recipient->>'phone' IS NOT NULL THEN
    recipients := recipients || jsonb_build_array(contractor_recipient);
  END IF;

  admins := public.notification_phones_for_roles(ARRAY['admin']::public.app_role[]);
  recipients := recipients || admins;

  IF jsonb_array_length(recipients) = 0 THEN RETURN NEW; END IF;

  PERFORM public.send_whatsapp_notification(
    recipients,
    format('🎉 İş emri tamamlandı ve kapatıldı: %s', COALESCE(order_row.title, 'Saha görevi'))
  );
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_notify_whatsapp_completion_approved() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS notify_whatsapp_completion_approved ON public.work_completion_submissions;
CREATE TRIGGER notify_whatsapp_completion_approved
AFTER UPDATE ON public.work_completion_submissions
FOR EACH ROW EXECUTE FUNCTION public.trg_notify_whatsapp_completion_approved();

-- Teknik servis taleplerinin Meta WhatsApp Cloud API üzerinden iki onaylı
-- utility şablonuyla bildirilmesi:
--   nes_teknik_servis_yeni
--   nes_teknik_servis_guncelleme
-- Edge Function yalnızca Vault'taki paylaşılan webhook anahtarıyla çağrılır.

CREATE OR REPLACE FUNCTION public.send_meta_whatsapp_template(
  recipients JSONB,
  event_name TEXT,
  parameters JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  webhook_secret TEXT;
  function_url TEXT :=
    'https://nyfocdnlbknxpxbeeapj.supabase.co/functions/v1/send-meta-whatsapp-notification';
BEGIN
  IF recipients IS NULL
     OR jsonb_typeof(recipients) <> 'array'
     OR jsonb_array_length(recipients) = 0 THEN
    RETURN;
  END IF;

  IF event_name NOT IN (
    'technical_service_created',
    'technical_service_updated'
  ) THEN
    RAISE EXCEPTION 'Desteklenmeyen Meta WhatsApp bildirim olayı';
  END IF;

  IF parameters IS NULL OR jsonb_typeof(parameters) <> 'array' THEN
    RAISE EXCEPTION 'Meta WhatsApp şablon parametreleri dizi olmalıdır';
  END IF;

  SELECT decrypted_secret
  INTO webhook_secret
  FROM vault.decrypted_secrets
  WHERE name = 'notification_webhook_secret'
  LIMIT 1;

  IF webhook_secret IS NULL THEN
    RAISE WARNING
      'notification_webhook_secret bulunamadı; Meta WhatsApp mesajı gönderilemedi.';
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
      'event', event_name,
      'parameters', parameters
    ),
    timeout_milliseconds := 8000
  );
END;
$$;

REVOKE ALL
ON FUNCTION public.send_meta_whatsapp_template(JSONB, TEXT, JSONB)
FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_notify_meta_technical_service_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  recipients JSONB;
  customer_name TEXT;
  urgency_label TEXT;
BEGIN
  recipients := public.notification_phones_for_roles(
    ARRAY['admin', 'technical_office']::public.app_role[]
  );

  IF jsonb_array_length(recipients) = 0 THEN
    RETURN NEW;
  END IF;

  SELECT name
  INTO customer_name
  FROM public.customers
  WHERE id = NEW.customer_id;

  urgency_label := CASE NEW.urgency
    WHEN 'critical' THEN 'Kritik'
    WHEN 'high' THEN 'Yüksek'
    ELSE 'Normal'
  END;

  PERFORM public.send_meta_whatsapp_template(
    recipients,
    'technical_service_created',
    jsonb_build_array(
      lpad(NEW.request_no::TEXT, 6, '0'),
      COALESCE(NULLIF(trim(customer_name), ''), 'Müşteri'),
      NEW.title,
      urgency_label,
      COALESCE(NULLIF(trim(NEW.location), ''), 'Belirtilmedi')
    )
  );

  RETURN NEW;
END;
$$;

REVOKE ALL
ON FUNCTION public.trg_notify_meta_technical_service_created()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS notify_meta_technical_service_created
ON public.technical_service_requests;
CREATE TRIGGER notify_meta_technical_service_created
AFTER INSERT ON public.technical_service_requests
FOR EACH ROW
EXECUTE FUNCTION public.trg_notify_meta_technical_service_created();

CREATE OR REPLACE FUNCTION public.trg_notify_meta_technical_service_updated()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  recipient JSONB;
  status_label TEXT;
  note_text TEXT;
BEGIN
  IF NULLIF(trim(NEW.contact_phone), '') IS NULL THEN
    RETURN NEW;
  END IF;

  recipient := jsonb_build_object(
    'phone', trim(NEW.contact_phone),
    'name', NULLIF(trim(NEW.contact_name), '')
  );

  status_label := CASE NEW.status
    WHEN 'new' THEN 'Yeni'
    WHEN 'reviewing' THEN 'İnceleniyor'
    WHEN 'planned' THEN 'Planlandı'
    WHEN 'on_site' THEN 'Sahada'
    WHEN 'resolved' THEN 'Çözüldü'
    WHEN 'closed' THEN 'Kapatıldı'
    WHEN 'cancelled' THEN 'İptal edildi'
    ELSE NEW.status
  END;

  note_text := COALESCE(
    NULLIF(trim(NEW.admin_note), ''),
    'Henüz yönetici notu eklenmedi'
  );

  PERFORM public.send_meta_whatsapp_template(
    jsonb_build_array(recipient),
    'technical_service_updated',
    jsonb_build_array(
      lpad(NEW.request_no::TEXT, 6, '0'),
      NEW.title,
      status_label,
      note_text
    )
  );

  RETURN NEW;
END;
$$;

REVOKE ALL
ON FUNCTION public.trg_notify_meta_technical_service_updated()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS notify_meta_technical_service_updated
ON public.technical_service_requests;
CREATE TRIGGER notify_meta_technical_service_updated
AFTER UPDATE OF status, admin_note ON public.technical_service_requests
FOR EACH ROW
WHEN (
  OLD.status IS DISTINCT FROM NEW.status
  OR OLD.admin_note IS DISTINCT FROM NEW.admin_note
)
EXECUTE FUNCTION public.trg_notify_meta_technical_service_updated();

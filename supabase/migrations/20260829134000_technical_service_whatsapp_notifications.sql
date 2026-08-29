-- Teknik servis talebi açıldığında operasyon ekibini, durum veya yönetici
-- notu değiştiğinde müşteriyi mevcut WhatsApp gönderim altyapısıyla bilgilendirir.

CREATE OR REPLACE FUNCTION public.trg_notify_whatsapp_technical_service_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  recipients jsonb;
  customer_name text;
  urgency_label text;
  notification_icon text;
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
  notification_icon := CASE
    WHEN NEW.urgency = 'critical' THEN '🚨'
    ELSE '🔧'
  END;

  PERFORM public.send_whatsapp_notification(
    recipients,
    format(
      E'%s Yeni teknik servis talebi\nTalep: TS-%s\nFirma: %s\nKonu: %s\nAciliyet: %s\nKonum: %s\n\nUygulama: https://app.nesgrup.com/service-requests',
      notification_icon,
      lpad(NEW.request_no::text, 6, '0'),
      COALESCE(NULLIF(trim(customer_name), ''), 'Müşteri'),
      NEW.title,
      urgency_label,
      NEW.location
    )
  );

  RETURN NEW;
END;
$$;

REVOKE ALL
ON FUNCTION public.trg_notify_whatsapp_technical_service_created()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS notify_whatsapp_technical_service_created
ON public.technical_service_requests;
CREATE TRIGGER notify_whatsapp_technical_service_created
AFTER INSERT ON public.technical_service_requests
FOR EACH ROW
EXECUTE FUNCTION public.trg_notify_whatsapp_technical_service_created();

CREATE OR REPLACE FUNCTION public.trg_notify_whatsapp_technical_service_updated()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  recipient jsonb;
  status_label text;
  note_line text := '';
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

  IF NULLIF(trim(NEW.admin_note), '') IS NOT NULL THEN
    note_line := E'\nNES notu: ' || trim(NEW.admin_note);
  END IF;

  PERFORM public.send_whatsapp_notification(
    jsonb_build_array(recipient),
    format(
      E'📣 Teknik servis talebiniz güncellendi\nTalep: TS-%s\nKonu: %s\nDurum: %s%s\n\nTakip: https://app.nesgrup.com/service-requests',
      lpad(NEW.request_no::text, 6, '0'),
      NEW.title,
      status_label,
      note_line
    )
  );

  RETURN NEW;
END;
$$;

REVOKE ALL
ON FUNCTION public.trg_notify_whatsapp_technical_service_updated()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS notify_whatsapp_technical_service_updated
ON public.technical_service_requests;
CREATE TRIGGER notify_whatsapp_technical_service_updated
AFTER UPDATE OF status, admin_note ON public.technical_service_requests
FOR EACH ROW
WHEN (
  OLD.status IS DISTINCT FROM NEW.status
  OR OLD.admin_note IS DISTINCT FROM NEW.admin_note
)
EXECUTE FUNCTION public.trg_notify_whatsapp_technical_service_updated();

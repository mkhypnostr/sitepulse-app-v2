-- Görev atama WhatsApp bildirimi artık yalnızca atanan taşerona değil,
-- aynı anda tüm admin rolündeki kullanıcılara da gidiyor. Diğer 3 olay
-- (ilerleme gönderimi, iş bitirme, admin onayı) zaten admin'e gidiyordu,
-- değişmedi.

CREATE OR REPLACE FUNCTION public.trg_notify_whatsapp_work_order_assigned()
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
  SELECT * INTO order_row FROM public.work_orders WHERE id = NEW.work_order_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  contractor_recipient := public.notification_phone_for_user(NEW.contractor_id);
  IF contractor_recipient IS NOT NULL AND contractor_recipient->>'phone' IS NOT NULL THEN
    recipients := recipients || jsonb_build_array(contractor_recipient);
  END IF;

  admins := public.notification_phones_for_roles(ARRAY['admin']::public.app_role[]);
  recipients := recipients || admins;

  IF jsonb_array_length(recipients) = 0 THEN RETURN NEW; END IF;

  PERFORM public.send_whatsapp_notification(
    recipients,
    format(
      '🔔 Yeni iş emri atandı: %s. Lütfen uygulamayı açıp onaylayın.',
      COALESCE(order_row.title, 'Saha görevi')
    )
  );
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_notify_whatsapp_work_order_assigned() FROM PUBLIC, anon, authenticated;

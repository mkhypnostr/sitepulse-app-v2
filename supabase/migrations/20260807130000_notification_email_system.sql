-- E-posta bildirim sistemi: görev ataması, geciken görev, onay bekleyen kayıt
-- ve onay kararı olaylarında send-notification-email edge function'ını
-- pg_net ile tetikler. Fonksiyon çağrısı için gereken paylaşılan anahtar
-- Supabase Vault'ta saklanır (migration dosyasına asla açık yazılmaz).

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- send-notification-email fonksiyonunu yalnızca bu paylaşılan anahtarla
-- çağrılabilir hale getirir; anahtar rastgele üretilir ve yalnızca burada,
-- veritabanı içinde saklanır. Fonksiyonun NOTIFICATION_WEBHOOK_SECRET ortam
-- değişkenine aynı değer Supabase Dashboard > Edge Functions > Secrets
-- üzerinden elle girilmelidir (bkz. proje README / deploy notu).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'notification_webhook_secret') THEN
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'notification_webhook_secret',
      'send-notification-email edge function çağrıları için paylaşılan anahtar'
    );
  END IF;
END
$$;

-- Geciken görev taramasının aynı kaydı tekrar tekrar bildirmemesi için
-- her görev/iş emri türünde bir "son bildirildi" zaman damgası tutulur.
ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS overdue_notified_at TIMESTAMPTZ;
ALTER TABLE public.project_tasks
  ADD COLUMN IF NOT EXISTS overdue_notified_at TIMESTAMPTZ;
ALTER TABLE public.operational_tasks
  ADD COLUMN IF NOT EXISTS overdue_notified_at TIMESTAMPTZ;

-- Tarih yeniden planlanınca gecikme bildirimi bayrağı sıfırlanır; görev
-- yeniden gecikirse bildirim tekrar gönderilebilsin diye.
CREATE OR REPLACE FUNCTION public.trg_reset_overdue_notice()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.overdue_notified_at := NULL;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_reset_overdue_notice() FROM PUBLIC;

DROP TRIGGER IF EXISTS reset_work_order_overdue_notice ON public.work_orders;
CREATE TRIGGER reset_work_order_overdue_notice
BEFORE UPDATE OF scheduled_at ON public.work_orders
FOR EACH ROW WHEN (NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at)
EXECUTE FUNCTION public.trg_reset_overdue_notice();

DROP TRIGGER IF EXISTS reset_project_task_overdue_notice ON public.project_tasks;
CREATE TRIGGER reset_project_task_overdue_notice
BEFORE UPDATE OF planned_date ON public.project_tasks
FOR EACH ROW WHEN (NEW.planned_date IS DISTINCT FROM OLD.planned_date)
EXECUTE FUNCTION public.trg_reset_overdue_notice();

DROP TRIGGER IF EXISTS reset_operational_task_overdue_notice ON public.operational_tasks;
CREATE TRIGGER reset_operational_task_overdue_notice
BEFORE UPDATE OF planned_date ON public.operational_tasks
FOR EACH ROW WHEN (NEW.planned_date IS DISTINCT FROM OLD.planned_date)
EXECUTE FUNCTION public.trg_reset_overdue_notice();

-- ---------------------------------------------------------------------
-- Alıcı çözümleme yardımcıları (e-posta auth.users'ta, profiles'ta değil)
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notification_email_for_user(target_user_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object('email', u.email, 'name', NULLIF(trim(p.full_name), ''))
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.id = target_user_id AND u.email IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.notification_email_for_user(UUID) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.notification_emails_for_roles(target_roles public.app_role[])
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_agg(row_data), '[]'::jsonb)
  FROM (
    SELECT DISTINCT ON (u.id)
      jsonb_build_object('email', u.email, 'name', NULLIF(trim(p.full_name), '')) AS row_data
    FROM public.user_roles ur
    JOIN auth.users u ON u.id = ur.user_id
    LEFT JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.role = ANY(target_roles) AND u.email IS NOT NULL
    ORDER BY u.id
  ) dedup;
$$;
REVOKE ALL ON FUNCTION public.notification_emails_for_roles(public.app_role[]) FROM PUBLIC;

-- ---------------------------------------------------------------------
-- Gönderim: send-notification-email edge function'ını pg_net ile,
-- Vault'taki paylaşılan anahtarla çağırır. Asenkron (fire-and-forget);
-- e-posta gönderim hatası hiçbir zaman çağıran işlemi başarısız yapmaz.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.send_notification_email(
  event_type TEXT,
  recipients JSONB,
  notification_data JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  webhook_secret TEXT;
  function_url TEXT := 'https://nyfocdnlbknxpxbeeapj.supabase.co/functions/v1/send-notification-email';
BEGIN
  IF recipients IS NULL OR jsonb_array_length(recipients) = 0 THEN
    RETURN;
  END IF;

  SELECT decrypted_secret INTO webhook_secret
  FROM vault.decrypted_secrets
  WHERE name = 'notification_webhook_secret'
  LIMIT 1;

  IF webhook_secret IS NULL THEN
    RAISE WARNING 'notification_webhook_secret bulunamadı; bildirim e-postası gönderilemedi (event: %)', event_type;
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', webhook_secret
    ),
    body := jsonb_build_object(
      'event_type', event_type,
      'recipients', recipients,
      'data', notification_data
    ),
    timeout_milliseconds := 8000
  );
END;
$$;
REVOKE ALL ON FUNCTION public.send_notification_email(TEXT, JSONB, JSONB) FROM PUBLIC;

-- ---------------------------------------------------------------------
-- a) Taşerona görev atanınca
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_notify_work_order_assigned()
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

  recipient := public.notification_email_for_user(NEW.contractor_id);
  IF recipient IS NULL OR recipient->>'email' IS NULL THEN RETURN NEW; END IF;

  PERFORM public.send_notification_email(
    'task_assigned',
    jsonb_build_array(recipient),
    jsonb_build_object(
      'taskName', COALESCE(order_row.title, 'Saha görevi'),
      'date', to_char(order_row.scheduled_at, 'DD.MM.YYYY HH24:MI')
    )
  );
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_notify_work_order_assigned() FROM PUBLIC;

DROP TRIGGER IF EXISTS notify_work_order_assigned ON public.work_order_assignments;
CREATE TRIGGER notify_work_order_assigned
AFTER INSERT ON public.work_order_assignments
FOR EACH ROW EXECUTE FUNCTION public.trg_notify_work_order_assigned();

CREATE OR REPLACE FUNCTION public.trg_notify_project_task_assigned()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  recipient JSONB;
BEGIN
  IF NEW.responsible_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.responsible_id IS NOT DISTINCT FROM OLD.responsible_id THEN
    RETURN NEW;
  END IF;

  recipient := public.notification_email_for_user(NEW.responsible_id);
  IF recipient IS NULL OR recipient->>'email' IS NULL THEN RETURN NEW; END IF;

  PERFORM public.send_notification_email(
    'task_assigned',
    jsonb_build_array(recipient),
    jsonb_build_object(
      'taskName', COALESCE(NEW.task_name, 'Proje görevi'),
      'date', to_char(NEW.planned_date, 'DD.MM.YYYY')
    )
  );
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_notify_project_task_assigned() FROM PUBLIC;

DROP TRIGGER IF EXISTS notify_project_task_assigned ON public.project_tasks;
CREATE TRIGGER notify_project_task_assigned
AFTER INSERT OR UPDATE OF responsible_id ON public.project_tasks
FOR EACH ROW EXECUTE FUNCTION public.trg_notify_project_task_assigned();

CREATE OR REPLACE FUNCTION public.trg_notify_operational_task_assigned()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  recipient JSONB;
BEGIN
  IF NEW.assigned_to IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to THEN
    RETURN NEW;
  END IF;

  recipient := public.notification_email_for_user(NEW.assigned_to);
  IF recipient IS NULL OR recipient->>'email' IS NULL THEN RETURN NEW; END IF;

  PERFORM public.send_notification_email(
    'task_assigned',
    jsonb_build_array(recipient),
    jsonb_build_object(
      'taskName', COALESCE(NEW.title, 'Görev'),
      'date', to_char(NEW.planned_date, 'DD.MM.YYYY')
    )
  );
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_notify_operational_task_assigned() FROM PUBLIC;

DROP TRIGGER IF EXISTS notify_operational_task_assigned ON public.operational_tasks;
CREATE TRIGGER notify_operational_task_assigned
AFTER INSERT OR UPDATE OF assigned_to ON public.operational_tasks
FOR EACH ROW EXECUTE FUNCTION public.trg_notify_operational_task_assigned();

-- ---------------------------------------------------------------------
-- b) Görev planlanan tarihi geçince (pg_cron ile periyodik tarama)
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_overdue_tasks()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  admins JSONB;
  rec RECORD;
BEGIN
  admins := public.notification_emails_for_roles(ARRAY['admin', 'technical_office']::public.app_role[]);
  IF jsonb_array_length(admins) = 0 THEN RETURN; END IF;

  FOR rec IN
    SELECT wo.id, wo.title, wo.work_order_no, p.full_name AS contractor_name
    FROM public.work_orders wo
    LEFT JOIN public.work_order_assignments woa ON woa.work_order_id = wo.id
    LEFT JOIN public.profiles p ON p.id = woa.contractor_id
    WHERE wo.scheduled_at < now()
      AND wo.status NOT IN ('completed', 'cancelled')
      AND wo.overdue_notified_at IS NULL
  LOOP
    PERFORM public.send_notification_email(
      'task_overdue',
      admins,
      jsonb_build_object(
        'taskName', COALESCE(rec.title, 'Saha görevi') || CASE WHEN rec.work_order_no IS NOT NULL THEN ' (#' || rec.work_order_no || ')' ELSE '' END,
        'contractorName', COALESCE(rec.contractor_name, 'Atanmamış')
      )
    );
    UPDATE public.work_orders SET overdue_notified_at = now() WHERE id = rec.id;
  END LOOP;

  FOR rec IN
    SELECT pt.id, pt.task_name, p.full_name AS contractor_name
    FROM public.project_tasks pt
    LEFT JOIN public.profiles p ON p.id = pt.responsible_id
    WHERE pt.planned_date < CURRENT_DATE
      AND pt.status NOT IN ('completed', 'cancelled', 'not_applicable')
      AND pt.overdue_notified_at IS NULL
      AND (
        pt.responsible_id IS NOT NULL
        OR pt.approved_progress_pct > 0
        OR pt.status IN ('in_progress', 'external_approval', 'revision_required', 'blocked')
      )
  LOOP
    PERFORM public.send_notification_email(
      'task_overdue',
      admins,
      jsonb_build_object(
        'taskName', COALESCE(rec.task_name, 'Proje görevi'),
        'contractorName', COALESCE(rec.contractor_name, 'Atanmamış')
      )
    );
    UPDATE public.project_tasks SET overdue_notified_at = now() WHERE id = rec.id;
  END LOOP;

  FOR rec IN
    SELECT ot.id, ot.title, p.full_name AS contractor_name
    FROM public.operational_tasks ot
    LEFT JOIN public.profiles p ON p.id = ot.assigned_to
    WHERE ot.planned_date < CURRENT_DATE
      AND ot.status NOT IN ('completed', 'cancelled', 'not_applicable')
      AND ot.overdue_notified_at IS NULL
  LOOP
    PERFORM public.send_notification_email(
      'task_overdue',
      admins,
      jsonb_build_object(
        'taskName', COALESCE(rec.title, 'Görev'),
        'contractorName', COALESCE(rec.contractor_name, 'Atanmamış')
      )
    );
    UPDATE public.operational_tasks SET overdue_notified_at = now() WHERE id = rec.id;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_overdue_tasks() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notify-overdue-tasks') THEN
    PERFORM cron.unschedule('notify-overdue-tasks');
  END IF;
END
$$;
SELECT cron.schedule('notify-overdue-tasks', '*/15 * * * *', $$SELECT public.notify_overdue_tasks();$$);

-- ---------------------------------------------------------------------
-- c) İş bitirme / ilerleme onayı bekleyince
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_notify_completion_pending()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  admins JSONB;
  order_row public.work_orders%ROWTYPE;
BEGIN
  IF NEW.status <> 'pending' THEN RETURN NEW; END IF;
  admins := public.notification_emails_for_roles(ARRAY['admin', 'technical_office']::public.app_role[]);
  IF jsonb_array_length(admins) = 0 THEN RETURN NEW; END IF;

  SELECT * INTO order_row FROM public.work_orders WHERE id = NEW.work_order_id;

  PERFORM public.send_notification_email(
    'approval_pending',
    admins,
    jsonb_build_object('taskName', COALESCE(order_row.title, 'Saha görevi') || ' — iş bitirme onayı')
  );
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_notify_completion_pending() FROM PUBLIC;

DROP TRIGGER IF EXISTS notify_completion_pending ON public.work_completion_submissions;
CREATE TRIGGER notify_completion_pending
AFTER INSERT ON public.work_completion_submissions
FOR EACH ROW EXECUTE FUNCTION public.trg_notify_completion_pending();

CREATE OR REPLACE FUNCTION public.trg_notify_progress_pending()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  admins JSONB;
  order_row public.work_orders%ROWTYPE;
BEGIN
  IF NEW.status <> 'pending' THEN RETURN NEW; END IF;
  -- Saha ilerleme onayını yalnızca yönetici verebilir (review_progress_update).
  admins := public.notification_emails_for_roles(ARRAY['admin']::public.app_role[]);
  IF jsonb_array_length(admins) = 0 THEN RETURN NEW; END IF;

  SELECT * INTO order_row FROM public.work_orders WHERE id = NEW.work_order_id;

  PERFORM public.send_notification_email(
    'approval_pending',
    admins,
    jsonb_build_object('taskName', COALESCE(order_row.title, 'Saha görevi') || format(' — %s%% ilerleme onayı', NEW.pct))
  );
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_notify_progress_pending() FROM PUBLIC;

DROP TRIGGER IF EXISTS notify_progress_pending ON public.progress_updates;
CREATE TRIGGER notify_progress_pending
AFTER INSERT ON public.progress_updates
FOR EACH ROW EXECUTE FUNCTION public.trg_notify_progress_pending();

CREATE OR REPLACE FUNCTION public.trg_notify_project_task_progress_pending()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  admins JSONB;
  task_row public.project_tasks%ROWTYPE;
BEGIN
  IF NEW.status <> 'pending' THEN RETURN NEW; END IF;
  admins := public.notification_emails_for_roles(ARRAY['admin', 'technical_office']::public.app_role[]);
  IF jsonb_array_length(admins) = 0 THEN RETURN NEW; END IF;

  SELECT * INTO task_row FROM public.project_tasks WHERE id = NEW.project_task_id;

  PERFORM public.send_notification_email(
    'approval_pending',
    admins,
    jsonb_build_object('taskName', COALESCE(task_row.task_name, 'Proje görevi') || ' — ilerleme onayı')
  );
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_notify_project_task_progress_pending() FROM PUBLIC;

DROP TRIGGER IF EXISTS notify_project_task_progress_pending ON public.project_task_progress_submissions;
CREATE TRIGGER notify_project_task_progress_pending
AFTER INSERT ON public.project_task_progress_submissions
FOR EACH ROW EXECUTE FUNCTION public.trg_notify_project_task_progress_pending();

-- ---------------------------------------------------------------------
-- d) Onay verilince/reddedilince (ilgili taşerona bildirim)
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_notify_completion_decision()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  recipient JSONB;
  order_row public.work_orders%ROWTYPE;
BEGIN
  IF OLD.status IS DISTINCT FROM 'pending' OR NEW.status = 'pending' THEN RETURN NEW; END IF;

  recipient := public.notification_email_for_user(NEW.submitted_by);
  IF recipient IS NULL OR recipient->>'email' IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO order_row FROM public.work_orders WHERE id = NEW.work_order_id;

  PERFORM public.send_notification_email(
    'approval_decision',
    jsonb_build_array(recipient),
    jsonb_build_object(
      'taskName', COALESCE(order_row.title, 'Saha görevi'),
      'decision', CASE WHEN NEW.status = 'approved' THEN 'approved' ELSE 'rejected' END,
      'note', NEW.review_note
    )
  );
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_notify_completion_decision() FROM PUBLIC;

DROP TRIGGER IF EXISTS notify_completion_decision ON public.work_completion_submissions;
CREATE TRIGGER notify_completion_decision
AFTER UPDATE ON public.work_completion_submissions
FOR EACH ROW EXECUTE FUNCTION public.trg_notify_completion_decision();

CREATE OR REPLACE FUNCTION public.trg_notify_progress_decision()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  recipient JSONB;
  order_row public.work_orders%ROWTYPE;
BEGIN
  IF OLD.status IS DISTINCT FROM 'pending' OR NEW.status = 'pending' THEN RETURN NEW; END IF;

  recipient := public.notification_email_for_user(NEW.contractor_id);
  IF recipient IS NULL OR recipient->>'email' IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO order_row FROM public.work_orders WHERE id = NEW.work_order_id;

  PERFORM public.send_notification_email(
    'approval_decision',
    jsonb_build_array(recipient),
    jsonb_build_object(
      'taskName', COALESCE(order_row.title, 'Saha görevi') || format(' — %s%% ilerleme', NEW.pct),
      'decision', CASE WHEN NEW.status = 'approved' THEN 'approved' ELSE 'rejected' END,
      'note', NEW.review_note
    )
  );
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_notify_progress_decision() FROM PUBLIC;

DROP TRIGGER IF EXISTS notify_progress_decision ON public.progress_updates;
CREATE TRIGGER notify_progress_decision
AFTER UPDATE ON public.progress_updates
FOR EACH ROW EXECUTE FUNCTION public.trg_notify_progress_decision();

CREATE OR REPLACE FUNCTION public.trg_notify_project_task_progress_decision()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  recipient JSONB;
  task_row public.project_tasks%ROWTYPE;
BEGIN
  IF OLD.status IS DISTINCT FROM 'pending' OR NEW.status = 'pending' THEN RETURN NEW; END IF;

  recipient := public.notification_email_for_user(NEW.submitted_by);
  IF recipient IS NULL OR recipient->>'email' IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO task_row FROM public.project_tasks WHERE id = NEW.project_task_id;

  PERFORM public.send_notification_email(
    'approval_decision',
    jsonb_build_array(recipient),
    jsonb_build_object(
      'taskName', COALESCE(task_row.task_name, 'Proje görevi'),
      'decision', CASE WHEN NEW.status = 'approved' THEN 'approved' ELSE 'rejected' END,
      'note', NEW.review_note
    )
  );
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_notify_project_task_progress_decision() FROM PUBLIC;

DROP TRIGGER IF EXISTS notify_project_task_progress_decision ON public.project_task_progress_submissions;
CREATE TRIGGER notify_project_task_progress_decision
AFTER UPDATE ON public.project_task_progress_submissions
FOR EACH ROW EXECUTE FUNCTION public.trg_notify_project_task_progress_decision();

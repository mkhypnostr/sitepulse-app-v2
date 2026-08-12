-- İş emri (work_orders) kaynaklı e-posta bildirimlerini görev (project_tasks/
-- operational_tasks) bildirimlerinden ayırmak için ayrı event_type'lar
-- kullanılır: work_order_assigned / work_order_overdue. Metin ayrımı
-- send-notification-email edge function'ında event_type'a göre yapılır; bu
-- migration yalnızca doğru event_type'ı ve atama bağlamını (alıcının iş
-- emrinin gerçek sorumlusu mu yoksa sorumlu olmayan bir admin mi olduğunu
-- ayırt etmek için gereken assigneeEmail/assigneeName) gönderir.
-- project_tasks/operational_tasks tetikleyicilerine dokunulmadı; onlar hâlâ
-- 'task_assigned'/'task_overdue' kullanır ve metinde "görev" geçmeye devam
-- eder.

-- 1) İş emri atandı: taşeron + tüm adminler. Alıcı bağlamına göre doğru
-- metnin üretilebilmesi için atanan kişinin e-postası/adı ve iş emrinin
-- lokasyonu da payload'a eklenir (mevcut work_orders.location kolonu).
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
    'work_order_assigned',
    recipients,
    jsonb_build_object(
      'taskName', COALESCE(order_row.title, 'Saha iş emri'),
      'assignedAt', NEW.created_at,
      'plannedStart', order_row.scheduled_at,
      'plannedEnd', order_row.planned_end_at,
      'location', order_row.location,
      'assigneeEmail', contractor_recipient->>'email',
      'assigneeName', contractor_recipient->>'name'
    )
  );
  RETURN NEW;
END;
$function$;

-- 2) Geciken tarama: work_orders döngüsü artık work_order_overdue kullanır;
-- project_tasks ve operational_tasks döngüleri değişmedi (task_overdue).
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
      'work_order_overdue',
      admins,
      jsonb_build_object(
        'taskName', COALESCE(rec.title, 'Saha iş emri') || CASE WHEN rec.work_order_no IS NOT NULL THEN ' (#' || rec.work_order_no || ')' ELSE '' END,
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

REVOKE ALL ON FUNCTION public.trg_notify_work_order_assigned() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_overdue_tasks() FROM PUBLIC;

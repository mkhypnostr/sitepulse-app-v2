-- Gecikme bildirimleri 2026-08-07'den beri hiç gönderilmedi.
--
-- notify_overdue_tasks() (pg_cron, 15 dakikada bir) project_tasks ve
-- operational_tasks durumunu 'cancelled' ile karşılaştırıyordu. Bu iki
-- tablonun durumu project_task_status türünde ve bu türde 'cancelled' yok
-- (not_started, in_progress, external_approval, revision_required, blocked,
-- completed, not_applicable). Postgres her çalışmada "invalid input value for
-- enum" hatası verip işlemi geri aldı; iş emri gecikmeleri de dahil hiçbir
-- uyarı gitmedi (cron.job_run_details: 6.864 başarısız çalışma).
--
-- Düzeltme: görev tablolarında yalnız geçerli bitmiş durumlar (completed,
-- not_applicable) hariç tutulur. İş emirleri work_status türündedir ve
-- 'cancelled' orada geçerlidir; o kısım aynen kalır. Fonksiyonun geri kalanı
-- değişmez. Tekrar çalıştırılabilir (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION public.notify_overdue_tasks()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      AND pt.status NOT IN ('completed', 'not_applicable')
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
      AND ot.status NOT IN ('completed', 'not_applicable')
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
$function$;

REVOKE ALL ON FUNCTION public.notify_overdue_tasks() FROM PUBLIC, anon, authenticated;

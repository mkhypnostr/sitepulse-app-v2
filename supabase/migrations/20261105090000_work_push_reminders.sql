-- Telefon bildirimleri: gün içi açık iş hatırlatması ve iş tamamlandı bildirimi.
--
-- 1) notify_open_work_reminders(slot): her kişiye kendi açık işlerini özetler.
--    Yönetici/teknik ofis: tüm açık iş emirleri ve takipteki görevler.
--    Taşeron ve görev sorumlusu: yalnız kendisine atanmış açık işler.
--    Açık işi olmayana bildirim gitmez. Cron: Pzt–Cmt 08:30, 13:00, 17:00
--    (İstanbul saati).
-- 2) İş emri / proje görevi / bağımsız görev "completed" olunca yönetici ve
--    teknik ofise (işlemi yapan hariç) "✅ İş tamamlandı" bildirimi.
--    Bildirim hatası kaydı hiçbir zaman engellemez.
-- Yalnız telefon bildirimi (push); e-posta gönderilmez. Tekrar
-- çalıştırılabilir; veri silmez.

CREATE OR REPLACE FUNCTION public.notify_open_work_reminders(slot text DEFAULT 'midday')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  today date := (now() AT TIME ZONE 'Europe/Istanbul')::date;
  rec record;
  notified integer := 0;
  title_text text;
  body_text text;
BEGIN
  FOR rec IN
    WITH managers AS (
      SELECT DISTINCT user_id FROM public.user_roles
      WHERE role IN ('admin'::public.app_role, 'technical_office'::public.app_role)
    ),
    items AS (
      -- İş emirleri: yöneticilere hepsi
      SELECT m.user_id, 'wo-' || wo.id AS item_id,
             '#' || COALESCE(wo.work_order_no::text, '—') || ' ' || wo.title AS label,
             COALESCE(wo.planned_end_at, wo.scheduled_at) < now()
               AND wo.status <> 'review_pending' AS overdue,
             wo.status = 'review_pending' AS waiting
      FROM public.work_orders wo
      CROSS JOIN managers m
      WHERE wo.status NOT IN ('completed', 'cancelled', 'draft')
      UNION
      -- İş emirleri: atanmış taşerona kendi işleri (onaydakiler hariç)
      SELECT woa.contractor_id, 'wo-' || wo.id,
             '#' || COALESCE(wo.work_order_no::text, '—') || ' ' || wo.title,
             COALESCE(wo.planned_end_at, wo.scheduled_at) < now(),
             false
      FROM public.work_orders wo
      JOIN public.work_order_assignments woa ON woa.work_order_id = wo.id
      WHERE wo.status NOT IN ('completed', 'cancelled', 'draft', 'review_pending')
      UNION
      -- Proje görevleri (takipte olanlar): sorumlusuna ve yöneticilere
      SELECT x.user_id, 'pt-' || pt.id, pt.task_name,
             pt.planned_date IS NOT NULL AND pt.planned_date < today,
             pt.status = 'external_approval'
      FROM public.project_tasks pt
      JOIN public.projects p ON p.id = pt.project_id
      CROSS JOIN LATERAL (
        SELECT pt.responsible_id AS user_id WHERE pt.responsible_id IS NOT NULL
        UNION SELECT user_id FROM managers
      ) x
      WHERE pt.status NOT IN ('completed', 'not_applicable')
        AND p.status NOT IN ('completed', 'cancelled')
        AND (
          pt.responsible_id IS NOT NULL
          OR pt.approved_progress_pct > 0
          OR pt.status IN ('in_progress', 'external_approval', 'revision_required', 'blocked')
        )
      UNION
      -- Bağımsız görevler: atanana ve yöneticilere
      SELECT x.user_id, 'ot-' || ot.id, ot.title,
             ot.planned_date IS NOT NULL AND ot.planned_date < today,
             false
      FROM public.operational_tasks ot
      CROSS JOIN LATERAL (
        SELECT ot.assigned_to AS user_id WHERE ot.assigned_to IS NOT NULL
        UNION SELECT user_id FROM managers
      ) x
      WHERE ot.status NOT IN ('completed', 'not_applicable')
    ),
    per_item AS (
      SELECT DISTINCT ON (user_id, item_id) user_id, item_id, label, overdue, waiting
      FROM items
      ORDER BY user_id, item_id, overdue DESC
    )
    SELECT user_id,
           count(*)::integer AS open_count,
           count(*) FILTER (WHERE overdue)::integer AS overdue_count,
           count(*) FILTER (WHERE waiting)::integer AS waiting_count,
           (array_agg(
              CASE WHEN overdue THEN '🔴 ' WHEN waiting THEN '🕒 ' ELSE '🟡 ' END
              || left(label, 60)
              ORDER BY overdue DESC, waiting DESC, label
           ))[1:3] AS top_labels
    FROM per_item
    WHERE user_id IS NOT NULL
    GROUP BY user_id
  LOOP
    title_text := CASE slot
      WHEN 'morning' THEN '☀️ Günaydın · ' || rec.open_count || ' açık iş'
      WHEN 'evening' THEN '🌇 Gün sonu · ' || rec.open_count || ' açık iş'
      ELSE '⏳ Açık işler: ' || rec.open_count
    END;
    body_text := concat_ws(' · ',
        CASE WHEN rec.overdue_count > 0 THEN '🔴 ' || rec.overdue_count || ' gecikmiş' END,
        CASE WHEN rec.waiting_count > 0 THEN '🕒 ' || rec.waiting_count || ' onay bekliyor' END,
        CASE WHEN rec.open_count - rec.overdue_count - rec.waiting_count > 0
             THEN '🟡 ' || (rec.open_count - rec.overdue_count - rec.waiting_count) || ' devam ediyor' END)
      || E'\n' || array_to_string(rec.top_labels, E'\n')
      || CASE WHEN rec.open_count > 3 THEN E'\n+' || (rec.open_count - 3) || ' iş daha' ELSE '' END;
    BEGIN
      PERFORM public.send_push_notification(
        'open_work_reminder',
        ARRAY[rec.user_id],
        jsonb_build_object('title', title_text, 'body', body_text, 'url', '/tasks', 'slot', slot)
      );
      notified := notified + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Hatırlatma gönderilemedi (%): %', rec.user_id, SQLERRM;
    END;
  END LOOP;
  RETURN notified;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_open_work_reminders(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.notify_work_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  actor uuid := (SELECT auth.uid());
  recipients uuid[];
  label text;
  target_url text;
BEGIN
  BEGIN
    IF TG_TABLE_NAME = 'work_orders' THEN
      label := '#' || COALESCE(NEW.work_order_no::text, '—') || ' · ' || NEW.title;
      target_url := '/jobs/' || NEW.id;
    ELSIF TG_TABLE_NAME = 'project_tasks' THEN
      SELECT NEW.task_name || ' · ' || p.name INTO label
      FROM public.projects p WHERE p.id = NEW.project_id;
      target_url := '/projects/' || NEW.project_id;
    ELSE
      label := NEW.title;
      target_url := '/tasks';
    END IF;

    SELECT array_agg(DISTINCT user_id) INTO recipients
    FROM public.user_roles
    WHERE role IN ('admin'::public.app_role, 'technical_office'::public.app_role)
      AND user_id IS DISTINCT FROM actor;

    IF recipients IS NOT NULL THEN
      PERFORM public.send_push_notification(
        'work_completed',
        recipients,
        jsonb_build_object(
          'title', '✅ İş tamamlandı',
          'body', '👍 ' || COALESCE(label, 'İş'),
          'url', target_url,
          'ref', TG_TABLE_NAME || '-' || NEW.id
        )
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Tamamlandı bildirimi gönderilemedi: %', SQLERRM;
  END;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_work_completed() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER work_orders_notify_completed
  AFTER UPDATE OF status ON public.work_orders
  FOR EACH ROW
  WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed')
  EXECUTE FUNCTION public.notify_work_completed();

CREATE OR REPLACE TRIGGER project_tasks_notify_completed
  AFTER UPDATE OF status ON public.project_tasks
  FOR EACH ROW
  WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed')
  EXECUTE FUNCTION public.notify_work_completed();

CREATE OR REPLACE TRIGGER operational_tasks_notify_completed
  AFTER UPDATE OF status ON public.operational_tasks
  FOR EACH ROW
  WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed')
  EXECUTE FUNCTION public.notify_work_completed();

-- Hatırlatma saatleri (UTC; İstanbul = UTC+3): 08:30, 13:00, 17:00, Pzt–Cmt.
SELECT cron.schedule('open-work-reminder-morning', '30 5 * * 1-6',
  $$SELECT public.notify_open_work_reminders('morning');$$);
SELECT cron.schedule('open-work-reminder-midday', '0 10 * * 1-6',
  $$SELECT public.notify_open_work_reminders('midday');$$);
SELECT cron.schedule('open-work-reminder-evening', '0 14 * * 1-6',
  $$SELECT public.notify_open_work_reminders('evening');$$);

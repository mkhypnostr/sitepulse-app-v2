-- Kişiye göre telefon bildirimleri (2. adım).
--
-- 1) Taşerona kişisel hatırlatma (08:30 / 13:00 / 17:00, yöneticiyle aynı
--    saatler): sabah "bugün yapman gerekenler", öğlen "devam eden işlerin",
--    akşam "bugün tamamladıkların / açık kalanlar / yarın". Genel özet artık
--    yalnız yönetici ve teknik ofise gider.
-- 2) Değişiklik ve atama bildirimi: iş emrinin tarihi, açıklaması veya konumu
--    değişince atanmış taşerona ve yöneticilere; görev (proje adımı, bağımsız
--    görev) tarihi/içeriği değişince sorumlusuna ve yöneticilere; bir iş veya
--    görev birine atanınca yöneticilere de (atanana zaten gidiyordu).
--    İşlemi yapan kişiye gitmez. Bildirim hatası kaydı engellemez.
-- Müşteriye bildirim gönderilmez (müşteri hesabı ve izni yok).
-- Yalnız telefon bildirimi; e-posta yok. Tekrar çalıştırılabilir; veri silmez.

CREATE OR REPLACE FUNCTION public.notify_contractor_reminders(slot text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  today date := (now() AT TIME ZONE 'Europe/Istanbul')::date;
  rec record;
  notified integer := 0;
  first_name text;
  title_text text;
  lines text[];
  today_items text[];
  overdue_items text[];
  open_items text[];
  tomorrow_items text[];
  done_items text[];
  waiting_items text[];
BEGIN
  FOR rec IN
    SELECT DISTINCT r.user_id, p.full_name
    FROM public.user_roles r
    JOIN public.profiles p ON p.id = r.user_id
    WHERE r.role = 'contractor'::public.app_role
      AND NOT EXISTS (
        SELECT 1 FROM public.user_roles m
        WHERE m.user_id = r.user_id
          AND m.role IN ('admin'::public.app_role, 'technical_office'::public.app_role)
      )
  LOOP
    WITH items AS (
      SELECT '#' || COALESCE(wo.work_order_no::text, '—') || ' ' || left(wo.title, 50) AS label,
             (wo.scheduled_at AT TIME ZONE 'Europe/Istanbul')::date AS day,
             COALESCE(wo.planned_end_at, wo.scheduled_at) < now()
               AND wo.status <> 'review_pending' AS overdue,
             wo.status = 'review_pending' AS waiting,
             wo.status = 'in_progress' AS active
      FROM public.work_orders wo
      JOIN public.work_order_assignments woa ON woa.work_order_id = wo.id
      WHERE woa.contractor_id = rec.user_id
        AND wo.status NOT IN ('completed', 'cancelled', 'draft')
      UNION ALL
      SELECT left(pt.task_name, 50), pt.planned_date,
             pt.planned_date IS NOT NULL AND pt.planned_date < today,
             pt.status = 'external_approval', pt.status = 'in_progress'
      FROM public.project_tasks pt
      WHERE pt.responsible_id = rec.user_id
        AND pt.status NOT IN ('completed', 'not_applicable')
      UNION ALL
      SELECT left(ot.title, 50), ot.planned_date,
             ot.planned_date IS NOT NULL AND ot.planned_date < today,
             false, ot.status = 'in_progress'
      FROM public.operational_tasks ot
      WHERE ot.assigned_to = rec.user_id
        AND ot.status NOT IN ('completed', 'not_applicable')
    )
    SELECT
      array_agg(label) FILTER (WHERE NOT overdue AND NOT waiting AND (day = today OR active)),
      array_agg(label) FILTER (WHERE overdue),
      array_agg(label) FILTER (WHERE NOT waiting),
      array_agg(label) FILTER (WHERE day = today + 1),
      array_agg(label) FILTER (WHERE waiting)
    INTO today_items, overdue_items, open_items, tomorrow_items, waiting_items
    FROM items;

    SELECT array_agg('#' || COALESCE(wo.work_order_no::text, '—') || ' ' || left(wo.title, 50))
    INTO done_items
    FROM public.work_completion_submissions s
    JOIN public.work_orders wo ON wo.id = s.work_order_id
    WHERE s.submitted_by = rec.user_id
      AND (s.submitted_at AT TIME ZONE 'Europe/Istanbul')::date = today;

    first_name := split_part(COALESCE(NULLIF(btrim(rec.full_name), ''), 'Usta'), ' ', 1);
    lines := ARRAY[]::text[];

    IF slot = 'morning' THEN
      IF overdue_items IS NOT NULL THEN
        lines := lines || ('🔴 Gecikmiş: ' || array_to_string(overdue_items[1:3], ', '));
      END IF;
      IF today_items IS NOT NULL THEN
        lines := lines || ('📍 Bugün: ' || array_to_string(today_items[1:3], ', '));
      ELSIF open_items IS NOT NULL AND overdue_items IS NULL THEN
        lines := lines || ('🟡 Açık işlerin: ' || array_to_string(open_items[1:3], ', '));
      END IF;
      title_text := '☀️ Günaydın ' || first_name || ' · bugün yapman gerekenler';
    ELSIF slot = 'evening' THEN
      IF done_items IS NOT NULL THEN
        lines := lines || ('✅ Bugün bitirdin: ' || array_to_string(done_items[1:3], ', ') || ' 👏');
      END IF;
      IF overdue_items IS NOT NULL THEN
        lines := lines || ('🔴 Gecikmiş: ' || array_to_string(overdue_items[1:3], ', '));
      END IF;
      IF tomorrow_items IS NOT NULL THEN
        lines := lines || ('📅 Yarın: ' || array_to_string(tomorrow_items[1:3], ', '));
      END IF;
      title_text := '🌇 Gün sonu · ' || first_name;
    ELSE
      IF overdue_items IS NOT NULL THEN
        lines := lines || ('🔴 Gecikmiş: ' || array_to_string(overdue_items[1:3], ', '));
      END IF;
      IF today_items IS NOT NULL THEN
        lines := lines || ('⏳ Devam eden: ' || array_to_string(today_items[1:3], ', '));
      END IF;
      IF array_length(lines, 1) > 0 THEN
        lines := lines || '📸 Bitince fotoğraf ve notla "İşi bitir"e bas.'::text;
      END IF;
      title_text := '⏳ ' || first_name || ', işler nasıl gidiyor?';
    END IF;

    IF array_length(lines, 1) > 0 THEN
      BEGIN
        PERFORM public.send_push_notification(
          'open_work_reminder',
          ARRAY[rec.user_id],
          jsonb_build_object(
            'title', title_text,
            'body', array_to_string(lines, E'\n'),
            'url', '/dashboard',
            'slot', slot
          )
        );
        notified := notified + 1;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Taşeron hatırlatması gönderilemedi (%): %', rec.user_id, SQLERRM;
      END;
    END IF;
  END LOOP;
  RETURN notified;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_contractor_reminders(text) FROM PUBLIC, anon, authenticated;

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
    WHERE user_id IN (SELECT user_id FROM managers)
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
  -- Taşeronlara kişisel hatırlatma (ayrı metin).
  notified := notified + public.notify_contractor_reminders(slot);
  RETURN notified;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_open_work_reminders(text) FROM PUBLIC, anon, authenticated;

-- Değişiklik / atama bildirimleri ------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_work_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  actor uuid := (SELECT auth.uid());
  managers uuid[];
  recipients uuid[];
  title_text text;
  body_text text;
  target_url text := '/tasks';
  changes text[] := ARRAY[]::text[];
  assignee_name text;
  ref text;
BEGIN
  BEGIN
    SELECT array_agg(DISTINCT user_id) INTO managers
    FROM public.user_roles
    WHERE role IN ('admin'::public.app_role, 'technical_office'::public.app_role);

    IF TG_TABLE_NAME = 'work_orders' THEN
      IF NEW.status IN ('draft', 'cancelled', 'completed') THEN RETURN NEW; END IF;
      IF NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at
         OR NEW.planned_end_at IS DISTINCT FROM OLD.planned_end_at THEN
        changes := changes || ('📅 ' || COALESCE(to_char(NEW.scheduled_at AT TIME ZONE 'Europe/Istanbul', 'DD.MM HH24:MI'), 'tarih yok')
          || CASE WHEN NEW.planned_end_at IS NOT NULL
                  THEN ' → ' || to_char(NEW.planned_end_at AT TIME ZONE 'Europe/Istanbul', 'DD.MM HH24:MI') ELSE '' END);
      END IF;
      IF NEW.title IS DISTINCT FROM OLD.title OR NEW.description IS DISTINCT FROM OLD.description THEN
        changes := changes || '📝 iş tanımı değişti'::text;
      END IF;
      IF NEW.location IS DISTINCT FROM OLD.location OR NEW.location_url IS DISTINCT FROM OLD.location_url THEN
        changes := changes || '📍 konum değişti'::text;
      END IF;
      IF array_length(changes, 1) IS NULL THEN RETURN NEW; END IF;
      SELECT array_agg(DISTINCT contractor_id) INTO recipients
      FROM public.work_order_assignments WHERE work_order_id = NEW.id;
      recipients := COALESCE(recipients, ARRAY[]::uuid[]) || COALESCE(managers, ARRAY[]::uuid[]);
      title_text := '✏️ İş güncellendi';
      body_text := '#' || COALESCE(NEW.work_order_no::text, '—') || ' ' || NEW.title || E'\n' || array_to_string(changes, ' · ');
      target_url := '/jobs/' || NEW.id;
      ref := 'wo-' || NEW.id;

    ELSIF TG_TABLE_NAME = 'work_order_assignments' THEN
      SELECT full_name INTO assignee_name FROM public.profiles WHERE id = NEW.contractor_id;
      SELECT '#' || COALESCE(wo.work_order_no::text, '—') || ' ' || wo.title, '/jobs/' || wo.id
      INTO body_text, target_url
      FROM public.work_orders wo WHERE wo.id = NEW.work_order_id AND wo.status <> 'draft';
      IF body_text IS NULL THEN RETURN NEW; END IF;
      recipients := managers;
      title_text := '👷 İş atandı → ' || COALESCE(assignee_name, 'taşeron');
      ref := 'woa-' || NEW.work_order_id;

    ELSIF TG_TABLE_NAME = 'project_tasks' THEN
      IF NEW.status IN ('completed', 'not_applicable') THEN RETURN NEW; END IF;
      IF NEW.responsible_id IS DISTINCT FROM OLD.responsible_id AND NEW.responsible_id IS NOT NULL THEN
        SELECT full_name INTO assignee_name FROM public.profiles WHERE id = NEW.responsible_id;
        recipients := managers;
        title_text := '👷 Görev atandı → ' || COALESCE(assignee_name, 'kişi');
      ELSIF NEW.responsible_id IS NOT NULL
        AND (NEW.planned_date IS DISTINCT FROM OLD.planned_date OR NEW.note IS DISTINCT FROM OLD.note) THEN
        recipients := ARRAY[NEW.responsible_id] || COALESCE(managers, ARRAY[]::uuid[]);
        title_text := '✏️ Görev güncellendi';
        IF NEW.planned_date IS DISTINCT FROM OLD.planned_date THEN
          changes := changes || ('📅 ' || COALESCE(to_char(NEW.planned_date, 'DD.MM.YYYY'), 'tarih kaldırıldı'));
        END IF;
        IF NEW.note IS DISTINCT FROM OLD.note THEN changes := changes || '📝 not değişti'::text; END IF;
      ELSE
        RETURN NEW;
      END IF;
      SELECT NEW.task_name || ' · ' || p.name INTO body_text FROM public.projects p WHERE p.id = NEW.project_id;
      IF array_length(changes, 1) > 0 THEN body_text := body_text || E'\n' || array_to_string(changes, ' · '); END IF;
      target_url := '/projects/' || NEW.project_id;
      ref := 'pt-' || NEW.id;

    ELSE -- operational_tasks
      IF NEW.status IN ('completed', 'not_applicable') THEN RETURN NEW; END IF;
      IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to AND NEW.assigned_to IS NOT NULL THEN
        SELECT full_name INTO assignee_name FROM public.profiles WHERE id = NEW.assigned_to;
        recipients := managers;
        title_text := '👷 Görev atandı → ' || COALESCE(assignee_name, 'kişi');
      ELSIF NEW.assigned_to IS NOT NULL
        AND (NEW.planned_date IS DISTINCT FROM OLD.planned_date
             OR NEW.title IS DISTINCT FROM OLD.title
             OR NEW.description IS DISTINCT FROM OLD.description) THEN
        recipients := ARRAY[NEW.assigned_to] || COALESCE(managers, ARRAY[]::uuid[]);
        title_text := '✏️ Görev güncellendi';
        IF NEW.planned_date IS DISTINCT FROM OLD.planned_date THEN
          changes := changes || ('📅 ' || COALESCE(to_char(NEW.planned_date, 'DD.MM.YYYY'), 'tarih kaldırıldı'));
        END IF;
        IF NEW.title IS DISTINCT FROM OLD.title OR NEW.description IS DISTINCT FROM OLD.description THEN
          changes := changes || '📝 içerik değişti'::text;
        END IF;
      ELSE
        RETURN NEW;
      END IF;
      body_text := NEW.title;
      IF array_length(changes, 1) > 0 THEN body_text := body_text || E'\n' || array_to_string(changes, ' · '); END IF;
      ref := 'ot-' || NEW.id;
    END IF;

    SELECT array_agg(DISTINCT u) INTO recipients
    FROM unnest(recipients) u
    WHERE u IS NOT NULL AND u IS DISTINCT FROM actor;

    IF recipients IS NOT NULL THEN
      PERFORM public.send_push_notification(
        'work_change',
        recipients,
        jsonb_build_object('title', title_text, 'body', body_text, 'url', target_url, 'ref', ref)
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Değişiklik bildirimi gönderilemedi: %', SQLERRM;
  END;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_work_change() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER work_orders_notify_change
  AFTER UPDATE OF scheduled_at, planned_end_at, title, description, location, location_url
  ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.notify_work_change();

CREATE OR REPLACE TRIGGER work_order_assignments_notify_managers
  AFTER INSERT ON public.work_order_assignments
  FOR EACH ROW EXECUTE FUNCTION public.notify_work_change();

CREATE OR REPLACE TRIGGER project_tasks_notify_change
  AFTER UPDATE OF responsible_id, planned_date, note ON public.project_tasks
  FOR EACH ROW EXECUTE FUNCTION public.notify_work_change();

CREATE OR REPLACE TRIGGER operational_tasks_notify_change
  AFTER UPDATE OF assigned_to, planned_date, title, description ON public.operational_tasks
  FOR EACH ROW EXECUTE FUNCTION public.notify_work_change();

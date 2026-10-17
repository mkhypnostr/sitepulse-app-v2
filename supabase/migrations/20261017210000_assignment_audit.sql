-- Görev, proje adımı ve iş emri atamalarında "atayan" ve "atanma zamanı".
--
-- Açan (created_by / created_at) zaten tutuluyordu; kimin kime ne zaman
-- atadığı tutulmuyordu. Atanan kişi değiştiği her an tetikleyici atayanı
-- (auth.uid()) ve zamanı yazar; uygulamadaki tüm atama yolları (RPC'ler,
-- doğrudan güncelleme) değişmeden kapsanır. Atama kaldırılırsa alanlar
-- temizlenir.
--
-- Geçmiş kayıtlar: görevlerde ve iş emri atamalarında atayan, kaydı açan
-- kişi kabul edilir (bugüne kadar atamayı açan yapıyordu); proje adımlarında
-- bilinmediği için boş kalır.
--
-- Veri silmez; yalnız sütun, fonksiyon ve tetikleyici ekler (tetikleyiciler
-- tekrar çalıştırılabilsin diye DROP IF EXISTS + CREATE ile kurulur).

ALTER TABLE public.operational_tasks
  ADD COLUMN IF NOT EXISTS assigned_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz;

ALTER TABLE public.project_tasks
  ADD COLUMN IF NOT EXISTS assigned_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz;

ALTER TABLE public.work_order_assignments
  ADD COLUMN IF NOT EXISTS assigned_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.stamp_operational_task_assignment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.assigned_to IS NULL THEN
    NEW.assigned_by := NULL;
    NEW.assigned_at := NULL;
  ELSIF TG_OP = 'INSERT' OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    NEW.assigned_by := COALESCE((SELECT auth.uid()), NEW.created_by);
    NEW.assigned_at := now();
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.stamp_project_task_assignment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.responsible_id IS NULL THEN
    NEW.assigned_by := NULL;
    NEW.assigned_at := NULL;
  ELSIF TG_OP = 'INSERT' OR NEW.responsible_id IS DISTINCT FROM OLD.responsible_id THEN
    NEW.assigned_by := (SELECT auth.uid());
    NEW.assigned_at := now();
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.stamp_work_order_assignment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  NEW.assigned_by := COALESCE((SELECT auth.uid()), NEW.assigned_by);
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.stamp_operational_task_assignment() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stamp_project_task_assignment() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stamp_work_order_assignment() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS operational_tasks_stamp_assignment ON public.operational_tasks;
CREATE TRIGGER operational_tasks_stamp_assignment
BEFORE INSERT OR UPDATE OF assigned_to ON public.operational_tasks
FOR EACH ROW EXECUTE FUNCTION public.stamp_operational_task_assignment();

DROP TRIGGER IF EXISTS project_tasks_stamp_assignment ON public.project_tasks;
CREATE TRIGGER project_tasks_stamp_assignment
BEFORE INSERT OR UPDATE OF responsible_id ON public.project_tasks
FOR EACH ROW EXECUTE FUNCTION public.stamp_project_task_assignment();

DROP TRIGGER IF EXISTS work_order_assignments_stamp ON public.work_order_assignments;
CREATE TRIGGER work_order_assignments_stamp
BEFORE INSERT OR UPDATE OF contractor_id ON public.work_order_assignments
FOR EACH ROW EXECUTE FUNCTION public.stamp_work_order_assignment();

-- Geçmiş kayıtlar (yalnız boş olanlar doldurulur).
UPDATE public.operational_tasks
SET assigned_by = created_by, assigned_at = created_at
WHERE assigned_to IS NOT NULL AND assigned_by IS NULL;

UPDATE public.work_order_assignments a
SET assigned_by = w.created_by
FROM public.work_orders w
WHERE w.id = a.work_order_id AND a.assigned_by IS NULL;

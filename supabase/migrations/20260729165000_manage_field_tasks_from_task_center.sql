-- Görev Merkezinden saha görevinin temel bilgileri ve sorumlusu yönetilir.
-- Ticari bilgiler bu fonksiyonun kapsamı dışındadır.

CREATE OR REPLACE FUNCTION public.update_work_order_task(
  target_work_order_id UUID,
  task_title TEXT,
  task_description TEXT,
  planned_at TIMESTAMPTZ,
  assigned_user_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
BEGIN
  IF current_user_id IS NULL OR NOT public.has_role(current_user_id, 'admin') THEN
    RAISE EXCEPTION 'Saha görevi düzenleme yalnızca yönetici yetkisindedir';
  END IF;

  IF NULLIF(trim(task_title), '') IS NULL OR char_length(trim(task_title)) < 3 THEN
    RAISE EXCEPTION 'Görev başlığı en az 3 karakter olmalıdır';
  END IF;

  IF planned_at IS NULL THEN
    RAISE EXCEPTION 'Planlanan tarih zorunludur';
  END IF;

  IF assigned_user_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = assigned_user_id) THEN
    RAISE EXCEPTION 'Seçilen sorumlu kullanıcı bulunamadı';
  END IF;

  UPDATE public.work_orders
  SET title = trim(task_title),
      description = NULLIF(trim(task_description), ''),
      scheduled_at = planned_at,
      updated_at = now()
  WHERE id = target_work_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Saha görevi bulunamadı';
  END IF;

  DELETE FROM public.work_order_assignments
  WHERE work_order_id = target_work_order_id;

  IF assigned_user_id IS NOT NULL THEN
    INSERT INTO public.work_order_assignments (work_order_id, contractor_id)
    VALUES (target_work_order_id, assigned_user_id);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.update_work_order_task(UUID, TEXT, TEXT, TIMESTAMPTZ, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_work_order_task(UUID, TEXT, TEXT, TIMESTAMPTZ, UUID) TO authenticated;

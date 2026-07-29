-- Yönetici için proje ve saha görevi kalıcı silme işlemleri.
-- Bu işlemler geri alınamaz; arayüz her çağrıdan önce ikinci onay ister.

CREATE OR REPLACE FUNCTION public.delete_work_order_permanently(target_work_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
BEGIN
  IF current_user_id IS NULL OR NOT public.has_role(current_user_id, 'admin') THEN
    RAISE EXCEPTION 'Saha görevi silme yalnızca yönetici yetkisindedir';
  END IF;

  -- İş emrine bağlı hareket logları da silinir; bağlı kanıt/atama/finans kayıtları
  -- mevcut foreign key CASCADE kurallarıyla temizlenir.
  DELETE FROM public.activity_logs
  WHERE work_order_id = target_work_order_id;

  DELETE FROM public.work_orders
  WHERE id = target_work_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Saha görevi bulunamadı';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_project_permanently(target_project_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
BEGIN
  IF current_user_id IS NULL OR NOT public.has_role(current_user_id, 'admin') THEN
    RAISE EXCEPTION 'Proje silme yalnızca yönetici yetkisindedir';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = target_project_id) THEN
    RAISE EXCEPTION 'Proje bulunamadı';
  END IF;

  -- Projeye bağlı saha görevleri ve onların kanıt/atama/finans kayıtları da
  -- kalıcı silinir. Bağımsız görevler aynı projeye bağlanmışsa onlar da silinir.
  DELETE FROM public.activity_logs
  WHERE project_id = target_project_id
     OR work_order_id IN (
       SELECT id FROM public.work_orders WHERE project_id = target_project_id
     );

  DELETE FROM public.operational_tasks
  WHERE project_id = target_project_id;

  DELETE FROM public.work_orders
  WHERE project_id = target_project_id;

  -- project_processes/project_tasks ve bunlara bağlı kanıt/ilerleme kayıtları
  -- foreign key CASCADE ile silinir.
  DELETE FROM public.projects
  WHERE id = target_project_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_work_order_permanently(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_project_permanently(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_work_order_permanently(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_project_permanently(UUID) TO authenticated;

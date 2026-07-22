-- Yönetici rollerini uygulama içi rol değişikliklerinden korur.
-- Yönetici atama/kaldırma yalnızca service_role kullanan güvenli kullanıcı
-- yönetimi bağlantısı üzerinden yapılır. Ekip ekranı yalnızca taşeron ve
-- müşteri rolleri arasında değişiklik yapabilir.

REVOKE INSERT, UPDATE, DELETE ON public.user_roles FROM authenticated;

DROP POLICY IF EXISTS "roles_admin_all" ON public.user_roles;

CREATE OR REPLACE FUNCTION public.set_user_role(
  target_user_id UUID,
  new_role public.app_role
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
    RAISE EXCEPTION 'Bu işlem için yönetici yetkisi gerekir';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = target_user_id) THEN
    RAISE EXCEPTION 'Kullanıcı bulunamadı';
  END IF;

  IF new_role = 'admin' THEN
    RAISE EXCEPTION 'Yönetici rolü Ekip ekranından verilemez';
  END IF;

  IF public.has_role(target_user_id, 'admin') THEN
    RAISE EXCEPTION 'Yönetici hesabının rolü Ekip ekranından değiştirilemez';
  END IF;

  DELETE FROM public.user_roles WHERE user_id = target_user_id;
  INSERT INTO public.user_roles (user_id, role) VALUES (target_user_id, new_role);
END;
$$;

REVOKE ALL ON FUNCTION public.set_user_role(UUID, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_user_role(UUID, public.app_role) TO authenticated;

-- Kurumsal giriş e-postası değiştirme özelliği için destek:
-- 1) Ekip listesine, yalnızca yöneticiye görünen mevcut giriş e-postasını ekler
--    (onay diyaloğunda "mevcut e-posta" gösterebilmek için).
-- 2) Denetim günlüğüne yeni bir işlem türü ekler: 'update_email'.
-- Bu değişiklikler auth.users tablosuna dokunmaz; yalnızca okuma/denetim amaçlıdır.

DROP FUNCTION IF EXISTS public.list_operational_team_members();

CREATE FUNCTION public.list_operational_team_members()
RETURNS TABLE(id UUID, full_name TEXT, company_name TEXT, phone TEXT, role public.app_role, email TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  is_administrator BOOLEAN := public.has_role(current_user_id, 'admin'::public.app_role);
BEGIN
  IF NOT public.can_manage_projects(current_user_id) THEN
    RAISE EXCEPTION 'Bu işlem için operasyon yönetim yetkisi gerekir';
  END IF;

  RETURN QUERY
  SELECT
    profile.id,
    profile.full_name,
    profile.company_name,
    profile.phone,
    user_role.role,
    CASE WHEN is_administrator THEN auth_user.email ELSE NULL END
  FROM public.profiles AS profile
  JOIN public.user_roles AS user_role ON user_role.user_id = profile.id
  JOIN auth.users AS auth_user ON auth_user.id = profile.id
  WHERE is_administrator OR user_role.role = 'contractor'::public.app_role
  ORDER BY profile.full_name NULLS LAST, user_role.role;
END;
$$;

REVOKE ALL ON FUNCTION public.list_operational_team_members() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_operational_team_members() TO authenticated;

ALTER TABLE public.user_management_audit
  DROP CONSTRAINT IF EXISTS user_management_audit_action_check;

ALTER TABLE public.user_management_audit
  ADD CONSTRAINT user_management_audit_action_check
  CHECK (action IN ('create_user', 'reset_password', 'update_email'));

-- Yetki yardımcısı çağıranın rolüyle çalışır; hassas satırları doğrudan okumaz.
CREATE OR REPLACE FUNCTION public.can_manage_projects(target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT target_user_id IS NOT NULL
    AND (
      public.has_role(target_user_id, 'admin'::public.app_role)
      OR public.has_role(target_user_id, 'technical_office'::public.app_role)
    );
$$;

REVOKE ALL ON FUNCTION public.can_manage_projects(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_projects(UUID) TO authenticated;

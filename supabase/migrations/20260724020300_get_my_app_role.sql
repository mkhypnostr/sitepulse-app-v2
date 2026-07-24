-- Return only the signed-in user's highest operational role.
-- This prevents a failed client-side table read from being interpreted as "customer".
CREATE OR REPLACE FUNCTION public.get_my_app_role()
RETURNS public.app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (
      SELECT ur.role
      FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
      ORDER BY CASE ur.role
        WHEN 'admin' THEN 1
        WHEN 'technical_office' THEN 2
        WHEN 'contractor' THEN 3
        ELSE 4
      END
      LIMIT 1
    ),
    'customer'::public.app_role
  );
$$;

REVOKE ALL ON FUNCTION public.get_my_app_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_app_role() TO authenticated;

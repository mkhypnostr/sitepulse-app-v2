-- customers ve work_orders RLS politikaları arasındaki döngüyü keser.
CREATE OR REPLACE FUNCTION public.contractor_can_access_customer(
  target_contractor_id UUID,
  target_customer_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.work_orders wo
    JOIN public.work_order_assignments a
      ON a.work_order_id = wo.id
    WHERE wo.customer_id = target_customer_id
      AND a.contractor_id = target_contractor_id
  );
$$;

REVOKE ALL ON FUNCTION public.contractor_can_access_customer(UUID, UUID)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.contractor_can_access_customer(UUID, UUID)
TO authenticated;

DROP POLICY IF EXISTS "customers_contractor_read"
ON public.customers;

CREATE POLICY "customers_contractor_read"
ON public.customers
FOR SELECT
TO authenticated
USING (
  public.has_role((SELECT auth.uid()), 'contractor')
  AND public.contractor_can_access_customer(
    (SELECT auth.uid()),
    id
  )
);

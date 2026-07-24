-- Teknik ofis, taşerona atanmış saha görevlerini görür; finans tablolarına erişemez.
-- Görev oluşturma, atama ve onaylama yalnızca yönetici fonksiyonları ve
-- mevcut yönetici politikaları aracılığıyla yapılmaya devam eder.

DROP POLICY IF EXISTS "wo_technical_office_read" ON public.work_orders;
CREATE POLICY "wo_technical_office_read"
ON public.work_orders
FOR SELECT TO authenticated
USING (public.can_manage_projects((SELECT auth.uid())));

DROP POLICY IF EXISTS "woa_technical_office_read" ON public.work_order_assignments;
CREATE POLICY "woa_technical_office_read"
ON public.work_order_assignments
FOR SELECT TO authenticated
USING (public.can_manage_projects((SELECT auth.uid())));

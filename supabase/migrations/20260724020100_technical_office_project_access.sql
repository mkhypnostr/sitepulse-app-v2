-- Teknik Ofis: proje/şantiye operasyonlarını, müşteri kartlarını ve stok
-- kataloglarını yönetir. İş emri finansları, ödeme/hakediş, yönetici rolleri
-- ve parola işlemleri kesinlikle kapsam dışındadır.

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

-- Proje operasyonu ekranlarının ihtiyacı olan kayıtlar.
DROP POLICY IF EXISTS "technical_office_projects_read" ON public.projects;
CREATE POLICY "technical_office_projects_read" ON public.projects
FOR SELECT TO authenticated
USING (public.can_manage_projects((SELECT auth.uid())));

DROP POLICY IF EXISTS "technical_office_project_processes_read" ON public.project_processes;
CREATE POLICY "technical_office_project_processes_read" ON public.project_processes
FOR SELECT TO authenticated
USING (public.can_manage_projects((SELECT auth.uid())));

DROP POLICY IF EXISTS "technical_office_project_tasks_read" ON public.project_tasks;
CREATE POLICY "technical_office_project_tasks_read" ON public.project_tasks
FOR SELECT TO authenticated
USING (public.can_manage_projects((SELECT auth.uid())));

DROP POLICY IF EXISTS "technical_office_project_activity_read" ON public.project_task_activity;
CREATE POLICY "technical_office_project_activity_read" ON public.project_task_activity
FOR SELECT TO authenticated
USING (public.can_manage_projects((SELECT auth.uid())));

DROP POLICY IF EXISTS "technical_office_project_evidence_read" ON public.project_task_evidence;
CREATE POLICY "technical_office_project_evidence_read" ON public.project_task_evidence
FOR SELECT TO authenticated
USING (public.can_manage_projects((SELECT auth.uid())));

DROP POLICY IF EXISTS "technical_office_project_evidence_insert" ON public.project_task_evidence;
CREATE POLICY "technical_office_project_evidence_insert" ON public.project_task_evidence
FOR INSERT TO authenticated
WITH CHECK (
  public.can_manage_projects((SELECT auth.uid()))
  AND uploaded_by = (SELECT auth.uid())
);

DROP POLICY IF EXISTS "technical_office_project_progress_read" ON public.project_task_progress_submissions;
CREATE POLICY "technical_office_project_progress_read" ON public.project_task_progress_submissions
FOR SELECT TO authenticated
USING (public.can_manage_projects((SELECT auth.uid())));

-- Teknik ofis tüm müşteri/profil tablolarını değil, sadece atama için gereken
-- sınırlı alanları bu iki kontrollü fonksiyon üzerinden görür.
CREATE OR REPLACE FUNCTION public.list_project_customers()
RETURNS TABLE(id UUID, name TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.can_manage_projects((SELECT auth.uid())) THEN
    RAISE EXCEPTION 'Bu işlem için proje yönetim yetkisi gerekir';
  END IF;

  RETURN QUERY
  SELECT customer.id, customer.name
  FROM public.customers AS customer
  ORDER BY customer.name;
END;
$$;

REVOKE ALL ON FUNCTION public.list_project_customers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_project_customers() TO authenticated;

CREATE OR REPLACE FUNCTION public.list_project_assignees()
RETURNS TABLE(id UUID, full_name TEXT, role public.app_role)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.can_manage_projects((SELECT auth.uid())) THEN
    RAISE EXCEPTION 'Bu işlem için proje yönetim yetkisi gerekir';
  END IF;

  RETURN QUERY
  SELECT profile.id, profile.full_name, user_role.role
  FROM public.profiles AS profile
  JOIN public.user_roles AS user_role ON user_role.user_id = profile.id
  WHERE user_role.role IN ('admin'::public.app_role, 'technical_office'::public.app_role, 'contractor'::public.app_role)
  ORDER BY profile.full_name NULLS LAST, user_role.role;
END;
$$;

REVOKE ALL ON FUNCTION public.list_project_assignees() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_project_assignees() TO authenticated;

-- Teknik ofis müşteri kartındaki fatura/iletişim bilgilerini girebilir.
-- Bu alanlar yalnızca bilgi amaçlıdır; satış, maliyet veya ödeme tutarı içermez.
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS billing_title TEXT,
  ADD COLUMN IF NOT EXISTS tax_office TEXT,
  ADD COLUMN IF NOT EXISTS tax_no TEXT,
  ADD COLUMN IF NOT EXISTS billing_address TEXT;

ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_billing_title_length_check,
  DROP CONSTRAINT IF EXISTS customers_tax_office_length_check,
  DROP CONSTRAINT IF EXISTS customers_tax_no_length_check,
  DROP CONSTRAINT IF EXISTS customers_billing_address_length_check;

ALTER TABLE public.customers
  ADD CONSTRAINT customers_billing_title_length_check
    CHECK (billing_title IS NULL OR char_length(billing_title) <= 180),
  ADD CONSTRAINT customers_tax_office_length_check
    CHECK (tax_office IS NULL OR char_length(tax_office) <= 120),
  ADD CONSTRAINT customers_tax_no_length_check
    CHECK (tax_no IS NULL OR char_length(tax_no) BETWEEN 4 AND 32),
  ADD CONSTRAINT customers_billing_address_length_check
    CHECK (billing_address IS NULL OR char_length(billing_address) <= 1000);

DROP POLICY IF EXISTS "technical_office_customers_read" ON public.customers;
CREATE POLICY "technical_office_customers_read" ON public.customers
FOR SELECT TO authenticated
USING (public.can_manage_projects((SELECT auth.uid())));

DROP POLICY IF EXISTS "technical_office_customers_insert" ON public.customers;
CREATE POLICY "technical_office_customers_insert" ON public.customers
FOR INSERT TO authenticated
WITH CHECK (public.can_manage_projects((SELECT auth.uid())));

DROP POLICY IF EXISTS "technical_office_customers_update" ON public.customers;
CREATE POLICY "technical_office_customers_update" ON public.customers
FOR UPDATE TO authenticated
USING (public.can_manage_projects((SELECT auth.uid())))
WITH CHECK (public.can_manage_projects((SELECT auth.uid())));

-- Teknik ofis stok kartlarını ve seviyelerini kontrol eder; stok silme veya
-- iş emri/maliyet/finans tablolarına erişimi yoktur.
DROP POLICY IF EXISTS "technical_office_stock_items_read" ON public.stock_items;
CREATE POLICY "technical_office_stock_items_read" ON public.stock_items
FOR SELECT TO authenticated
USING (public.can_manage_projects((SELECT auth.uid())));

DROP POLICY IF EXISTS "technical_office_stock_items_insert" ON public.stock_items;
CREATE POLICY "technical_office_stock_items_insert" ON public.stock_items
FOR INSERT TO authenticated
WITH CHECK (public.can_manage_projects((SELECT auth.uid())));

DROP POLICY IF EXISTS "technical_office_stock_items_update" ON public.stock_items;
CREATE POLICY "technical_office_stock_items_update" ON public.stock_items
FOR UPDATE TO authenticated
USING (public.can_manage_projects((SELECT auth.uid())))
WITH CHECK (public.can_manage_projects((SELECT auth.uid())));

DROP POLICY IF EXISTS "technical_office_stock_movements_read" ON public.stock_movements;
CREATE POLICY "technical_office_stock_movements_read" ON public.stock_movements
FOR SELECT TO authenticated
USING (public.can_manage_projects((SELECT auth.uid())));

-- Ekip ekranı teknik ofise yalnızca taşeronları listeler. E-posta, şifre ve
-- rol yönetim kayıtları bu kontrollü çıktı içinde yer almaz.
CREATE OR REPLACE FUNCTION public.list_operational_team_members()
RETURNS TABLE(id UUID, full_name TEXT, company_name TEXT, phone TEXT, role public.app_role)
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
  SELECT profile.id, profile.full_name, profile.company_name, profile.phone, user_role.role
  FROM public.profiles AS profile
  JOIN public.user_roles AS user_role ON user_role.user_id = profile.id
  WHERE is_administrator OR user_role.role = 'contractor'::public.app_role
  ORDER BY profile.full_name NULLS LAST, user_role.role;
END;
$$;

REVOKE ALL ON FUNCTION public.list_operational_team_members() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_operational_team_members() TO authenticated;

-- Kanıt dosyaları için yalnızca proje kanıt deposunda sınırlı depolama erişimi.
DROP POLICY IF EXISTS "technical_office_project_evidence_storage_read" ON storage.objects;
CREATE POLICY "technical_office_project_evidence_storage_read" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'project-evidence'
  AND public.can_manage_projects((SELECT auth.uid()))
);

DROP POLICY IF EXISTS "technical_office_project_evidence_storage_insert" ON storage.objects;
CREATE POLICY "technical_office_project_evidence_storage_insert" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'project-evidence'
  AND public.can_manage_projects((SELECT auth.uid()))
);

-- Yalnızca proje/süreç fonksiyonlarının yetki kontrolünü teknik ofisi de kapsayacak
-- şekilde güncelle. Finans fonksiyonlarına kesinlikle dokunulmaz.
DO $$
DECLARE
  fn_oid OID;
  fn_definition TEXT;
BEGIN
  FOR fn_oid IN
    SELECT p.oid
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'create_project_with_workflow',
        'update_project_details',
        'update_project_lifecycle',
        'update_project_task',
        'review_project_task_progress'
      )
  LOOP
    SELECT pg_get_functiondef(fn_oid)
    INTO fn_definition;

    fn_definition := replace(
      fn_definition,
      'NOT public.has_role(current_user_id, ''admin'')',
      'NOT public.can_manage_projects(current_user_id)'
    );
    fn_definition := replace(
      fn_definition,
      'NOT public.has_role(target_manager_id, ''admin'')',
      'NOT public.can_manage_projects(target_manager_id)'
    );
    fn_definition := replace(
      fn_definition,
      E'public.has_role(assigned_user_id, ''admin'')\n       OR public.has_role(assigned_user_id, ''contractor'')',
      E'public.has_role(assigned_user_id, ''admin'')\n       OR public.has_role(assigned_user_id, ''technical_office'')\n       OR public.has_role(assigned_user_id, ''contractor'')'
    );

    EXECUTE fn_definition;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.create_project_with_workflow(
  UUID, TEXT, public.project_type[], TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  NUMERIC, UUID, DATE, DATE, public.project_status, BOOLEAN, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_project_with_workflow(
  UUID, TEXT, public.project_type[], TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  NUMERIC, UUID, DATE, DATE, public.project_status, BOOLEAN, TEXT, TEXT
) TO authenticated;

REVOKE ALL ON FUNCTION public.update_project_details(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, UUID, DATE, DATE, BOOLEAN, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_project_details(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, UUID, DATE, DATE, BOOLEAN, TEXT, TEXT
) TO authenticated;

REVOKE ALL ON FUNCTION public.update_project_lifecycle(UUID, public.project_status, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_project_lifecycle(UUID, public.project_status, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.delete_draft_project(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_draft_project(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.update_project_task(
  UUID, public.project_task_status, UUID, DATE, TEXT, TEXT, DATE
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_project_task(
  UUID, public.project_task_status, UUID, DATE, TEXT, TEXT, DATE
) TO authenticated;

REVOKE ALL ON FUNCTION public.review_project_task_progress(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_project_task_progress(UUID, BOOLEAN, TEXT) TO authenticated;

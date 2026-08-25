CREATE TABLE public.measurement_service_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_date date,
  customer_name text NOT NULL CHECK (NULLIF(trim(customer_name), '') IS NOT NULL),
  contact_name text,
  contact_phone text,
  location text,
  service_type text NOT NULL CHECK (NULLIF(trim(service_type), '') IS NOT NULL),
  report_status text NOT NULL DEFAULT 'planned' CHECK (report_status IN ('planned','measured','approved','delivered')),
  payment_status text NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending','partial','paid','overdue')),
  agreed_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (agreed_amount >= 0),
  vat_rate numeric(5,4) NOT NULL DEFAULT 0.20 CHECK (vat_rate BETWEEN 0 AND 1),
  collected_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (collected_amount >= 0),
  due_date date,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.measurement_service_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "measurement_services_finance_all" ON public.measurement_service_records FOR ALL TO authenticated USING ((SELECT public.can_manage_finance(auth.uid()))) WITH CHECK ((SELECT public.can_manage_finance(auth.uid())));

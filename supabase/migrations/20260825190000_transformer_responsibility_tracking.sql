CREATE TABLE public.transformer_responsibility_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name text NOT NULL CHECK (NULLIF(trim(customer_name), '') IS NOT NULL),
  facility_name text NOT NULL CHECK (NULLIF(trim(facility_name), '') IS NOT NULL),
  location text,
  transformer_power_kva numeric(12,2),
  voltage_level text,
  responsible_engineer text,
  contract_start_date date NOT NULL,
  contract_end_date date NOT NULL,
  monthly_fee numeric(14,2) NOT NULL DEFAULT 0 CHECK (monthly_fee >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','cancelled')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (contract_end_date >= contract_start_date)
);
CREATE TABLE public.transformer_monthly_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.transformer_responsibility_contracts(id) ON DELETE CASCADE,
  check_month date NOT NULL,
  checked_at timestamptz,
  checker_name text,
  signed_by text,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','completed','not_completed')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_id, check_month)
);
ALTER TABLE public.transformer_responsibility_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transformer_monthly_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "transformer_contracts_finance_all" ON public.transformer_responsibility_contracts FOR ALL TO authenticated USING ((SELECT public.can_manage_finance(auth.uid()))) WITH CHECK ((SELECT public.can_manage_finance(auth.uid())));
CREATE POLICY "transformer_checks_finance_all" ON public.transformer_monthly_checks FOR ALL TO authenticated USING ((SELECT public.can_manage_finance(auth.uid()))) WITH CHECK ((SELECT public.can_manage_finance(auth.uid())));

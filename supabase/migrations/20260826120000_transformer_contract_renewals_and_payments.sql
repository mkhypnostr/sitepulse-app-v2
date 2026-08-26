-- Firma kartı, yıllık sözleşme geçmişi ve aylık tahsilat takibi.
-- Teknik kontrol veya resmî imza yetkisi üretmez.

CREATE TABLE public.transformer_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL UNIQUE
    CHECK (NULLIF(trim(company_name), '') IS NOT NULL),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.transformer_responsibility_contracts
  ADD COLUMN company_id uuid
    REFERENCES public.transformer_companies(id) ON DELETE RESTRICT;

INSERT INTO public.transformer_companies (company_name)
SELECT DISTINCT trim(customer_name)
FROM public.transformer_responsibility_contracts
ON CONFLICT (company_name) DO NOTHING;

UPDATE public.transformer_responsibility_contracts AS contract
SET company_id = company.id
FROM public.transformer_companies AS company
WHERE company.company_name = trim(contract.customer_name);

ALTER TABLE public.transformer_responsibility_contracts
  ALTER COLUMN company_id SET NOT NULL;

ALTER TABLE public.transformer_responsibility_contracts
  RENAME COLUMN facility_name TO subscriber_no;

ALTER TABLE public.transformer_responsibility_contracts
  RENAME COLUMN voltage_level TO transformer_type;

ALTER TABLE public.transformer_responsibility_contracts
  ADD COLUMN renewed_from_contract_id uuid
    REFERENCES public.transformer_responsibility_contracts(id) ON DELETE SET NULL;

CREATE TABLE public.transformer_monthly_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL
    REFERENCES public.transformer_responsibility_contracts(id) ON DELETE CASCADE,
  payment_month date NOT NULL
    CHECK (EXTRACT(DAY FROM payment_month) = 1),
  expected_amount numeric(14,2) NOT NULL CHECK (expected_amount >= 0),
  received_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (received_amount >= 0),
  paid_at date,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'partial', 'paid', 'overdue')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_id, payment_month)
);

CREATE INDEX transformer_contracts_company_id_idx
  ON public.transformer_responsibility_contracts(company_id);
CREATE INDEX transformer_contracts_renewed_from_idx
  ON public.transformer_responsibility_contracts(renewed_from_contract_id);
CREATE INDEX transformer_monthly_payments_contract_month_idx
  ON public.transformer_monthly_payments(contract_id, payment_month);

ALTER TABLE public.transformer_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transformer_monthly_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "transformer_companies_finance_all"
ON public.transformer_companies
FOR ALL TO authenticated
USING ((SELECT public.can_manage_finance(auth.uid())))
WITH CHECK ((SELECT public.can_manage_finance(auth.uid())));

CREATE POLICY "transformer_payments_finance_all"
ON public.transformer_monthly_payments
FOR ALL TO authenticated
USING ((SELECT public.can_manage_finance(auth.uid())))
WITH CHECK ((SELECT public.can_manage_finance(auth.uid())));

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS referring_architect TEXT,
  ADD COLUMN IF NOT EXISTS quoted_amount NUMERIC(14,2) CHECK (quoted_amount IS NULL OR quoted_amount >= 0),
  ADD COLUMN IF NOT EXISTS contract_amount NUMERIC(14,2) CHECK (contract_amount IS NULL OR contract_amount >= 0);

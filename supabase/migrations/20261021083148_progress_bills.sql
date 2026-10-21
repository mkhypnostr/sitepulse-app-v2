-- Taşeron hakedişi → müşteri hakedişi.
--
-- Taşeronun (ör. Özkan Elektrik) getirdiği liste kalem kalem girilir
-- (asistan fotoğraftan okuyabilir); müşteriye giden hakediş, her kalemin
-- taşeron tutarına kâr oranı eklenerek hesaplanır. Alış tutarları ve kâr
-- oranı içerdiği için yalnız finans yetkisi (yönetici) görür.
-- Numara: NES-HKD-YYAA-NNNN.

CREATE TABLE IF NOT EXISTS public.progress_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_no text UNIQUE,
  title text NOT NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name text,
  subcontractor_name text NOT NULL,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  margin_pct numeric(6,2) NOT NULL DEFAULT 25 CHECK (margin_pct >= 0 AND margin_pct <= 500),
  vat_rate numeric(5,2) NOT NULL DEFAULT 20 CHECK (vat_rate >= 0 AND vat_rate <= 100),
  written_total numeric(14,2),
  photo_path text,
  notes text,
  status text NOT NULL DEFAULT 'taslak'
    CHECK (status IN ('taslak', 'gonderildi', 'onaylandi', 'iptal')),
  bill_date date NOT NULL DEFAULT current_date,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.progress_bill_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id uuid NOT NULL REFERENCES public.progress_bills(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  quantity numeric(14,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit text NOT NULL DEFAULT 'adet',
  description text NOT NULL,
  cost_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (cost_amount >= 0),
  note text
);

CREATE INDEX IF NOT EXISTS progress_bills_date_idx ON public.progress_bills (bill_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS progress_bills_customer_idx ON public.progress_bills (customer_id);
CREATE INDEX IF NOT EXISTS progress_bill_lines_bill_idx ON public.progress_bill_lines (bill_id, position);

CREATE OR REPLACE FUNCTION public.progress_bills_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  period text;
  next_no integer;
BEGIN
  period := to_char(COALESCE(NEW.bill_date, current_date), 'YYMM');
  PERFORM pg_advisory_xact_lock(hashtext('progress-bill-no-' || period));
  SELECT COALESCE(MAX(split_part(bill_no, '-', 4)::integer), 0) + 1
    INTO next_no
    FROM public.progress_bills
   WHERE bill_no LIKE 'NES-HKD-' || period || '-%';
  NEW.bill_no := 'NES-HKD-' || period || '-' || lpad(next_no::text, 4, '0');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS progress_bills_before_insert ON public.progress_bills;
CREATE TRIGGER progress_bills_before_insert
BEFORE INSERT ON public.progress_bills
FOR EACH ROW EXECUTE FUNCTION public.progress_bills_before_insert();

CREATE OR REPLACE FUNCTION public.progress_bills_before_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.bill_no := OLD.bill_no;
  NEW.created_by := OLD.created_by;
  NEW.created_at := OLD.created_at;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS progress_bills_before_update ON public.progress_bills;
CREATE TRIGGER progress_bills_before_update
BEFORE UPDATE ON public.progress_bills
FOR EACH ROW EXECUTE FUNCTION public.progress_bills_before_update();

ALTER TABLE public.progress_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.progress_bill_lines ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl text;
  op text;
  pol text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['progress_bills', 'progress_bill_lines'] LOOP
    FOREACH op IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
      pol := 'finance managers ' || lower(op) || ' ' || tbl;
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = tbl AND policyname = pol
      ) THEN
        IF op = 'INSERT' THEN
          EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK ((SELECT public.can_manage_finance(auth.uid())))', pol, tbl);
        ELSIF op = 'UPDATE' THEN
          EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING ((SELECT public.can_manage_finance(auth.uid()))) WITH CHECK ((SELECT public.can_manage_finance(auth.uid())))', pol, tbl);
        ELSE
          EXECUTE format('CREATE POLICY %I ON public.%I FOR %s TO authenticated USING ((SELECT public.can_manage_finance(auth.uid())))', pol, tbl, op);
        END IF;
      END IF;
    END LOOP;
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.progress_bills TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.progress_bill_lines TO authenticated;
REVOKE ALL ON public.progress_bills FROM anon;
REVOKE ALL ON public.progress_bill_lines FROM anon;

-- Asistana eklenen fotoğraflar (taşeron listesi, fatura, saha fotoğrafı).
-- Özel depo; yönetici + teknik ofis yükler ve görür.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('assistant-uploads', 'assistant-uploads', false, 10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  op text;
  pol text;
BEGIN
  FOREACH op IN ARRAY ARRAY['SELECT', 'INSERT', 'DELETE'] LOOP
    pol := 'assistant uploads ' || lower(op);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = pol
    ) THEN
      IF op = 'INSERT' THEN
        EXECUTE format('CREATE POLICY %I ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = %L AND (SELECT public.can_manage_projects(auth.uid())))', pol, 'assistant-uploads');
      ELSE
        EXECUTE format('CREATE POLICY %I ON storage.objects FOR %s TO authenticated USING (bucket_id = %L AND (SELECT public.can_manage_projects(auth.uid())))', pol, op, 'assistant-uploads');
      END IF;
    END IF;
  END LOOP;
END $$;

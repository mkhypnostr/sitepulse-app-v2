-- Cari hesap: müşteri bazında fatura ve tahsilat hareketleri.
--
-- customer_ledger_entries: fatura (borç), tahsilat (alacak), iade ve açılış
-- bakiyesi kayıtları. Proje ve teklife bağlanabilir. Bakiye = fatura +
-- açılış − tahsilat − iade (para birimi bazında). Resmî muhasebenin yerine
-- geçmez; alacak takibi içindir.
--
-- Finansal veri olduğu için yalnız can_manage_finance (yönetici).
-- Yalnız ekleme yapar (DROP içermez) ve tekrar çalıştırılabilir.

CREATE TABLE IF NOT EXISTS public.customer_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  offer_id uuid REFERENCES public.offers(id) ON DELETE SET NULL,
  entry_type text NOT NULL CHECK (entry_type IN ('fatura', 'tahsilat', 'iade', 'acilis')),
  entry_date date NOT NULL DEFAULT current_date,
  due_date date,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL DEFAULT 'TRY' CHECK (currency IN ('TRY', 'USD', 'EUR')),
  payment_method text CHECK (payment_method IS NULL OR payment_method IN
    ('havale', 'nakit', 'kredi_karti', 'cek', 'senet', 'diger')),
  document_no text CHECK (document_no IS NULL OR char_length(document_no) <= 60),
  description text CHECK (description IS NULL OR char_length(description) <= 500),
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_ledger_customer_idx
  ON public.customer_ledger_entries (customer_id, entry_date);
CREATE INDEX IF NOT EXISTS customer_ledger_project_idx
  ON public.customer_ledger_entries (project_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'customer_ledger_touch_updated_at'
      AND tgrelid = 'public.customer_ledger_entries'::regclass
  ) THEN
    CREATE TRIGGER customer_ledger_touch_updated_at
    BEFORE UPDATE ON public.customer_ledger_entries
    FOR EACH ROW EXECUTE FUNCTION public.touch_offer_updated_at();
  END IF;
END $$;

ALTER TABLE public.customer_ledger_entries ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  op text;
BEGIN
  FOREACH op IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'customer_ledger_entries'
        AND policyname = 'finance managers ' || lower(op) || ' ledger'
    ) THEN
      IF op = 'INSERT' THEN
        EXECUTE 'CREATE POLICY "finance managers insert ledger" ON public.customer_ledger_entries FOR INSERT TO authenticated WITH CHECK ((SELECT public.can_manage_finance(auth.uid())))';
      ELSIF op = 'UPDATE' THEN
        EXECUTE 'CREATE POLICY "finance managers update ledger" ON public.customer_ledger_entries FOR UPDATE TO authenticated USING ((SELECT public.can_manage_finance(auth.uid()))) WITH CHECK ((SELECT public.can_manage_finance(auth.uid())))';
      ELSE
        EXECUTE format(
          'CREATE POLICY %I ON public.customer_ledger_entries FOR %s TO authenticated USING ((SELECT public.can_manage_finance(auth.uid())))',
          'finance managers ' || lower(op) || ' ledger', op);
      END IF;
    END IF;
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_ledger_entries TO authenticated;

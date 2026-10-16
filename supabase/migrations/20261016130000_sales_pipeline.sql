-- Satış takibi: fırsatlar (aday → kazanıldı/kaybedildi), görüşme geçmişi
-- ve takip hatırlatmaları.
--
-- 1) sales_leads: bir iş fırsatı. Kayıtlı müşteriye bağlı olabilir ya da
--    henüz müşteri olmayan kişi/firma bilgisini kendi taşır. Aşama, tahmini
--    tutar, kaynak, sorumlu ve bir sonraki adım (tarihli) tutulur.
-- 2) sales_activities: arama, ziyaret, toplantı, e-posta, WhatsApp, keşif ve
--    notlar. Fırsata ve/veya müşteriye bağlanır.
-- 3) offers.lead_id: teklifin hangi fırsattan çıktığı.
--
-- Tahmini tutar finansal bilgi olduğu için tablolar yalnız
-- can_manage_finance (yönetici) ile okunur/yazılır.
-- Yalnız ekleme yapar (DROP içermez) ve tekrar çalıştırılabilir.

CREATE TABLE IF NOT EXISTS public.sales_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(trim(title)) BETWEEN 2 AND 180),
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  company_name text CHECK (company_name IS NULL OR char_length(company_name) <= 160),
  contact_name text CHECK (contact_name IS NULL OR char_length(contact_name) <= 120),
  phone text CHECK (phone IS NULL OR char_length(phone) <= 40),
  email text CHECK (email IS NULL OR char_length(email) <= 160),
  location text CHECK (location IS NULL OR char_length(location) <= 160),
  service text NOT NULL DEFAULT 'ges'
    CHECK (service IN ('ges', 'sarj', 'taahhut', 'bakim', 'olcum', 'diger')),
  source text NOT NULL DEFAULT 'telefon'
    CHECK (source IN ('telefon', 'referans', 'web', 'sosyal_medya', 'saha', 'fuar', 'mevcut_musteri', 'diger')),
  stage text NOT NULL DEFAULT 'yeni'
    CHECK (stage IN ('yeni', 'gorusuldu', 'kesif', 'teklif', 'pazarlik', 'kazanildi', 'kaybedildi')),
  estimated_value numeric(14,2) CHECK (estimated_value IS NULL OR estimated_value >= 0),
  currency char(3) NOT NULL DEFAULT 'TRY' CHECK (currency IN ('TRY', 'USD', 'EUR')),
  expected_close date,
  next_action text CHECK (next_action IS NULL OR char_length(next_action) <= 200),
  next_action_at date,
  lost_reason text CHECK (lost_reason IS NULL OR char_length(lost_reason) <= 300),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 4000),
  owner_id uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  stage_changed_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

CREATE INDEX IF NOT EXISTS sales_leads_stage_idx ON public.sales_leads (stage, next_action_at);
CREATE INDEX IF NOT EXISTS sales_leads_customer_idx ON public.sales_leads (customer_id);

CREATE TABLE IF NOT EXISTS public.sales_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.sales_leads(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'arama'
    CHECK (kind IN ('arama', 'ziyaret', 'toplanti', 'eposta', 'whatsapp', 'kesif', 'teklif', 'not', 'asama')),
  summary text NOT NULL CHECK (char_length(trim(summary)) BETWEEN 1 AND 2000),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (lead_id IS NOT NULL OR customer_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS sales_activities_lead_idx ON public.sales_activities (lead_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS sales_activities_customer_idx ON public.sales_activities (customer_id, occurred_at DESC);

ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS lead_id uuid
  REFERENCES public.sales_leads(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS offers_lead_idx ON public.offers (lead_id);

-- updated_at, aşama değişim ve kapanış zamanları.
CREATE OR REPLACE FUNCTION public.sales_leads_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  IF TG_OP = 'UPDATE' AND NEW.stage IS DISTINCT FROM OLD.stage THEN
    NEW.stage_changed_at := now();
    IF NEW.stage IN ('kazanildi', 'kaybedildi') THEN
      NEW.closed_at := now();
    ELSE
      NEW.closed_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'sales_leads_touch_trigger'
      AND tgrelid = 'public.sales_leads'::regclass
  ) THEN
    CREATE TRIGGER sales_leads_touch_trigger
    BEFORE UPDATE ON public.sales_leads
    FOR EACH ROW EXECUTE FUNCTION public.sales_leads_touch();
  END IF;
END $$;

ALTER TABLE public.sales_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_activities ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
  op text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales_leads', 'sales_activities'] LOOP
    FOREACH op IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = t
          AND policyname = format('finance managers %s %s', lower(op), t)
      ) THEN
        IF op = 'INSERT' THEN
          EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK ((SELECT public.can_manage_finance(auth.uid())))',
            format('finance managers %s %s', lower(op), t), t);
        ELSIF op = 'UPDATE' THEN
          EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING ((SELECT public.can_manage_finance(auth.uid()))) WITH CHECK ((SELECT public.can_manage_finance(auth.uid())))',
            format('finance managers %s %s', lower(op), t), t);
        ELSE
          EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR %s TO authenticated USING ((SELECT public.can_manage_finance(auth.uid())))',
            format('finance managers %s %s', lower(op), t), t, op);
        END IF;
      END IF;
    END LOOP;
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_leads TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_activities TO authenticated;

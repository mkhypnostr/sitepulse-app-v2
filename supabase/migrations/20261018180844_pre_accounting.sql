-- Ön muhasebe altyapısı (Paraşüt ön muhasebe tarafının karşılığı):
--
--  * company_profile      Firma bilgileri (satıcı), e-belge sağlayıcısı ayarı.
--                         Tek satır. Yazılım firmadan bağımsız: aynı kod başka
--                         bir şirket için ayrı veritabanında kurulabilir.
--  * suppliers            Tedarikçiler.
--  * purchase_bills       Alış / gider faturaları ve fişler (matrah, KDV,
--                         tevkifat), proje ve kategoriye bağlanır, belge eki.
--  * cash_accounts        Kasa, banka, kredi kartı hesapları.
--  * cash_transactions    Para giriş/çıkışları: tedarikçi ödemesi, doğrudan
--                         gider, diğer gelir, hesaplar arası virman.
--  * customer_ledger_entries.account_id
--                         Cari tahsilat hangi hesaba girdi (kasa/banka bakiyesi).
--  * invoices.provider_*  e-Belge sağlayıcısı (ileride Paraşüt API) alanları.
--
-- Bakiye ve raporlar uygulamada hesaplanır (src/lib/accounting.ts).
-- Finansal veri: yalnız can_manage_finance (yönetici).
-- Yalnız ekleme yapar (DROP TABLE/kolon yok) ve tekrar çalıştırılabilir.

-- ---------------------------------------------------------------------------
-- Firma bilgileri

CREATE TABLE IF NOT EXISTS public.company_profile (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  brand text NOT NULL DEFAULT '' CHECK (char_length(brand) <= 80),
  legal_name text NOT NULL DEFAULT '' CHECK (char_length(legal_name) <= 250),
  address text NOT NULL DEFAULT '' CHECK (char_length(address) <= 300),
  district text NOT NULL DEFAULT '' CHECK (char_length(district) <= 120),
  city text NOT NULL DEFAULT '' CHECK (char_length(city) <= 60),
  phone text NOT NULL DEFAULT '' CHECK (char_length(phone) <= 40),
  email text NOT NULL DEFAULT '' CHECK (char_length(email) <= 120),
  web text NOT NULL DEFAULT '' CHECK (char_length(web) <= 120),
  tax_no text NOT NULL DEFAULT '' CHECK (tax_no = '' OR tax_no ~ '^[0-9]{10,11}$'),
  tax_office text NOT NULL DEFAULT '' CHECK (char_length(tax_office) <= 120),
  trade_registry_no text NOT NULL DEFAULT '' CHECK (char_length(trade_registry_no) <= 40),
  mersis_no text NOT NULL DEFAULT '' CHECK (mersis_no = '' OR mersis_no ~ '^[0-9]{16}$'),
  logo_url text NOT NULL DEFAULT '/nes-enerji-logo.png' CHECK (char_length(logo_url) <= 300),
  -- Faturanın GİB'e nasıl gittiği: elle (GİB portalı / entegratör ekranı)
  -- ya da API bağlantılı sağlayıcı. Sağlayıcı anahtarları Supabase
  -- secret'larındadır, burada tutulmaz.
  einvoice_provider text NOT NULL DEFAULT 'manual'
    CHECK (einvoice_provider IN ('manual', 'parasut')),
  einvoice_activation_date date,
  invoice_footer_note text NOT NULL DEFAULT '' CHECK (char_length(invoice_footer_note) <= 500),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- NES bilgileri (kesilmiş e-Faturalardaki satıcı bilgileri).
INSERT INTO public.company_profile (
  id, brand, legal_name, address, district, city, phone, email, web,
  tax_no, tax_office, trade_registry_no, mersis_no
) VALUES (
  1, 'NES Enerji',
  'NES TEKNİK ENERJİ MÜHENDİSLİK İNŞAAT SANAYİ VE TİCARET LİMİTED ŞİRKETİ',
  'ORHANİYE MAHALLESİ 12 NOLU SOKAK NUR APARTMANI NO:6 C',
  'Menteşe, MUĞLA – Türkiye', 'MUĞLA', '0 (554) 610 24 16',
  'info@nesgrup.com', 'nesgrup.com', '6312027568', 'MUĞLA VERGİ DAİRESİ',
  '12571', '0631202756800001'
) ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Tedarikçiler

CREATE TABLE IF NOT EXISTS public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 250),
  tax_no text CHECK (tax_no IS NULL OR tax_no ~ '^[0-9]{10,11}$'),
  tax_office text CHECK (tax_office IS NULL OR char_length(tax_office) <= 120),
  address text CHECK (address IS NULL OR char_length(address) <= 500),
  phone text CHECK (phone IS NULL OR char_length(phone) <= 40),
  email text CHECK (email IS NULL OR char_length(email) <= 200),
  iban text CHECK (iban IS NULL OR char_length(iban) <= 40),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 1000),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS suppliers_tax_no_unique
  ON public.suppliers (tax_no) WHERE tax_no IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Kasa / banka hesapları

CREATE TABLE IF NOT EXISTS public.cash_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  kind text NOT NULL DEFAULT 'banka'
    CHECK (kind IN ('kasa', 'banka', 'kredi_karti', 'diger')),
  currency char(3) NOT NULL DEFAULT 'TRY' CHECK (currency IN ('TRY', 'USD', 'EUR')),
  bank_name text CHECK (bank_name IS NULL OR char_length(bank_name) <= 120),
  iban text CHECK (iban IS NULL OR char_length(iban) <= 40),
  opening_balance numeric(14,2) NOT NULL DEFAULT 0,
  opening_date date NOT NULL DEFAULT current_date,
  show_on_invoice boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Faturalarda yazan NES hesabı.
INSERT INTO public.cash_accounts (name, kind, currency, bank_name, iban, show_on_invoice, sort_order)
SELECT 'Akbank TL', 'banka', 'TRY', 'Akbank', 'TR21 0004 6001 2888 8000 3242 29', true, 1
WHERE NOT EXISTS (SELECT 1 FROM public.cash_accounts);
INSERT INTO public.cash_accounts (name, kind, currency, sort_order)
SELECT 'Kasa (nakit)', 'kasa', 'TRY', 2
WHERE NOT EXISTS (SELECT 1 FROM public.cash_accounts WHERE kind = 'kasa');

-- ---------------------------------------------------------------------------
-- Alış / gider faturaları

CREATE TABLE IF NOT EXISTS public.purchase_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  document_type text NOT NULL DEFAULT 'e_fatura'
    CHECK (document_type IN ('e_fatura', 'e_arsiv', 'kagit', 'fis', 'diger')),
  document_no text CHECK (document_no IS NULL OR char_length(document_no) <= 60),
  ettn uuid,
  issue_date date NOT NULL DEFAULT current_date,
  due_date date,
  category text NOT NULL DEFAULT 'malzeme'
    CHECK (category IN ('malzeme', 'taseron', 'akaryakit', 'arac', 'kira',
      'abonelik', 'yazilim', 'ofis', 'yemek_konaklama', 'vergi_harc',
      'maas_sgk', 'banka', 'demirbas', 'diger')),
  description text CHECK (description IS NULL OR char_length(description) <= 500),
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  currency char(3) NOT NULL DEFAULT 'TRY' CHECK (currency IN ('TRY', 'USD', 'EUR')),
  exchange_rate numeric(14,4) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),
  net_amount numeric(14,2) NOT NULL CHECK (net_amount >= 0),
  vat_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  withholding_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (withholding_amount >= 0),
  total_amount numeric(14,2) GENERATED ALWAYS AS (net_amount + vat_amount - withholding_amount) STORED,
  attachment_path text CHECK (attachment_path IS NULL OR char_length(attachment_path) <= 400),
  source text NOT NULL DEFAULT 'elle' CHECK (source IN ('elle', 'parasut')),
  provider_ref text CHECK (provider_ref IS NULL OR char_length(provider_ref) <= 80),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 1000),
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_bills_withholding_le_vat CHECK (withholding_amount <= vat_amount)
);

CREATE INDEX IF NOT EXISTS purchase_bills_date_idx ON public.purchase_bills (issue_date);
CREATE INDEX IF NOT EXISTS purchase_bills_supplier_idx ON public.purchase_bills (supplier_id);
CREATE INDEX IF NOT EXISTS purchase_bills_project_idx ON public.purchase_bills (project_id);
CREATE UNIQUE INDEX IF NOT EXISTS purchase_bills_provider_ref_unique
  ON public.purchase_bills (source, provider_ref) WHERE provider_ref IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS purchase_bills_ettn_unique
  ON public.purchase_bills (ettn) WHERE ettn IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Para hareketleri

CREATE TABLE IF NOT EXISTS public.cash_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.cash_accounts(id) ON DELETE RESTRICT,
  txn_date date NOT NULL DEFAULT current_date,
  direction text NOT NULL CHECK (direction IN ('giris', 'cikis')),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  kind text NOT NULL DEFAULT 'diger'
    CHECK (kind IN ('tedarikci_odeme', 'gider', 'gelir', 'virman', 'diger')),
  category text CHECK (category IS NULL OR char_length(category) <= 40),
  description text CHECK (description IS NULL OR char_length(description) <= 500),
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  purchase_bill_id uuid REFERENCES public.purchase_bills(id) ON DELETE SET NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  -- Virman: iki hareket aynı transfer_group ile (biri çıkış, biri giriş).
  transfer_group uuid,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cash_transactions_account_idx ON public.cash_transactions (account_id, txn_date);
CREATE INDEX IF NOT EXISTS cash_transactions_bill_idx ON public.cash_transactions (purchase_bill_id);
CREATE INDEX IF NOT EXISTS cash_transactions_supplier_idx ON public.cash_transactions (supplier_id);
CREATE INDEX IF NOT EXISTS cash_transactions_transfer_idx ON public.cash_transactions (transfer_group);

-- Cari tahsilat hangi kasa/bankaya girdi.
ALTER TABLE public.customer_ledger_entries
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.cash_accounts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS customer_ledger_account_idx
  ON public.customer_ledger_entries (account_id);

-- ---------------------------------------------------------------------------
-- e-Belge sağlayıcısı alanları (faturalar). provider = 'manual' iken GİB
-- numarası elle girilir; 'parasut' iken sunucu fonksiyonu doldurur.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'manual'
    CHECK (provider IN ('manual', 'parasut')),
  ADD COLUMN IF NOT EXISTS provider_ref text
    CHECK (provider_ref IS NULL OR char_length(provider_ref) <= 80),
  ADD COLUMN IF NOT EXISTS provider_status text
    CHECK (provider_status IS NULL OR provider_status IN ('pending', 'running', 'done', 'error')),
  ADD COLUMN IF NOT EXISTS provider_error text
    CHECK (provider_error IS NULL OR char_length(provider_error) <= 1000),
  ADD COLUMN IF NOT EXISTS pdf_path text
    CHECK (pdf_path IS NULL OR char_length(pdf_path) <= 400);

-- ---------------------------------------------------------------------------
-- updated_at tetikleyicileri

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['suppliers', 'cash_accounts', 'purchase_bills', 'cash_transactions', 'company_profile'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = tbl || '_touch_updated_at'
        AND tgrelid = ('public.' || tbl)::regclass
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_offer_updated_at()',
        tbl || '_touch_updated_at', tbl);
    END IF;
  END LOOP;
END $$;

-- Hareketi olan hesap silinemez (ON DELETE RESTRICT); kasa/banka hesabı
-- yerine "pasif" yapılır. Ödemesi olan alış faturası silinirse ödeme
-- kaydı kalır, bağlantısı kopar (SET NULL) — uygulama bunu önce uyarır.

-- ---------------------------------------------------------------------------
-- RLS: yalnız finans yetkilisi (yönetici)

ALTER TABLE public.company_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_transactions ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl text;
  op text;
  pol text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['suppliers', 'cash_accounts', 'purchase_bills', 'cash_transactions'] LOOP
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

  -- Firma bilgileri: okuma ve güncelleme (satır tek, eklenmez/silinmez).
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'company_profile' AND policyname = 'finance managers select company_profile') THEN
    CREATE POLICY "finance managers select company_profile" ON public.company_profile
      FOR SELECT TO authenticated USING ((SELECT public.can_manage_finance(auth.uid())));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'company_profile' AND policyname = 'finance managers update company_profile') THEN
    CREATE POLICY "finance managers update company_profile" ON public.company_profile
      FOR UPDATE TO authenticated
      USING ((SELECT public.can_manage_finance(auth.uid())))
      WITH CHECK ((SELECT public.can_manage_finance(auth.uid())));
  END IF;
END $$;

GRANT SELECT, UPDATE ON public.company_profile TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppliers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cash_accounts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_bills TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cash_transactions TO authenticated;
REVOKE ALL ON public.company_profile FROM anon;
REVOKE ALL ON public.suppliers FROM anon;
REVOKE ALL ON public.cash_accounts FROM anon;
REVOKE ALL ON public.purchase_bills FROM anon;
REVOKE ALL ON public.cash_transactions FROM anon;

-- ---------------------------------------------------------------------------
-- Belge ekleri (alış faturası PDF / fiş fotoğrafı). Özel bucket, yalnız
-- finans yetkilisi.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('finance-documents', 'finance-documents', false, 10485760,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/xml', 'text/xml'])
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  op text;
  pol text;
BEGIN
  FOREACH op IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
    pol := 'finance documents ' || lower(op);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = pol
    ) THEN
      IF op = 'INSERT' THEN
        EXECUTE format('CREATE POLICY %I ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = %L AND (SELECT public.can_manage_finance(auth.uid())))', pol, 'finance-documents');
      ELSIF op = 'UPDATE' THEN
        EXECUTE format('CREATE POLICY %I ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = %L AND (SELECT public.can_manage_finance(auth.uid()))) WITH CHECK (bucket_id = %L AND (SELECT public.can_manage_finance(auth.uid())))', pol, 'finance-documents', 'finance-documents');
      ELSE
        EXECUTE format('CREATE POLICY %I ON storage.objects FOR %s TO authenticated USING (bucket_id = %L AND (SELECT public.can_manage_finance(auth.uid())))', pol, op, 'finance-documents');
      END IF;
    END IF;
  END LOOP;
END $$;

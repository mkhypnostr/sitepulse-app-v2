-- Faturalar: uygulama içinde fatura hazırlama, numaralama, arşiv ve cari
-- hesaba bağlama.
--
-- Yasal not: e-Fatura / e-Arşiv faturanın hukuken "kesilmesi" GİB sistemi
-- üzerinden olur (GİB e-Belge portalı ücretsiz, ya da özel entegratör).
-- Bu tablo faturayı hazırlar, UBL-TR verisini üretir ve GİB'de kesildikten
-- sonra GİB fatura numarası/ETTN ile "kesildi" olarak arşivler. Kesilen
-- fatura değiştirilemez; yalnızca iptal edilebilir.
--
-- Kesilen faturalar customer_ledger_feed üzerinden cari hesapta borç olarak
-- görünür (kopya kayıt yok). Trafo / ölçüm kaynaklı faturalar o modüllerin
-- satırlarıyla zaten carideyse (source_kind dolu) ikinci kez sayılmaz.
--
-- Finansal veri: yalnız can_manage_finance (yönetici). Yalnız ekleme yapar
-- (DROP içermez) ve tekrar çalıştırılabilir.

CREATE TABLE IF NOT EXISTS public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_no text UNIQUE,
  status text NOT NULL DEFAULT 'taslak'
    CHECK (status IN ('taslak', 'kesildi', 'iptal')),
  profile text NOT NULL DEFAULT 'TICARIFATURA'
    CHECK (profile IN ('TEMELFATURA', 'TICARIFATURA', 'EARSIVFATURA')),
  invoice_type text NOT NULL DEFAULT 'SATIS'
    CHECK (invoice_type IN ('SATIS', 'IADE', 'TEVKIFAT', 'ISTISNA')),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  buyer_title text NOT NULL CHECK (char_length(buyer_title) BETWEEN 1 AND 250),
  buyer_tax_no text CHECK (buyer_tax_no IS NULL OR buyer_tax_no ~ '^[0-9]{10,11}$'),
  buyer_tax_office text CHECK (buyer_tax_office IS NULL OR char_length(buyer_tax_office) <= 120),
  buyer_address text CHECK (buyer_address IS NULL OR char_length(buyer_address) <= 500),
  buyer_email text CHECK (buyer_email IS NULL OR char_length(buyer_email) <= 200),
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  offer_id uuid REFERENCES public.offers(id) ON DELETE SET NULL,
  source_kind text CHECK (source_kind IS NULL OR source_kind IN ('trafo', 'olcum')),
  source_id uuid,
  issue_date date NOT NULL DEFAULT current_date,
  due_date date,
  currency char(3) NOT NULL DEFAULT 'TRY' CHECK (currency IN ('TRY', 'USD', 'EUR')),
  exchange_rate numeric(14,4) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),
  withholding_code text CHECK (withholding_code IS NULL OR char_length(withholding_code) <= 10),
  withholding_rate numeric(5,4) NOT NULL DEFAULT 0
    CHECK (withholding_rate >= 0 AND withholding_rate <= 1),
  exemption_code text CHECK (exemption_code IS NULL OR char_length(exemption_code) <= 10),
  exemption_reason text CHECK (exemption_reason IS NULL OR char_length(exemption_reason) <= 250),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 1500),
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  discount_total numeric(14,2) NOT NULL DEFAULT 0,
  vat_total numeric(14,2) NOT NULL DEFAULT 0,
  withholding_total numeric(14,2) NOT NULL DEFAULT 0,
  grand_total numeric(14,2) NOT NULL DEFAULT 0,
  payable_total numeric(14,2) NOT NULL DEFAULT 0,
  ettn uuid NOT NULL DEFAULT gen_random_uuid(),
  gib_invoice_no text UNIQUE
    CHECK (gib_invoice_no IS NULL OR gib_invoice_no ~ '^[A-Z0-9]{3}20[0-9]{2}[0-9]{9}$'),
  issued_at timestamptz,
  issued_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  cancel_reason text CHECK (cancel_reason IS NULL OR char_length(cancel_reason) <= 300),
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoices_issued_has_gib_no
    CHECK (status <> 'kesildi' OR gib_invoice_no IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 300),
  quantity numeric(14,4) NOT NULL CHECK (quantity > 0),
  unit text NOT NULL DEFAULT 'Adet' CHECK (char_length(unit) BETWEEN 1 AND 20),
  unit_price numeric(16,4) NOT NULL CHECK (unit_price >= 0),
  discount_rate numeric(5,4) NOT NULL DEFAULT 0
    CHECK (discount_rate >= 0 AND discount_rate < 1),
  vat_rate numeric(5,4) NOT NULL DEFAULT 0.20
    CHECK (vat_rate IN (0, 0.01, 0.10, 0.20)),
  net_amount numeric(14,2) NOT NULL DEFAULT 0,
  vat_amount numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoices_customer_idx ON public.invoices (customer_id, issue_date);
CREATE INDEX IF NOT EXISTS invoices_status_idx ON public.invoices (status, issue_date);
CREATE INDEX IF NOT EXISTS invoices_offer_idx ON public.invoices (offer_id);
CREATE INDEX IF NOT EXISTS invoices_project_idx ON public.invoices (project_id);
CREATE INDEX IF NOT EXISTS invoice_lines_invoice_idx ON public.invoice_lines (invoice_id, position);

-- Taslak numarası: NES-FTR-YYYY-NNNN (yıl içinde sıralı). GİB numarası
-- kesildiğinde ayrıca girilir. Kesilmiş fatura yalnız iptal edilebilir.
CREATE OR REPLACE FUNCTION public.invoices_before_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  yr text;
  next_no integer;
  reason text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'taslak' THEN
      RAISE EXCEPTION 'Fatura taslak olarak oluşturulur.';
    END IF;
    yr := to_char(NEW.issue_date, 'YYYY');
    PERFORM pg_advisory_xact_lock(hashtext('invoice-draft-no-' || yr));
    SELECT COALESCE(MAX(split_part(draft_no, '-', 4)::integer), 0) + 1
      INTO next_no
      FROM public.invoices
     WHERE draft_no LIKE 'NES-FTR-' || yr || '-%';
    NEW.draft_no := 'NES-FTR-' || yr || '-' || lpad(next_no::text, 4, '0');
    NEW.issued_at := NULL;
    NEW.issued_by := NULL;
    NEW.cancelled_at := NULL;
    RETURN NEW;
  END IF;

  IF OLD.status = 'iptal' THEN
    RAISE EXCEPTION 'İptal edilmiş fatura değiştirilemez.';
  END IF;

  IF OLD.status = 'kesildi' THEN
    IF NEW.status <> 'iptal' THEN
      RAISE EXCEPTION 'Kesilmiş fatura değiştirilemez; gerekirse iptal edin.';
    END IF;
    reason := NEW.cancel_reason;
    IF reason IS NULL OR btrim(reason) = '' THEN
      RAISE EXCEPTION 'İptal nedeni yazılmalı.';
    END IF;
    NEW := OLD;
    NEW.status := 'iptal';
    NEW.cancel_reason := reason;
    NEW.cancelled_at := now();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- Taslak üzerinde düzenleme (ETTN yalnız kesilirken GİB değeriyle değişebilir).
  NEW.draft_no := OLD.draft_no;
  IF NEW.status <> 'kesildi' THEN
    NEW.ettn := OLD.ettn;
  END IF;
  NEW.created_by := OLD.created_by;
  NEW.created_at := OLD.created_at;
  IF NEW.status = 'kesildi' THEN
    IF NOT EXISTS (SELECT 1 FROM public.invoice_lines WHERE invoice_id = OLD.id) THEN
      RAISE EXCEPTION 'Satırı olmayan fatura kesilemez.';
    END IF;
    NEW.issued_at := now();
    NEW.issued_by := auth.uid();
  ELSIF NEW.status = 'iptal' THEN
    NEW.cancelled_at := now();
    NEW.issued_at := NULL;
  ELSE
    NEW.issued_at := NULL;
    NEW.issued_by := NULL;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invoices_before_write ON public.invoices;
CREATE TRIGGER invoices_before_write
BEFORE INSERT OR UPDATE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.invoices_before_write();

-- Kesilmiş fatura silinemez (taslak silinebilir).
CREATE OR REPLACE FUNCTION public.invoices_before_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.status <> 'taslak' THEN
    RAISE EXCEPTION 'Kesilmiş veya iptal edilmiş fatura silinemez (yasal arşiv).';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS invoices_before_delete ON public.invoices;
CREATE TRIGGER invoices_before_delete
BEFORE DELETE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.invoices_before_delete();

-- Satır tutarları ve fatura toplamları. Yuvarlama: satır net ve KDV 2
-- haneye; tevkifat toplam KDV üzerinden.
CREATE OR REPLACE FUNCTION public.invoice_lines_before_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  inv_status text;
  gross numeric;
BEGIN
  SELECT status INTO inv_status FROM public.invoices
   WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  -- Fatura silinirken (taslak) satırlar zincirleme silinir; üst kayıt artık yok.
  IF TG_OP = 'DELETE' AND inv_status IS NULL THEN
    RETURN OLD;
  END IF;
  IF inv_status IS DISTINCT FROM 'taslak' THEN
    RAISE EXCEPTION 'Yalnız taslak faturanın satırları değiştirilebilir.';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  gross := NEW.quantity * NEW.unit_price;
  NEW.net_amount := round(gross * (1 - NEW.discount_rate), 2);
  NEW.vat_amount := round(NEW.net_amount * NEW.vat_rate, 2);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invoice_lines_before_write ON public.invoice_lines;
CREATE TRIGGER invoice_lines_before_write
BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_lines
FOR EACH ROW EXECUTE FUNCTION public.invoice_lines_before_write();

CREATE OR REPLACE FUNCTION public.recalculate_invoice_totals(target_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  s_gross numeric;
  s_net numeric;
  s_vat numeric;
  w_rate numeric;
  w_total numeric;
BEGIN
  SELECT COALESCE(SUM(round(quantity * unit_price, 2)), 0),
         COALESCE(SUM(net_amount), 0),
         COALESCE(SUM(vat_amount), 0)
    INTO s_gross, s_net, s_vat
    FROM public.invoice_lines WHERE invoice_id = target_invoice_id;
  SELECT CASE WHEN invoice_type = 'TEVKIFAT' THEN withholding_rate ELSE 0 END
    INTO w_rate FROM public.invoices WHERE id = target_invoice_id;
  w_total := round(s_vat * COALESCE(w_rate, 0), 2);
  UPDATE public.invoices
     SET subtotal = s_net,
         discount_total = GREATEST(s_gross - s_net, 0),
         vat_total = s_vat,
         withholding_total = w_total,
         grand_total = s_net + s_vat,
         payable_total = s_net + s_vat - w_total
   WHERE id = target_invoice_id AND status = 'taslak';
END;
$$;

REVOKE ALL ON FUNCTION public.recalculate_invoice_totals(uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.invoice_lines_after_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM public.recalculate_invoice_totals(COALESCE(NEW.invoice_id, OLD.invoice_id));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS invoice_lines_after_write ON public.invoice_lines;
CREATE TRIGGER invoice_lines_after_write
AFTER INSERT OR UPDATE OR DELETE ON public.invoice_lines
FOR EACH ROW EXECUTE FUNCTION public.invoice_lines_after_write();

-- Tür veya tevkifat oranı değişince toplamları yenile (taslakta).
CREATE OR REPLACE FUNCTION public.invoices_after_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'taslak' AND (
    NEW.invoice_type IS DISTINCT FROM OLD.invoice_type
    OR NEW.withholding_rate IS DISTINCT FROM OLD.withholding_rate
  ) THEN
    PERFORM public.recalculate_invoice_totals(NEW.id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS invoices_after_update ON public.invoices;
CREATE TRIGGER invoices_after_update
AFTER UPDATE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.invoices_after_update();

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_lines ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl text;
  op text;
  pol text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['invoices', 'invoice_lines'] LOOP
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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_lines TO authenticated;
REVOKE ALL ON public.invoices FROM anon;
REVOKE ALL ON public.invoice_lines FROM anon;

-- Cari hesap akışına kesilmiş faturaları ekle.
CREATE OR REPLACE VIEW public.customer_ledger_feed
WITH (security_invoker = true) AS
SELECT
  e.id::text AS id,
  'cari'::text AS source,
  e.id AS source_id,
  e.customer_id,
  e.project_id,
  e.entry_type,
  e.entry_date,
  e.due_date,
  e.amount,
  e.currency::text AS currency,
  e.payment_method,
  e.document_no,
  e.description
FROM public.customer_ledger_entries e
UNION ALL
SELECT
  'trafo-f-' || p.id::text,
  'trafo',
  p.id,
  co.customer_id,
  NULL::uuid,
  'fatura',
  p.payment_month,
  (p.payment_month + interval '1 month' - interval '1 day')::date,
  p.expected_amount,
  'TRY',
  NULL::text,
  NULL::text,
  'Trafo sorumluluğu · ' || c.subscriber_no || ' · ' || to_char(p.payment_month, 'MM.YYYY')
FROM public.transformer_monthly_payments p
JOIN public.transformer_responsibility_contracts c ON c.id = p.contract_id
JOIN public.transformer_companies co ON co.id = c.company_id
WHERE co.customer_id IS NOT NULL
  AND p.expected_amount > 0
  AND p.payment_month <= date_trunc('month', current_date)::date
UNION ALL
SELECT
  'trafo-t-' || p.id::text,
  'trafo',
  p.id,
  co.customer_id,
  NULL::uuid,
  'tahsilat',
  COALESCE(p.paid_at, p.payment_month),
  NULL::date,
  p.received_amount,
  'TRY',
  NULL::text,
  NULL::text,
  'Trafo sorumluluğu · ' || c.subscriber_no || ' · ' || to_char(p.payment_month, 'MM.YYYY')
FROM public.transformer_monthly_payments p
JOIN public.transformer_responsibility_contracts c ON c.id = p.contract_id
JOIN public.transformer_companies co ON co.id = c.company_id
WHERE co.customer_id IS NOT NULL
  AND p.received_amount > 0
UNION ALL
SELECT
  'olcum-f-' || m.id::text,
  'olcum',
  m.id,
  m.customer_id,
  m.project_id,
  'fatura',
  COALESCE(m.service_date, m.created_at::date),
  m.due_date,
  round(m.agreed_amount * (1 + m.vat_rate), 2),
  'TRY',
  NULL::text,
  NULL::text,
  'Ölçüm · ' || m.service_type
FROM public.measurement_service_records m
WHERE m.customer_id IS NOT NULL
  AND m.agreed_amount > 0
UNION ALL
SELECT
  'olcum-t-' || m.id::text,
  'olcum',
  m.id,
  m.customer_id,
  m.project_id,
  'tahsilat',
  m.updated_at::date,
  NULL::date,
  m.collected_amount,
  'TRY',
  NULL::text,
  NULL::text,
  'Ölçüm · ' || m.service_type
FROM public.measurement_service_records m
WHERE m.customer_id IS NOT NULL
  AND m.collected_amount > 0
UNION ALL
SELECT
  'fatura-' || i.id::text,
  'fatura',
  i.id,
  i.customer_id,
  i.project_id,
  CASE WHEN i.invoice_type = 'IADE' THEN 'iade' ELSE 'fatura' END,
  i.issue_date,
  i.due_date,
  i.payable_total,
  i.currency::text,
  NULL::text,
  i.gib_invoice_no,
  'Fatura · ' || COALESCE(
    (SELECT l.description FROM public.invoice_lines l
      WHERE l.invoice_id = i.id ORDER BY l.position LIMIT 1), '')
FROM public.invoices i
WHERE i.status = 'kesildi'
  AND i.source_kind IS NULL
  AND i.payable_total > 0;

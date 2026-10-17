-- Cari hesap: Trafo Sorumluluğu ve Ölçüm/Tahsilat modüllerindeki faturalar ve
-- tahsilatlar müşterinin cari hesabında da görünsün.
--
-- Kayıtlar kopyalanmaz: customer_ledger_feed görünümü üç kaynağı birleştirir.
-- Modüllerde yapılan her değişiklik cari hesaba anında yansır, çift kayıt
-- oluşmaz. Diğer modüllerden gelen satırlar cari hesapta salt okunurdur;
-- düzeltme kendi modülünde yapılır.
--
-- Bağlantı: trafo firması ve ölçüm kaydı müşteri listesindeki bir müşteriye
-- customer_id ile bağlanır. Bağlanmamış kayıtlar cari hesaba düşmez.
--
-- Trafo: her ayın beklenen tutarı o ayın 1'inde fatura, vadesi ay sonu;
-- yalnız bu aya kadar olan aylar (gelecek aylar borç sayılmaz). Alınan tutar
-- ödeme gününde (yoksa ayın 1'inde) tahsilat.
-- Ölçüm: anlaşılan tutar × (1 + KDV) hizmet gününde fatura; tahsil edilen
-- tutar kaydın son güncellendiği gün tahsilat.
--
-- Yalnız ekleme yapar (DROP içermez, görünüm CREATE OR REPLACE) ve tekrar
-- çalıştırılabilir. Görünüm security_invoker: alttaki tabloların RLS kuralları
-- (can_manage_finance = yönetici) aynen geçerlidir.

ALTER TABLE public.transformer_companies
  ADD COLUMN IF NOT EXISTS customer_id uuid
    REFERENCES public.customers(id) ON DELETE SET NULL;

ALTER TABLE public.measurement_service_records
  ADD COLUMN IF NOT EXISTS customer_id uuid
    REFERENCES public.customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS transformer_companies_customer_idx
  ON public.transformer_companies (customer_id);
CREATE INDEX IF NOT EXISTS measurement_service_records_customer_idx
  ON public.measurement_service_records (customer_id);

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
  NULL,
  NULL,
  'Trafo sorumluluğu · ' || c.subscriber_no || ' · '
    || to_char(p.payment_month, 'MM.YYYY')
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
  coalesce(p.paid_at, p.payment_month),
  NULL::date,
  p.received_amount,
  'TRY',
  NULL,
  NULL,
  'Trafo sorumluluğu · ' || c.subscriber_no || ' · '
    || to_char(p.payment_month, 'MM.YYYY')
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
  coalesce(m.service_date, m.created_at::date),
  m.due_date,
  round(m.agreed_amount * (1 + m.vat_rate), 2),
  'TRY',
  NULL,
  NULL,
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
  NULL,
  NULL,
  'Ölçüm · ' || m.service_type
FROM public.measurement_service_records m
WHERE m.customer_id IS NOT NULL
  AND m.collected_amount > 0;

REVOKE ALL ON public.customer_ledger_feed FROM PUBLIC, anon;
GRANT SELECT ON public.customer_ledger_feed TO authenticated;

COMMENT ON VIEW public.customer_ledger_feed IS
  'Cari hesap hareketleri: customer_ledger_entries + trafo aylık ödemeleri + ölçüm kayıtları (müşteriye bağlı olanlar). Salt okunur birleşim.';

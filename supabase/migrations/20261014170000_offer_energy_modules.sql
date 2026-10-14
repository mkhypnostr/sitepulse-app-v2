-- GES / EV Şarj / Taahhüt modüllü teklif hazırlayıcı.
--
-- 1) offer_catalog_items: teklif hazırlarken seçilen ürün ve hizmet kataloğu.
--    Alış fiyatı kendi para biriminde (TRY / USD / EUR) tutulur; teklife
--    eklenirken teklifin para birimine çevrilir.
-- 2) offers: modül ayarları (module_config), döviz kurları (exchange_rates)
--    ve ödeme planı (payment_plan) alanları; yeni 'enerji_paketi' türü.
-- 3) offer_line_items: kalemin hangi modüle ait olduğu, katalog bağlantısı
--    ve çevrim öncesi kaynak fiyat bilgisi.
--
-- Teklifler mevcut kurallarla yalnız yöneticiye (can_manage_finance) açıktır;
-- katalog da maliyet içerdiği için aynı kurala bağlanır.

CREATE TABLE IF NOT EXISTS public.offer_catalog_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (char_length(trim(code)) BETWEEN 1 AND 60),
  module text NOT NULL CHECK (module IN ('ges', 'sarj', 'taahhut', 'genel')),
  category text NOT NULL CHECK (char_length(trim(category)) BETWEEN 1 AND 60),
  -- Otomatik paket oluştururken kalemin rolü (ör. ges_panel, sarj_station).
  -- Serbest seçilen kalemlerde boştur.
  template_role text CHECK (template_role IS NULL OR char_length(trim(template_role)) BETWEEN 1 AND 60),
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 200),
  brand text,
  model text,
  description text,
  unit text NOT NULL DEFAULT 'adet' CHECK (char_length(trim(unit)) BETWEEN 1 AND 20),
  power_w numeric(12,2) CHECK (power_w IS NULL OR power_w > 0),
  power_kw numeric(12,3) CHECK (power_kw IS NULL OR power_kw > 0),
  capacity_kwh numeric(12,3) CHECK (capacity_kwh IS NULL OR capacity_kwh > 0),
  phase text CHECK (phase IS NULL OR phase IN ('mono', 'trifaze')),
  cost_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (cost_amount >= 0),
  currency char(3) NOT NULL DEFAULT 'TRY' CHECK (currency IN ('TRY', 'USD', 'EUR')),
  markup_rate numeric(6,4) NOT NULL DEFAULT 0.25 CHECK (markup_rate >= 0 AND markup_rate <= 5),
  line_category text NOT NULL DEFAULT 'malzeme'
    CHECK (line_category IN ('malzeme', 'iscilik', 'nakliye_sarf', 'diger')),
  source text,
  price_date date,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS offer_catalog_items_module_idx
  ON public.offer_catalog_items(module, category, sort_order);
CREATE INDEX IF NOT EXISTS offer_catalog_items_role_idx
  ON public.offer_catalog_items(template_role)
  WHERE template_role IS NOT NULL;

DROP TRIGGER IF EXISTS offer_catalog_items_touch_updated_at ON public.offer_catalog_items;
CREATE TRIGGER offer_catalog_items_touch_updated_at
BEFORE UPDATE ON public.offer_catalog_items
FOR EACH ROW EXECUTE FUNCTION public.touch_offer_updated_at();

ALTER TABLE public.offer_catalog_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "finance managers can view offer catalog" ON public.offer_catalog_items;
CREATE POLICY "finance managers can view offer catalog"
ON public.offer_catalog_items FOR SELECT TO authenticated
USING ((SELECT public.can_manage_finance(auth.uid())));

DROP POLICY IF EXISTS "finance managers can create offer catalog" ON public.offer_catalog_items;
CREATE POLICY "finance managers can create offer catalog"
ON public.offer_catalog_items FOR INSERT TO authenticated
WITH CHECK ((SELECT public.can_manage_finance(auth.uid())));

DROP POLICY IF EXISTS "finance managers can update offer catalog" ON public.offer_catalog_items;
CREATE POLICY "finance managers can update offer catalog"
ON public.offer_catalog_items FOR UPDATE TO authenticated
USING ((SELECT public.can_manage_finance(auth.uid())))
WITH CHECK ((SELECT public.can_manage_finance(auth.uid())));

DROP POLICY IF EXISTS "finance managers can delete offer catalog" ON public.offer_catalog_items;
CREATE POLICY "finance managers can delete offer catalog"
ON public.offer_catalog_items FOR DELETE TO authenticated
USING ((SELECT public.can_manage_finance(auth.uid())));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.offer_catalog_items TO authenticated;
REVOKE ALL ON public.offer_catalog_items FROM anon;

-- offers: modül, kur ve ödeme planı
ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS module_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS exchange_rates jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS payment_plan jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS terms_note text;

ALTER TABLE public.offers DROP CONSTRAINT IF EXISTS offers_module_config_object;
ALTER TABLE public.offers ADD CONSTRAINT offers_module_config_object
  CHECK (jsonb_typeof(module_config) = 'object');
ALTER TABLE public.offers DROP CONSTRAINT IF EXISTS offers_exchange_rates_object;
ALTER TABLE public.offers ADD CONSTRAINT offers_exchange_rates_object
  CHECK (jsonb_typeof(exchange_rates) = 'object');
ALTER TABLE public.offers DROP CONSTRAINT IF EXISTS offers_payment_plan_array;
ALTER TABLE public.offers ADD CONSTRAINT offers_payment_plan_array
  CHECK (jsonb_typeof(payment_plan) = 'array');

ALTER TABLE public.offers DROP CONSTRAINT IF EXISTS offers_offer_type_check;
ALTER TABLE public.offers ADD CONSTRAINT offers_offer_type_check
  CHECK (offer_type IN (
    'hizli_teklif',
    'siva_alti',
    'montaj',
    'tkf_proje_taahhut',
    'ek_is',
    'enerji_paketi',
    'diger'
  ));

ALTER TABLE public.offers DROP CONSTRAINT IF EXISTS offers_currency_check;
ALTER TABLE public.offers ADD CONSTRAINT offers_currency_check
  CHECK (currency IN ('TRY', 'USD', 'EUR'));

-- offer_line_items: modül ve kaynak fiyat izi
ALTER TABLE public.offer_line_items
  ADD COLUMN IF NOT EXISTS module text,
  ADD COLUMN IF NOT EXISTS catalog_item_id uuid
    REFERENCES public.offer_catalog_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_unit_cost numeric(14,2),
  ADD COLUMN IF NOT EXISTS source_currency char(3);

ALTER TABLE public.offer_line_items DROP CONSTRAINT IF EXISTS offer_line_items_module_check;
ALTER TABLE public.offer_line_items ADD CONSTRAINT offer_line_items_module_check
  CHECK (module IS NULL OR module IN ('ges', 'sarj', 'taahhut', 'genel'));
ALTER TABLE public.offer_line_items DROP CONSTRAINT IF EXISTS offer_line_items_source_currency_check;
ALTER TABLE public.offer_line_items ADD CONSTRAINT offer_line_items_source_currency_check
  CHECK (source_currency IS NULL OR source_currency IN ('TRY', 'USD', 'EUR'));

CREATE INDEX IF NOT EXISTS offer_line_items_catalog_item_idx
  ON public.offer_line_items(catalog_item_id)
  WHERE catalog_item_id IS NOT NULL;

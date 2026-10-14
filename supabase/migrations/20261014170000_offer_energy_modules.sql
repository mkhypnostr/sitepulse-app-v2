-- GES / EV Şarj / Taahhüt modüllü teklif hazırlayıcı.
--
-- 1) offer_catalog_items: teklif hazırlarken seçilen ürün ve hizmet kataloğu.
--    Alış fiyatı kendi para biriminde (TRY / USD / EUR) tutulur; teklife
--    eklenirken teklifin para birimine çevrilir.
-- 2) offers: modül ayarları (module_config), döviz kurları (exchange_rates),
--    ödeme planı (payment_plan) ve teklif şartları notu.
--    Enerji paketi teklifleri mevcut 'diger' türüyle ve
--    module_config->>'kind' = 'enerji_paketi' ile ayırt edilir; böylece
--    mevcut tür kısıtına dokunulmaz.
-- 3) offer_line_items: kalemin hangi modüle ait olduğu, katalog bağlantısı
--    ve çevrim öncesi kaynak fiyat bilgisi.
--
-- Migration yalnız ekleme yapar (DROP içermez) ve tekrar çalıştırılabilir.
-- Teklifler mevcut kurallarla yalnız yöneticiye (can_manage_finance) açıktır;
-- katalog da maliyet içerdiği için aynı kurala bağlanır.

CREATE TABLE IF NOT EXISTS public.offer_catalog_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (char_length(trim(code)) BETWEEN 1 AND 60),
  module text NOT NULL CHECK (module IN ('ges', 'sarj', 'taahhut', 'genel')),
  category text NOT NULL CHECK (char_length(trim(category)) BETWEEN 1 AND 60),
  -- Otomatik paket oluştururken kalemin rolü (ör. ges_panel, sarj_station).
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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'offer_catalog_items_touch_updated_at'
      AND tgrelid = 'public.offer_catalog_items'::regclass
  ) THEN
    CREATE TRIGGER offer_catalog_items_touch_updated_at
    BEFORE UPDATE ON public.offer_catalog_items
    FOR EACH ROW EXECUTE FUNCTION public.touch_offer_updated_at();
  END IF;
END $$;

ALTER TABLE public.offer_catalog_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'offer_catalog_items' AND policyname = 'finance managers can view offer catalog') THEN
    CREATE POLICY "finance managers can view offer catalog"
    ON public.offer_catalog_items FOR SELECT TO authenticated
    USING ((SELECT public.can_manage_finance(auth.uid())));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'offer_catalog_items' AND policyname = 'finance managers can create offer catalog') THEN
    CREATE POLICY "finance managers can create offer catalog"
    ON public.offer_catalog_items FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.can_manage_finance(auth.uid())));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'offer_catalog_items' AND policyname = 'finance managers can update offer catalog') THEN
    CREATE POLICY "finance managers can update offer catalog"
    ON public.offer_catalog_items FOR UPDATE TO authenticated
    USING ((SELECT public.can_manage_finance(auth.uid())))
    WITH CHECK ((SELECT public.can_manage_finance(auth.uid())));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'offer_catalog_items' AND policyname = 'finance managers can delete offer catalog') THEN
    CREATE POLICY "finance managers can delete offer catalog"
    ON public.offer_catalog_items FOR DELETE TO authenticated
    USING ((SELECT public.can_manage_finance(auth.uid())));
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.offer_catalog_items TO authenticated;
REVOKE ALL ON public.offer_catalog_items FROM anon;

-- offers: modül, kur, ödeme planı ve şartlar
ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS module_config jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(module_config) = 'object'),
  ADD COLUMN IF NOT EXISTS exchange_rates jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(exchange_rates) = 'object'),
  ADD COLUMN IF NOT EXISTS payment_plan jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(payment_plan) = 'array'),
  ADD COLUMN IF NOT EXISTS terms_note text;

-- offer_line_items: modül ve kaynak fiyat izi
ALTER TABLE public.offer_line_items
  ADD COLUMN IF NOT EXISTS module text
    CHECK (module IS NULL OR module IN ('ges', 'sarj', 'taahhut', 'genel')),
  ADD COLUMN IF NOT EXISTS catalog_item_id uuid
    REFERENCES public.offer_catalog_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_unit_cost numeric(14,2),
  ADD COLUMN IF NOT EXISTS source_currency char(3)
    CHECK (source_currency IS NULL OR source_currency IN ('TRY', 'USD', 'EUR'));

CREATE INDEX IF NOT EXISTS offer_line_items_catalog_item_idx
  ON public.offer_line_items(catalog_item_id)
  WHERE catalog_item_id IS NOT NULL;

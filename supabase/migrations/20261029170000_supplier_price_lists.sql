-- Tedarikçi fiyat listeleri (ilk tedarikçi: Zeybek Elektrik).
--
-- zeybek-price-sync Edge Function'ı üreticinin yayınladığı PDF fiyat listesini
-- günde bir kez kontrol eder; yeni liste çıktıysa kalemleri
-- supplier_price_items'a yazar ve apply_supplier_prices() ile kataloğa bağlı
-- kalemlerin alış fiyatını (liste fiyatı − bayi iskontosu, KDV hariç)
-- günceller. Alış fiyatı finansal veridir: yalnız finans yetkisi olanlar
-- (yönetici) görür. Tekrar çalıştırılabilir; mevcut veriyi silmez.

CREATE TABLE IF NOT EXISTS public.supplier_settings (
  supplier text PRIMARY KEY CHECK (supplier ~ '^[a-z0-9_]{2,30}$'),
  display_name text NOT NULL,
  discount_rate numeric(6,4) NOT NULL DEFAULT 0
    CHECK (discount_rate >= 0 AND discount_rate < 1),
  last_checked_at timestamptz,
  last_check_status text CHECK (last_check_status IN ('ok', 'error', 'unchanged')),
  last_check_message text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.supplier_settings (supplier, display_name)
VALUES ('zeybek', 'Zeybek Elektrik')
ON CONFLICT (supplier) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.supplier_price_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier text NOT NULL REFERENCES public.supplier_settings(supplier),
  list_name text NOT NULL,
  source_url text NOT NULL,
  published_at timestamptz,
  item_count integer NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('ok', 'error')),
  error text,
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (supplier, source_url)
);

CREATE TABLE IF NOT EXISTS public.supplier_price_items (
  supplier text NOT NULL REFERENCES public.supplier_settings(supplier),
  code text NOT NULL CHECK (char_length(code) BETWEEN 1 AND 60),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  section text,
  list_price numeric(14,3) NOT NULL CHECK (list_price >= 0),
  currency character(3) NOT NULL CHECK (currency IN ('TRY', 'USD', 'EUR')),
  page integer,
  list_id uuid REFERENCES public.supplier_price_lists(id) ON DELETE SET NULL,
  is_current boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (supplier, code)
);

CREATE INDEX IF NOT EXISTS supplier_price_items_search_idx
  ON public.supplier_price_items (supplier, is_current, section);

-- Katalog kalemi ile tedarikçi ürünü arasındaki bağ: 'zeybek:ZB.TK.20/6_CD'.
ALTER TABLE public.offer_catalog_items
  ADD COLUMN IF NOT EXISTS supplier_ref text
    CHECK (supplier_ref IS NULL OR supplier_ref ~ '^[a-z0-9_]{2,30}:.{1,60}$');
CREATE UNIQUE INDEX IF NOT EXISTS offer_catalog_items_supplier_ref_key
  ON public.offer_catalog_items (supplier_ref)
  WHERE supplier_ref IS NOT NULL;

ALTER TABLE public.supplier_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_price_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_price_items ENABLE ROW LEVEL SECURITY;

-- Okuma yalnız finans yetkisiyle. Yazma yalnız sunucu (service role) ve
-- aşağıdaki SECURITY DEFINER fonksiyonlarıyla.
DROP POLICY IF EXISTS "finance managers view supplier settings" ON public.supplier_settings;
CREATE POLICY "finance managers view supplier settings"
  ON public.supplier_settings FOR SELECT TO authenticated
  USING ((SELECT public.can_manage_finance(auth.uid())));

DROP POLICY IF EXISTS "finance managers view supplier price lists" ON public.supplier_price_lists;
CREATE POLICY "finance managers view supplier price lists"
  ON public.supplier_price_lists FOR SELECT TO authenticated
  USING ((SELECT public.can_manage_finance(auth.uid())));

DROP POLICY IF EXISTS "finance managers view supplier price items" ON public.supplier_price_items;
CREATE POLICY "finance managers view supplier price items"
  ON public.supplier_price_items FOR SELECT TO authenticated
  USING ((SELECT public.can_manage_finance(auth.uid())));

REVOKE ALL ON public.supplier_settings, public.supplier_price_lists,
  public.supplier_price_items FROM anon;
GRANT SELECT ON public.supplier_settings, public.supplier_price_lists,
  public.supplier_price_items TO authenticated;

-- Kataloğa bağlı kalemlerin alış fiyatını güncel listeden yeniler.
-- Değişen kalem sayısını döndürür.
CREATE OR REPLACE FUNCTION public.apply_supplier_prices(p_supplier text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  changed integer;
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     AND coalesce(current_setting('role', true), '') <> 'service_role'
     AND NOT coalesce(public.can_manage_finance(auth.uid()), false) THEN
    RAISE EXCEPTION 'Bu işlem yalnız yöneticiye açık.' USING ERRCODE = '42501';
  END IF;

  WITH src AS (
    SELECT
      i.supplier || ':' || i.code AS ref,
      round(i.list_price * (1 - s.discount_rate), 2) AS cost,
      i.currency,
      format(
        '%s %s liste fiyatı%s (KDV hariç), otomatik',
        s.display_name,
        coalesce(l.list_name, ''),
        CASE WHEN s.discount_rate > 0
          THEN ' − %' || rtrim(rtrim(to_char(s.discount_rate * 100, 'FM990.00'), '0'), '.') || ' iskonto'
          ELSE '' END
      ) AS source,
      coalesce(l.published_at::date, current_date) AS price_date
    FROM public.supplier_price_items i
    JOIN public.supplier_settings s ON s.supplier = i.supplier
    LEFT JOIN public.supplier_price_lists l ON l.id = i.list_id
    WHERE i.supplier = p_supplier AND i.is_current
  )
  UPDATE public.offer_catalog_items c
  SET cost_amount = src.cost,
      currency = src.currency,
      source = src.source,
      price_date = src.price_date,
      updated_at = now()
  FROM src
  WHERE c.supplier_ref = src.ref
    AND (c.cost_amount IS DISTINCT FROM src.cost
      OR c.currency IS DISTINCT FROM src.currency
      OR c.source IS DISTINCT FROM src.source
      OR c.price_date IS DISTINCT FROM src.price_date);
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_supplier_prices(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_supplier_prices(text) TO authenticated, service_role;

-- Bayi iskontosunu değiştirir ve kataloğa bağlı fiyatları yeniler.
CREATE OR REPLACE FUNCTION public.set_supplier_discount(
  p_supplier text,
  p_discount_rate numeric
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.can_manage_finance(auth.uid()) THEN
    RAISE EXCEPTION 'Bu işlem yalnız yöneticiye açık.' USING ERRCODE = '42501';
  END IF;
  IF p_discount_rate IS NULL OR p_discount_rate < 0 OR p_discount_rate >= 1 THEN
    RAISE EXCEPTION 'İskonto %%0 ile %%99 arasında olmalı.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.supplier_settings
  SET discount_rate = round(p_discount_rate, 4), updated_at = now()
  WHERE supplier = p_supplier;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tedarikçi bulunamadı.' USING ERRCODE = 'P0002';
  END IF;
  RETURN public.apply_supplier_prices(p_supplier);
END;
$$;

REVOKE ALL ON FUNCTION public.set_supplier_discount(text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_supplier_discount(text, numeric) TO authenticated;

-- Tedarikçi listesindeki bir ürünü fiyat kütüphanesine ekler (varsa mevcut
-- kalemi döndürür). Fiyat bundan sonra liste değiştikçe kendiliğinden yenilenir.
CREATE OR REPLACE FUNCTION public.add_supplier_item_to_catalog(
  p_supplier text,
  p_code text,
  p_unit text DEFAULT 'adet'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  item public.supplier_price_items%ROWTYPE;
  settings public.supplier_settings%ROWTYPE;
  existing uuid;
  new_id uuid;
  catalog_code text;
BEGIN
  IF NOT public.can_manage_finance(auth.uid()) THEN
    RAISE EXCEPTION 'Bu işlem yalnız yöneticiye açık.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO item FROM public.supplier_price_items
  WHERE supplier = p_supplier AND code = p_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ürün listede bulunamadı.' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO settings FROM public.supplier_settings WHERE supplier = p_supplier;

  SELECT id INTO existing FROM public.offer_catalog_items
  WHERE supplier_ref = p_supplier || ':' || p_code;
  IF existing IS NOT NULL THEN
    UPDATE public.offer_catalog_items SET is_active = true WHERE id = existing;
    PERFORM public.apply_supplier_prices(p_supplier);
    RETURN existing;
  END IF;

  catalog_code := left(p_code, 60);
  IF EXISTS (SELECT 1 FROM public.offer_catalog_items WHERE code = catalog_code) THEN
    catalog_code := left(upper(p_supplier) || '-' || p_code, 60);
  END IF;

  INSERT INTO public.offer_catalog_items (
    code, module, category, name, brand, model, unit, cost_amount, currency,
    markup_rate, line_category, source, price_date, is_active, sort_order,
    supplier_ref
  ) VALUES (
    catalog_code,
    'taahhut',
    left(upper(settings.display_name), 60),
    item.name,
    settings.display_name,
    item.code,
    coalesce(nullif(trim(p_unit), ''), 'adet'),
    0,
    item.currency,
    0.25,
    'malzeme',
    settings.display_name || ' fiyat listesi',
    current_date,
    true,
    9000,
    p_supplier || ':' || p_code
  )
  RETURNING id INTO new_id;

  PERFORM public.apply_supplier_prices(p_supplier);
  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.add_supplier_item_to_catalog(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_supplier_item_to_catalog(text, text, text) TO authenticated;

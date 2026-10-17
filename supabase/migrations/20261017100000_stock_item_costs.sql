-- Stok birim fiyatı (maliyet) yalnız yöneticiye.
--
-- Sorun: stock_items.unit_price sütunu taşeron (stock_contractor_read) ve
-- teknik ofis tarafından okunabiliyordu; maliyet bilgisi yalnız yöneticiye
-- açık olmalı. RLS satır bazlıdır, sütun gizleyemez; bu yüzden fiyat ayrı,
-- yalnız yöneticinin okuyup yazabildiği stock_item_costs tablosuna taşınır.
--
-- 1) stock_item_costs (stock_item_id, unit_price) — RLS: can_manage_finance.
-- 2) Mevcut fiyatlar kopyalanır, sonra stock_items.unit_price 0'lanır
--    (sütun silinmez; eski istemciler bozulmasın diye kalır).
-- 3) Geriye uyumluluk: stock_items'a fiyatla yazılırsa (eski ekran / Excel
--    içe aktarma) değer yöneticiyse maliyet tablosuna taşınır, sütun yine 0
--    kalır. Yönetici olmayanın girdiği fiyat yok sayılır.
--
-- Veri kaybı yok: kopyalama ve sıfırlama aynı işlemde; tekrar
-- çalıştırılabilir; DROP içermez.

CREATE TABLE IF NOT EXISTS public.stock_item_costs (
  stock_item_id uuid PRIMARY KEY REFERENCES public.stock_items(id) ON DELETE CASCADE,
  unit_price numeric NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.stock_item_costs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'stock_item_costs'
      AND policyname = 'stock_item_costs_finance_all'
  ) THEN
    CREATE POLICY stock_item_costs_finance_all ON public.stock_item_costs
      FOR ALL TO authenticated
      USING (public.can_manage_finance((SELECT auth.uid())))
      WITH CHECK (public.can_manage_finance((SELECT auth.uid())));
  END IF;
END $$;

REVOKE ALL ON public.stock_item_costs FROM anon;

-- Mevcut fiyatları kopyala (daha önce kopyalanmışsa güncelle).
INSERT INTO public.stock_item_costs (stock_item_id, unit_price, updated_by)
SELECT id, unit_price, NULL
FROM public.stock_items
WHERE unit_price IS NOT NULL AND unit_price > 0
ON CONFLICT (stock_item_id) DO UPDATE
  SET unit_price = EXCLUDED.unit_price, updated_at = now();

-- stock_items'a yazılan fiyatı maliyet tablosuna taşı.
CREATE OR REPLACE FUNCTION public.stock_items_move_price()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.unit_price IS NULL OR NEW.unit_price = 0 THEN
    RETURN NULL;
  END IF;
  IF auth.uid() IS NULL OR public.can_manage_finance(auth.uid()) THEN
    INSERT INTO public.stock_item_costs (stock_item_id, unit_price)
    VALUES (NEW.id, NEW.unit_price)
    ON CONFLICT (stock_item_id) DO UPDATE
      SET unit_price = EXCLUDED.unit_price, updated_at = now(), updated_by = auth.uid();
  END IF;
  UPDATE public.stock_items SET unit_price = 0 WHERE id = NEW.id;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.stock_items_move_price() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'stock_items_move_price'
      AND tgrelid = 'public.stock_items'::regclass
  ) THEN
    CREATE TRIGGER stock_items_move_price
    AFTER INSERT OR UPDATE OF unit_price ON public.stock_items
    FOR EACH ROW EXECUTE FUNCTION public.stock_items_move_price();
  END IF;
END $$;

-- Kopyalanan fiyatları stok tablosundan kaldır.
UPDATE public.stock_items SET unit_price = 0 WHERE unit_price <> 0;

-- Ayrıca: get_my_app_role giriş yapılmadan (anon) çağrılabiliyordu; uygulama
-- yalnız oturum açıkken çağırıyor.
REVOKE EXECUTE ON FUNCTION public.get_my_app_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_app_role() TO authenticated;

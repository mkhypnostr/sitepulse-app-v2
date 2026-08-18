-- Teklif kalemleri ve şablon türleri.
-- offers.offer_type'a "Hızlı Teklif" seçeneği eklenir; yeni offer_line_items
-- tablosu her teklife maliyet/satış kalemleri ekler. Mevcut offers kayıtları
-- (kalemi olmayanlar dahil) hiçbir şekilde değiştirilmez; total_amount yalnız
-- bir teklifin kalemi olduğunda otomatik senkronlanmaya başlar.

ALTER TABLE public.offers
  DROP CONSTRAINT IF EXISTS offers_offer_type_check;

ALTER TABLE public.offers
  ADD CONSTRAINT offers_offer_type_check
  CHECK (offer_type IN ('hizli_teklif', 'siva_alti', 'montaj', 'diger'));

CREATE TABLE public.offer_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL REFERENCES public.offers(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  category text NOT NULL DEFAULT 'malzeme'
    CHECK (category IN ('malzeme', 'iscilik', 'nakliye_sarf', 'diger')),
  description text NOT NULL CHECK (char_length(trim(description)) BETWEEN 1 AND 500),
  brand text,
  unit text NOT NULL DEFAULT 'adet' CHECK (char_length(trim(unit)) BETWEEN 1 AND 20),
  quantity numeric(14,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_cost numeric(14,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  labor_cost numeric(14,2) NOT NULL DEFAULT 0 CHECK (labor_cost >= 0),
  subcontractor_cost numeric(14,2) NOT NULL DEFAULT 0 CHECK (subcontractor_cost >= 0),
  logistics_cost numeric(14,2) NOT NULL DEFAULT 0 CHECK (logistics_cost >= 0),
  risk_cost numeric(14,2) NOT NULL DEFAULT 0 CHECK (risk_cost >= 0),
  markup_rate numeric(6,4) NOT NULL DEFAULT 0 CHECK (markup_rate >= 0),
  manual_sale_amount numeric(14,2) CHECK (manual_sale_amount IS NULL OR manual_sale_amount >= 0),
  visible_to_customer boolean NOT NULL DEFAULT true,
  -- Aşağıdaki dört alan yalnız compute_offer_line_item_costs() tetikleyicisi
  -- tarafından yazılır; istemci bu alanlara ne gönderirse göndersin üzerine
  -- yazılır. Hesap kuralı burada tek bir yerde uygulanır.
  material_cost numeric(14,2) NOT NULL DEFAULT 0,
  total_cost numeric(14,2) NOT NULL DEFAULT 0,
  computed_sale_amount numeric(14,2) NOT NULL DEFAULT 0,
  applied_sale_amount numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX offer_line_items_offer_id_idx
  ON public.offer_line_items(offer_id, sort_order);

CREATE OR REPLACE FUNCTION public.compute_offer_line_item_costs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.material_cost := NEW.quantity * NEW.unit_cost;
  NEW.total_cost := NEW.material_cost
    + NEW.labor_cost
    + NEW.subcontractor_cost
    + NEW.logistics_cost
    + NEW.risk_cost;
  NEW.computed_sale_amount := NEW.total_cost * (1 + NEW.markup_rate);
  NEW.applied_sale_amount := COALESCE(NEW.manual_sale_amount, NEW.computed_sale_amount);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER offer_line_items_compute_costs
BEFORE INSERT OR UPDATE ON public.offer_line_items
FOR EACH ROW EXECUTE FUNCTION public.compute_offer_line_item_costs();

-- offers.total_amount, yalnızca müşteride gösterilen kalemlerin uygulanan
-- satış toplamıyla senkron tutulur. SECURITY DEFINER: çağıran kullanıcının
-- offers UPDATE politikası kalem işlemi sırasında ayrıca sağlanmasına gerek
-- kalmadan üst kaydı güvenle güncelleyebilmesi için (assign_offer_no ile aynı desen).
CREATE OR REPLACE FUNCTION public.sync_offer_total_amount()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_offer_id uuid := COALESCE(NEW.offer_id, OLD.offer_id);
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.offer_id IS DISTINCT FROM NEW.offer_id THEN
    UPDATE public.offers
    SET total_amount = COALESCE(
      (SELECT SUM(applied_sale_amount) FROM public.offer_line_items
        WHERE offer_id = OLD.offer_id AND visible_to_customer),
      0)
    WHERE id = OLD.offer_id;
  END IF;

  UPDATE public.offers
  SET total_amount = COALESCE(
    (SELECT SUM(applied_sale_amount) FROM public.offer_line_items
      WHERE offer_id = target_offer_id AND visible_to_customer),
    0)
  WHERE id = target_offer_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.sync_offer_total_amount() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER offer_line_items_sync_offer_total
AFTER INSERT OR UPDATE OR DELETE ON public.offer_line_items
FOR EACH ROW EXECUTE FUNCTION public.sync_offer_total_amount();

ALTER TABLE public.offer_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "finance managers can view offer line items"
ON public.offer_line_items FOR SELECT TO authenticated
USING ((SELECT public.can_manage_finance(auth.uid())));

CREATE POLICY "finance managers can create offer line items"
ON public.offer_line_items FOR INSERT TO authenticated
WITH CHECK ((SELECT public.can_manage_finance(auth.uid())));

CREATE POLICY "finance managers can update offer line items"
ON public.offer_line_items FOR UPDATE TO authenticated
USING ((SELECT public.can_manage_finance(auth.uid())))
WITH CHECK ((SELECT public.can_manage_finance(auth.uid())));

CREATE POLICY "finance managers can delete offer line items"
ON public.offer_line_items FOR DELETE TO authenticated
USING ((SELECT public.can_manage_finance(auth.uid())));

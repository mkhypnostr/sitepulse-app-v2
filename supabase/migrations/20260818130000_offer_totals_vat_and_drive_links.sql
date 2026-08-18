-- Teklif nihai toplamı için hesapla/elle-gir seçimi, teklif bazlı KDV oranı
-- ve mevcut Drive bağlantılarını kaydetme desteği.
-- Bu migration public.offers.offer_type / offers_offer_type_check'e
-- dokunmaz; 20260818120000_offer_line_items.sql ile tanımlanan
-- ('hizli_teklif','siva_alti','montaj','diger') kısıtıyla çakışmaz.

ALTER TABLE public.offers
  ADD COLUMN total_amount_mode text NOT NULL DEFAULT 'computed'
    CHECK (total_amount_mode IN ('computed', 'manual')),
  ADD COLUMN vat_rate numeric(5,4) NOT NULL DEFAULT 0.20
    CHECK (vat_rate >= 0 AND vat_rate <= 1),
  ADD COLUMN drive_excel_url text
    CHECK (drive_excel_url IS NULL OR drive_excel_url ~* '^https?://'),
  ADD COLUMN drive_folder_url text
    CHECK (drive_folder_url IS NULL OR drive_folder_url ~* '^https?://');

-- Bu migration çalışmadan önce var olan tüm teklifler kalemsiz ve elle
-- girilmiş tutarlarla oluşturulmuştu. Sütun eklendiği anda hepsi DEFAULT
-- 'computed' alır; burada onları açıkça 'manual'a çeviriyoruz ki daha sonra
-- kalem eklenirse sync_offer_total_amount() tetikleyicisi mevcut
-- total_amount değerlerini asla ezmesin. total_amount'ın kendisine
-- dokunulmuyor. Bu migration'dan SONRA oluşturulan teklifler sütunun
-- DEFAULT 'computed' değerini normal şekilde alır.
UPDATE public.offers SET total_amount_mode = 'manual';

CREATE OR REPLACE FUNCTION public.sync_offer_total_amount()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_offer_id uuid := COALESCE(NEW.offer_id, OLD.offer_id);
  target_mode text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.offer_id IS DISTINCT FROM NEW.offer_id THEN
    SELECT total_amount_mode INTO target_mode
    FROM public.offers WHERE id = OLD.offer_id;

    IF target_mode IS DISTINCT FROM 'manual' THEN
      UPDATE public.offers
      SET total_amount = COALESCE(
        (SELECT SUM(applied_sale_amount) FROM public.offer_line_items
          WHERE offer_id = OLD.offer_id AND visible_to_customer),
        0)
      WHERE id = OLD.offer_id;
    END IF;
  END IF;

  SELECT total_amount_mode INTO target_mode
  FROM public.offers WHERE id = target_offer_id;

  -- Elle mod seçilmişse kalem değişiklikleri total_amount'ı ezmez; kullanıcının
  -- girdiği nihai teklif bedeli olduğu gibi kalır.
  IF target_mode IS DISTINCT FROM 'manual' THEN
    UPDATE public.offers
    SET total_amount = COALESCE(
      (SELECT SUM(applied_sale_amount) FROM public.offer_line_items
        WHERE offer_id = target_offer_id AND visible_to_customer),
      0)
    WHERE id = target_offer_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.sync_offer_total_amount() FROM PUBLIC, anon, authenticated;

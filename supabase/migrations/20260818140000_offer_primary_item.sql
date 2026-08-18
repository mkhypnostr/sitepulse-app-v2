-- Excel-first teklif akışı: ilk sürüm ekranı yalnız bir "ana kalem" (kısa
-- kapsam açıklaması, miktar, birim) tutar; gerçek fiyatlandırma Drive'daki
-- Excel şablonunda yapılır. Mevcut offer_line_items / total_amount /
-- vat_rate / total_amount_mode / drive_excel_url / drive_folder_url
-- sütunlarına dokunulmaz — yalnız bu ekranda gösterilmezler.
-- offers.customer_id bu migration'dan önce de opsiyoneldi (NOT NULL yok);
-- burada ayrıca değiştirilmedi.

ALTER TABLE public.offers
  ADD COLUMN primary_item_description text
    CHECK (
      primary_item_description IS NULL
      OR char_length(trim(primary_item_description)) BETWEEN 1 AND 500
    ),
  ADD COLUMN primary_item_quantity numeric(14,3) NOT NULL DEFAULT 1
    CHECK (primary_item_quantity > 0),
  ADD COLUMN primary_item_unit text NOT NULL DEFAULT 'adet'
    CHECK (char_length(trim(primary_item_unit)) BETWEEN 1 AND 20);

-- Beş açık teklif türünü desteklemek için offers.offer_type kısıtına iki yeni
-- değer eklenir: 'tkf_proje_taahhut' ve 'ek_is'. Eski 'diger' değeri
-- geriye dönük uyumluluk için veritabanında kalır (bu migration onu
-- kaldırmaz); yalnız uygulama tarafında yeni teklif oluşturma ekranından
-- seçenek olarak kaldırılmıştır. Bu migration yalnız CHECK kısıtını
-- günceller — başka hiçbir sütun/tablo/politika değişmez.

ALTER TABLE public.offers
  DROP CONSTRAINT IF EXISTS offers_offer_type_check;

ALTER TABLE public.offers
  ADD CONSTRAINT offers_offer_type_check
  CHECK (offer_type IN (
    'hizli_teklif',
    'siva_alti',
    'montaj',
    'tkf_proje_taahhut',
    'ek_is',
    'diger'
  ));

-- Satış fırsatlarının harita konumu (Müşteri haritası için).
-- Konum metninden adres aramasıyla ya da elle doldurulur.
-- Yalnız ekleme yapar ve tekrar çalıştırılabilir.

ALTER TABLE public.sales_leads
  ADD COLUMN IF NOT EXISTS latitude double precision
    CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  ADD COLUMN IF NOT EXISTS longitude double precision
    CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);

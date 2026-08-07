-- Stok kartlarına birim fiyat eklenir; toplam stok değeri (miktar x birim
-- fiyat) ve hakediş raporundaki malzeme tutarları bu kolon üzerinden hesaplanır.
ALTER TABLE public.stock_items
  ADD COLUMN IF NOT EXISTS unit_price NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0);

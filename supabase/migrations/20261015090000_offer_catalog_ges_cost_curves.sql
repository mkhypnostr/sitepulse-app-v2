-- GES işçiliği, nakliye ve GES panosunu NES maliyet tablolarındaki kWp kademeli
-- götürü bedellere göre düzenler (DG Otomotiv R2 9/15/22,5 kWp, B. Kolkesen
-- 9,9 kWp, Cihan İnşaat 12 kWp). Tekrar çalıştırılabilir.
-- GES işçiliği, nakliye ve GES panosu kWp kademeli götürü bedeldir; katsayı
-- uygulamada hesaplanır, buradaki tutar 22,5 kWp referans bedelidir.
UPDATE public.offer_catalog_items
SET unit = 'set', cost_amount = 2000,
    description = 'Pik Solar montaj işçiliği — kWp kademeli götürü (9 kWp 1.000, 12 kWp 1.100, 15 kWp 1.350, 22,5 kWp 2.000 USD)'
WHERE code = 'GES-LBR-INSTALL';
UPDATE public.offer_catalog_items
SET cost_amount = 500,
    description = 'Ambar, kargo, forklift, vinç — kWp kademeli (9 kWp 400, 15 kWp 450, 22,5 kWp 500 USD)'
WHERE code = 'GES-TRANSPORT';
UPDATE public.offer_catalog_items
SET cost_amount = 500,
    description = 'TEDAŞ şartnamelerine uyumlu GES ACP — kWp kademeli (9 kWp 400, 15 kWp 450, 22,5 kWp 500 USD)'
WHERE code = 'GES-ACP';
UPDATE public.offer_catalog_items
SET description = 'Sistem başına tek set (DG 175, Cihan 200 USD)'
WHERE code = 'GES-LBR-BATTERY';

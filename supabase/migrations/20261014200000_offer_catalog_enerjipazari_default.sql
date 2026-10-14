-- GES ana ekipmanında (panel, inverter, batarya) enerjipazari.com.tr fiyatları esas
-- alınır. Drive maliyet tablolarındaki eşdeğer kalemler silinmez, pasife alınır;
-- gerekirse is_active = true yapılarak geri getirilebilir.
UPDATE public.offer_catalog_items SET is_active = false
WHERE code IN (
  'GES-PNL-JINKO-625', 'GES-PNL-VIESSMANN-550',
  'GES-INV-DEYE-20', 'GES-INV-DEYE-12', 'GES-INV-FRONIUS-12', 'GES-INV-GROWATT-12',
  'GES-BAT-BYD-LV5'
);

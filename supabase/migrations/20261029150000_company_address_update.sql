-- NES yeni adres (29.10.2026): firma bilgileri ve e-Fatura satıcı adresi.
-- Yalnız eski adres hâlâ duruyorsa günceller; Ön Muhasebe → Firma ekranından
-- elle değiştirilmiş bir adresin üzerine yazmaz. Tekrar çalıştırılabilir.

UPDATE public.company_profile
SET address = 'MUSLİHİTTİN MAHALLESİ MEHMET POLATOĞLU CADDESİ DEMET APARTMANI NO:10 KAT:2 DAİRE:3',
    updated_at = now()
WHERE id = 1
  AND address = 'ORHANİYE MAHALLESİ 12 NOLU SOKAK NUR APARTMANI NO:6 C';

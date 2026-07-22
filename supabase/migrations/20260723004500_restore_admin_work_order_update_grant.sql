-- Önceki canlı migration'da tablo seviyesi UPDATE yetkisi kaldırılmıştı.
-- Admin RLS politikası çalışabilsin; taşeron güncelleme politikası olmadığı için atlama oluşmaz.
GRANT UPDATE ON public.work_orders TO authenticated;

-- İş Emri Yaşam Döngüsü standardı — şema temeli.
-- 'draft' değeri ayrı bir migration'da eklenir çünkü Postgres, ADD VALUE ile
-- eklenen bir enum etiketini aynı transaction içinde kullanmaya izin vermez.

ALTER TYPE public.work_status ADD VALUE IF NOT EXISTS 'draft' BEFORE 'planned';

-- Taslak (draft) iş emirlerinin planlanan tarihi olmayabilir; bu yüzden
-- scheduled_at artık zorunlu değil. Zorunluluk kontrolü RPC'lerde yapılır
-- (aktif/atandı statüsüne geçiş için).
ALTER TABLE public.work_orders
  ALTER COLUMN scheduled_at DROP NOT NULL;

-- Planlanan bitiş tarih-saati: önceden yalnızca tek bir scheduled_at
-- (başlangıç) vardı, ayrı bir bitiş alanı yoktu.
ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS planned_end_at TIMESTAMPTZ;

-- Şifremi unuttum: istek kaydı (kötüye kullanım sınırı için).
--
-- nes-password-recovery fonksiyonu her şifre yenileme isteğini buraya yazar
-- ve aynı hesap / aynı ağ adresi için kısa sürede tekrar e-posta gönderilmesini
-- engeller. Tabloya yalnız sunucu (service role) erişir; RLS açık, politika
-- yoktur. IP adresi açık tutulmaz, yalnız özeti (hash) saklanır.
--
-- Yalnız ekleme yapar (DROP içermez) ve tekrar çalıştırılabilir.

CREATE TABLE IF NOT EXISTS public.password_recovery_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  ip_hash text NOT NULL CHECK (char_length(ip_hash) <= 128),
  sent boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS password_recovery_requests_user_idx
  ON public.password_recovery_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS password_recovery_requests_ip_idx
  ON public.password_recovery_requests (ip_hash, created_at DESC);

ALTER TABLE public.password_recovery_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.password_recovery_requests FROM PUBLIC, anon, authenticated;

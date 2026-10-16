-- send-push için VAPID özel anahtarını Vault'tan okuma.
-- Anahtarın kendisi bu dosyada YOK; Vault'a ('push_vapid_private_key')
-- yayın sırasında ayrıca yazılır. Fonksiyon yalnız service_role ile
-- çağrılabilir (edge function), kullanıcılar ve anon çağıramaz.
-- Tekrar çalıştırılabilir; DROP içermez.

CREATE OR REPLACE FUNCTION public.get_push_vapid_private_key()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT decrypted_secret
  FROM vault.decrypted_secrets
  WHERE name = 'push_vapid_private_key'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_push_vapid_private_key() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_push_vapid_private_key() TO service_role;

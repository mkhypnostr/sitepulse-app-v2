-- Zeybek Elektrik fiyat listesinin günlük otomatik kontrolü.
-- 20261029170000_supplier_price_lists.sql'e bağlıdır. Tekrar çalıştırılabilir.

-- Günlük kontrol: Edge Function'ı paylaşılan anahtarla çağırır (bildirim
-- e-postalarıyla aynı Vault anahtarı). Liste değişmediyse fonksiyon hiçbir
-- şey yazmaz.
CREATE OR REPLACE FUNCTION public.request_supplier_price_sync()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  webhook_secret text;
BEGIN
  SELECT decrypted_secret INTO webhook_secret
  FROM vault.decrypted_secrets
  WHERE name = 'notification_webhook_secret'
  LIMIT 1;
  IF webhook_secret IS NULL THEN
    RAISE WARNING 'notification_webhook_secret bulunamadı; fiyat listesi kontrol edilemedi';
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := 'https://nyfocdnlbknxpxbeeapj.supabase.co/functions/v1/zeybek-price-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', webhook_secret
    ),
    body := jsonb_build_object('mode', 'check'),
    timeout_milliseconds := 150000
  );
END;
$$;

REVOKE ALL ON FUNCTION public.request_supplier_price_sync() FROM PUBLIC, anon, authenticated;

-- Her gün 04:37 UTC (07:37 Türkiye).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'supplier-price-sync') THEN
    PERFORM cron.unschedule('supplier-price-sync');
  END IF;
  PERFORM cron.schedule(
    'supplier-price-sync',
    '37 4 * * *',
    'SELECT public.request_supplier_price_sync();'
  );
END;
$$;

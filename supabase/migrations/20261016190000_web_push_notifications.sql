-- Telefona anlık bildirim (web push) — mağazasız.
--
-- Uygulama telefona/bilgisayara kurulup "Bildirimleri aç" denince tarayıcının
-- verdiği abonelik (endpoint + anahtarlar) push_subscriptions'a kaydedilir.
-- Mevcut e-posta bildirimleri send_notification_email() üzerinden geçtiği
-- için aynı olaylar (görev/iş emri ataması, gecikme, onay bekleyen kayıt,
-- onay kararı, otomatik görevler) bu fonksiyondan ayrıca send-push edge
-- function'ına da iletilir. E-posta davranışı değişmez.
--
-- Ayrıca: eski Twilio WhatsApp tetikleyicileri kapatılır. Twilio deneme
-- hattı kayıtlı olmayan numaralara mesaj ulaştırmıyordu; Meta hattı onaylanana
-- kadar bildirimler e-posta ve telefon bildirimiyle gider. Tetikleyiciler
-- silinmez, yalnız devre dışı bırakılır (ENABLE TRIGGER ile geri açılabilir).
--
-- Yalnız ekleme / değiştirme yapar (DROP içermez) ve tekrar çalıştırılabilir.

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE CHECK (endpoint ~ '^https://'),
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text CHECK (user_agent IS NULL OR char_length(user_agent) <= 400),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  failure_count integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx
  ON public.push_subscriptions (user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'push_subscriptions'
      AND policyname = 'push_subscriptions_own_select'
  ) THEN
    CREATE POLICY push_subscriptions_own_select ON public.push_subscriptions
      FOR SELECT TO authenticated USING (user_id = auth.uid());
  END IF;
END $$;

-- Kayıt ve silme yalnız aşağıdaki fonksiyonlarla (aynı cihaz başka hesapla
-- kullanılırsa abonelik yeni hesaba geçer).
CREATE OR REPLACE FUNCTION public.save_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Oturum gerekli.';
  END IF;
  IF p_endpoint IS NULL OR p_endpoint !~ '^https://' OR char_length(p_endpoint) > 1000 THEN
    RAISE EXCEPTION 'Geçersiz bildirim aboneliği.';
  END IF;
  INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  VALUES (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 400))
  ON CONFLICT (endpoint) DO UPDATE
    SET user_id = EXCLUDED.user_id,
        p256dh = EXCLUDED.p256dh,
        auth = EXCLUDED.auth,
        user_agent = EXCLUDED.user_agent,
        failure_count = 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_push_subscription(p_endpoint text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  DELETE FROM public.push_subscriptions
  WHERE endpoint = p_endpoint AND user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.save_push_subscription(text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_push_subscription(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_push_subscription(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_push_subscription(text) TO authenticated;

-- send-push edge function'ını çağırır. Abonesi olmayan kullanıcılar için
-- hiç istek atılmaz. E-posta ile aynı paylaşılan anahtarı (Vault:
-- notification_webhook_secret) kullanır.
CREATE OR REPLACE FUNCTION public.send_push_notification(
  event_type text,
  user_ids uuid[],
  notification_data jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  webhook_secret text;
  targets uuid[];
BEGIN
  SELECT array_agg(DISTINCT s.user_id) INTO targets
  FROM public.push_subscriptions s
  WHERE s.user_id = ANY (user_ids);
  IF targets IS NULL THEN
    RETURN;
  END IF;

  SELECT decrypted_secret INTO webhook_secret
  FROM vault.decrypted_secrets
  WHERE name = 'notification_webhook_secret'
  LIMIT 1;
  IF webhook_secret IS NULL THEN
    RAISE WARNING 'notification_webhook_secret bulunamadı; telefon bildirimi gönderilemedi (event: %)', event_type;
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://nyfocdnlbknxpxbeeapj.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', webhook_secret
    ),
    body := jsonb_build_object(
      'event_type', event_type,
      'user_ids', to_jsonb(targets),
      'data', COALESCE(notification_data, '{}'::jsonb)
    ),
    timeout_milliseconds := 8000
  );
END;
$$;

REVOKE ALL ON FUNCTION public.send_push_notification(text, uuid[], jsonb) FROM PUBLIC, anon, authenticated;

-- Mevcut e-posta fonksiyonu: gövde aynen korunur; sonuna telefon bildirimi
-- eklenir. Telefon bildirimi hatası e-postayı etkilemez.
CREATE OR REPLACE FUNCTION public.send_notification_email(event_type text, recipients jsonb, notification_data jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  webhook_secret TEXT;
  function_url TEXT := 'https://nyfocdnlbknxpxbeeapj.supabase.co/functions/v1/send-notification-email';
  push_users uuid[];
BEGIN
  IF recipients IS NULL OR jsonb_array_length(recipients) = 0 THEN
    RETURN;
  END IF;

  SELECT decrypted_secret INTO webhook_secret
  FROM vault.decrypted_secrets
  WHERE name = 'notification_webhook_secret'
  LIMIT 1;

  IF webhook_secret IS NULL THEN
    RAISE WARNING 'notification_webhook_secret bulunamadı; bildirim e-postası gönderilemedi (event: %)', event_type;
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', webhook_secret
    ),
    body := jsonb_build_object(
      'event_type', event_type,
      'recipients', recipients,
      'data', notification_data
    ),
    timeout_milliseconds := 8000
  );

  BEGIN
    SELECT array_agg(DISTINCT u.id) INTO push_users
    FROM jsonb_array_elements(recipients) r
    JOIN auth.users u ON lower(u.email) = lower(trim(r ->> 'email'));
    IF push_users IS NOT NULL THEN
      PERFORM public.send_push_notification(event_type, push_users, notification_data);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Telefon bildirimi gönderilemedi (event: %): %', event_type, SQLERRM;
  END;
END;
$function$;

-- Kullanıcının kendi cihazlarına deneme bildirimi.
CREATE OR REPLACE FUNCTION public.send_test_push()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  device_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Oturum gerekli.';
  END IF;
  SELECT count(*) INTO device_count
  FROM public.push_subscriptions WHERE user_id = auth.uid();
  IF device_count > 0 THEN
    PERFORM public.send_push_notification('test', ARRAY[auth.uid()], '{}'::jsonb);
  END IF;
  RETURN device_count;
END;
$$;

REVOKE ALL ON FUNCTION public.send_test_push() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_test_push() TO authenticated;

-- Eski Twilio WhatsApp tetikleyicilerini kapat (silmeden).
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname AS tbl, tg.tgname
    FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND NOT tg.tgisinternal
      AND tg.tgname LIKE 'notify_whatsapp_%'
      AND tg.tgenabled <> 'D'
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER %I', t.tbl, t.tgname);
  END LOOP;
END $$;

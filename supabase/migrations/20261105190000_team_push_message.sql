-- Asistandan ekip üyesine telefon bildirimi ("Mehmet'e 'Selamlar' gönder").
--
-- send_team_push: yalnız yönetici/teknik ofis çağırır; alıcı yalnız NES ekibi
-- (yönetici, teknik ofis, taşeron) olabilir — müşteriye bildirim gitmez.
-- Kötüye kullanım sınırı: kişi başı saatte 30 bildirim. Her gönderim
-- team_push_log'a yazılır (kim, kime, ne zaman, metin); yalnız yönetici okur.
-- Dönüş: bildirim izni açık cihazı olan alıcı sayısı ve alıcı sayısı.
-- Tekrar çalıştırılabilir; veri silmez.

CREATE TABLE IF NOT EXISTS public.team_push_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_ids uuid[] NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS team_push_log_sender_idx
  ON public.team_push_log (sender_id, created_at DESC);

ALTER TABLE public.team_push_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'team_push_log'
      AND policyname = 'admins read team_push_log'
  ) THEN
    CREATE POLICY "admins read team_push_log"
      ON public.team_push_log FOR SELECT TO authenticated
      USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));
  END IF;
END;
$$;

REVOKE ALL ON public.team_push_log FROM anon;
GRANT SELECT ON public.team_push_log TO authenticated;

CREATE OR REPLACE FUNCTION public.send_team_push(
  target_user_ids uuid[],
  message text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  caller uuid := (SELECT auth.uid());
  clean_message text := NULLIF(btrim(message), '');
  recipients uuid[];
  reachable integer;
  sender_name text;
BEGIN
  IF caller IS NULL OR NOT public.can_manage_projects(caller) THEN
    RAISE EXCEPTION 'Bildirim göndermek yalnız yönetici ve teknik ofise açık';
  END IF;
  IF clean_message IS NULL THEN
    RAISE EXCEPTION 'Bildirim metni boş olamaz';
  END IF;
  IF char_length(clean_message) > 300 THEN
    RAISE EXCEPTION 'Bildirim metni en fazla 300 karakter olabilir';
  END IF;

  SELECT array_agg(DISTINCT r.user_id) INTO recipients
  FROM public.user_roles r
  WHERE r.user_id = ANY (target_user_ids)
    AND r.role IN (
      'admin'::public.app_role,
      'technical_office'::public.app_role,
      'contractor'::public.app_role
    );
  IF recipients IS NULL THEN
    RAISE EXCEPTION 'Alıcı bulunamadı (yalnız NES ekibine bildirim gönderilebilir)';
  END IF;

  IF (
    SELECT count(*) FROM public.team_push_log
    WHERE sender_id = caller AND created_at > now() - interval '1 hour'
  ) >= 30 THEN
    RAISE EXCEPTION 'Son bir saatte çok fazla bildirim gönderildi; biraz sonra deneyin';
  END IF;

  SELECT count(DISTINCT s.user_id) INTO reachable
  FROM public.push_subscriptions s
  WHERE s.user_id = ANY (recipients);

  SELECT COALESCE(NULLIF(btrim(full_name), ''), 'NES Enerji') INTO sender_name
  FROM public.profiles WHERE id = caller;

  INSERT INTO public.team_push_log (sender_id, recipient_ids, body)
  VALUES (caller, recipients, clean_message);

  PERFORM public.send_push_notification(
    'team_message',
    recipients,
    jsonb_build_object(
      'title', '💬 ' || COALESCE(sender_name, 'NES Enerji'),
      'body', clean_message,
      'url', '/dashboard'
    )
  );

  RETURN jsonb_build_object(
    'alici_sayisi', array_length(recipients, 1),
    'bildirimi_acik_alici', reachable
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.send_team_push(uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_team_push(uuid[], text) TO authenticated;

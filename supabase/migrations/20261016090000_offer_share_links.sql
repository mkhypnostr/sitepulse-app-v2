-- Teklif paylaşım linki ve "müşteri açtı" takibi.
--
-- 1) offer_share_links: teklif dosyasının müşteriye gönderilen anlık kopyası
--    (HTML) ve tahmin edilemez token. Müşteri dosyası maliyet içermez.
--    Link iptal edilebilir (revoked_at); açılma sayısı ve ilk/son açılış
--    zamanı tutulur.
-- 2) offer_share_views: her açılışın zamanı (ve tarayıcı bilgisi).
-- 3) get_shared_offer(token): linki açan kişi giriş yapmamış olabileceği için
--    SECURITY DEFINER ve anon'a açıktır. Bu, "yeni SECURITY DEFINER
--    fonksiyonlarda anon kaldırılır" kuralının bilinçli istisnasıdır:
--    fonksiyon yalnız 64 karakterlik doğru token ile o linkin müşteri
--    dosyasını döndürür, başka veri döndürmez. Finans yetkilisi (NES içi)
--    açınca ve 30 saniye içindeki tekrar açılışlar sayılmaz.
--
-- Yalnız ekleme yapar (DROP içermez) ve tekrar çalıştırılabilir.

CREATE TABLE IF NOT EXISTS public.offer_share_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL REFERENCES public.offers(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE
    DEFAULT (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
    CHECK (char_length(token) >= 32),
  html text NOT NULL CHECK (char_length(html) BETWEEN 100 AND 3000000),
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  view_count integer NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  first_viewed_at timestamptz,
  last_viewed_at timestamptz
);

CREATE INDEX IF NOT EXISTS offer_share_links_offer_idx
  ON public.offer_share_links (offer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.offer_share_views (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  link_id uuid NOT NULL REFERENCES public.offer_share_links(id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  user_agent text CHECK (user_agent IS NULL OR char_length(user_agent) <= 300)
);

CREATE INDEX IF NOT EXISTS offer_share_views_link_idx
  ON public.offer_share_views (link_id, viewed_at DESC);

ALTER TABLE public.offer_share_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offer_share_views ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'offer_share_links' AND policyname = 'finance managers can view offer share links') THEN
    CREATE POLICY "finance managers can view offer share links"
    ON public.offer_share_links FOR SELECT TO authenticated
    USING ((SELECT public.can_manage_finance(auth.uid())));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'offer_share_links' AND policyname = 'finance managers can create offer share links') THEN
    CREATE POLICY "finance managers can create offer share links"
    ON public.offer_share_links FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.can_manage_finance(auth.uid())));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'offer_share_links' AND policyname = 'finance managers can update offer share links') THEN
    CREATE POLICY "finance managers can update offer share links"
    ON public.offer_share_links FOR UPDATE TO authenticated
    USING ((SELECT public.can_manage_finance(auth.uid())))
    WITH CHECK ((SELECT public.can_manage_finance(auth.uid())));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'offer_share_views' AND policyname = 'finance managers can view offer share views') THEN
    CREATE POLICY "finance managers can view offer share views"
    ON public.offer_share_views FOR SELECT TO authenticated
    USING ((SELECT public.can_manage_finance(auth.uid())));
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE ON public.offer_share_links TO authenticated;
GRANT SELECT ON public.offer_share_views TO authenticated;

CREATE OR REPLACE FUNCTION public.get_shared_offer(p_token text, p_user_agent text DEFAULT NULL)
RETURNS TABLE (html text, offer_no text, title text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link public.offer_share_links%ROWTYPE;
BEGIN
  IF p_token IS NULL OR char_length(p_token) < 32 OR char_length(p_token) > 128 THEN
    RETURN;
  END IF;

  SELECT * INTO v_link
  FROM public.offer_share_links l
  WHERE l.token = p_token AND l.revoked_at IS NULL;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF (auth.uid() IS NULL OR NOT public.can_manage_finance(auth.uid()))
     AND (v_link.last_viewed_at IS NULL OR v_link.last_viewed_at < now() - interval '30 seconds') THEN
    UPDATE public.offer_share_links
    SET view_count = view_count + 1,
        first_viewed_at = COALESCE(first_viewed_at, now()),
        last_viewed_at = now()
    WHERE id = v_link.id;
    INSERT INTO public.offer_share_views (link_id, user_agent)
    VALUES (v_link.id, left(p_user_agent, 300));
  END IF;

  RETURN QUERY
  SELECT v_link.html, o.offer_no, o.title
  FROM public.offers o
  WHERE o.id = v_link.offer_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_shared_offer(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shared_offer(text, text) TO anon, authenticated;

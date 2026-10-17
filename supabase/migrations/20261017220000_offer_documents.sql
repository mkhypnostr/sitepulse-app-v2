-- Enerji paketi tekliflerinin müşteri dosyası (HTML) teklif her kaydedildiğinde
-- saklanır; Teklifler listesinden hazırlayıcıya girmeden açılıp PDF olarak
-- yazdırılabilir. Maliyet bilgisi içermez (müşteriye giden belgenin aynısı).
--
-- Yalnız yönetici (can_manage_finance) okur/yazar; offers tablosuyla aynı.
-- Veri silmez ve tekrar çalıştırılabilir.

CREATE TABLE IF NOT EXISTS public.offer_documents (
  offer_id uuid PRIMARY KEY REFERENCES public.offers(id) ON DELETE CASCADE,
  html text NOT NULL CHECK (char_length(html) <= 5000000),
  updated_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.offer_documents ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  op text;
BEGIN
  FOREACH op IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'offer_documents'
        AND policyname = 'finance managers ' || lower(op) || ' offer documents'
    ) THEN
      IF op = 'INSERT' THEN
        EXECUTE format(
          'CREATE POLICY %I ON public.offer_documents FOR INSERT TO authenticated WITH CHECK ((SELECT public.can_manage_finance(auth.uid())))',
          'finance managers ' || lower(op) || ' offer documents');
      ELSIF op = 'UPDATE' THEN
        EXECUTE format(
          'CREATE POLICY %I ON public.offer_documents FOR UPDATE TO authenticated USING ((SELECT public.can_manage_finance(auth.uid()))) WITH CHECK ((SELECT public.can_manage_finance(auth.uid())))',
          'finance managers ' || lower(op) || ' offer documents');
      ELSE
        EXECUTE format(
          'CREATE POLICY %I ON public.offer_documents FOR %s TO authenticated USING ((SELECT public.can_manage_finance(auth.uid())))',
          'finance managers ' || lower(op) || ' offer documents', op);
      END IF;
    END IF;
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.offer_documents TO authenticated;
REVOKE ALL ON public.offer_documents FROM anon;

-- Daha önce müşteri linki oluşturulmuş tekliflerde son link belgesi başlangıç
-- değeri olarak alınır (hazırlayıcıda bir sonraki kayıtta güncellenir).
INSERT INTO public.offer_documents (offer_id, html, updated_by, updated_at)
SELECT DISTINCT ON (l.offer_id) l.offer_id, l.html, l.created_by, COALESCE(l.updated_at, l.created_at)
FROM public.offer_share_links l
WHERE l.html IS NOT NULL
ORDER BY l.offer_id, COALESCE(l.updated_at, l.created_at) DESC
ON CONFLICT (offer_id) DO NOTHING;

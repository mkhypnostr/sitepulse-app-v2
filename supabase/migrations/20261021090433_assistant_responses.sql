-- Asistan cevabının yedeği: telefon ekranı kapanınca tarayıcı bağlantıyı
-- keser, sunucunun hazırladığı cevap kaybolurdu. Sunucu cevabı istek
-- kimliğiyle buraya da yazar; uygulama bağlantı koptuysa buradan alır ve
-- okuduktan sonra siler. Yalnız sahibi görür.
CREATE TABLE IF NOT EXISTS public.assistant_responses (
  request_id uuid PRIMARY KEY,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assistant_responses_user_idx
  ON public.assistant_responses (user_id, created_at DESC);

ALTER TABLE public.assistant_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner select assistant responses" ON public.assistant_responses
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY "owner insert assistant responses" ON public.assistant_responses
  FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "owner delete assistant responses" ON public.assistant_responses
  FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

GRANT SELECT, INSERT, DELETE ON public.assistant_responses TO authenticated;
REVOKE ALL ON public.assistant_responses FROM anon;

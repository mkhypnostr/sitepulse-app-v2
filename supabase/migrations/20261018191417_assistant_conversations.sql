-- Asistan sohbet geçmişi: her kullanıcının sohbetleri kalıcı saklanır
-- (WhatsApp yazışması gibi; eski sohbetler listeden açılır).
--
-- entries  : ekranda görünen balonlar (kullanıcı, asistan, onay kartları, saat)
-- messages : modele gönderilen ham geçmiş (araç çağrıları dahil). Uzayınca
--            istemci yalnız son kısmını gönderir; ekrandaki geçmiş tam kalır.
--
-- Yalnız sahibi görür ve değiştirir. Yalnız ekleme yapar, tekrar çalıştırılabilir.

CREATE TABLE IF NOT EXISTS public.assistant_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Sohbet' CHECK (char_length(title) <= 120),
  entries jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(entries) = 'array'),
  messages jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(messages) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assistant_conversations_user_idx
  ON public.assistant_conversations (user_id, updated_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'assistant_conversations_touch_updated_at'
      AND tgrelid = 'public.assistant_conversations'::regclass
  ) THEN
    CREATE TRIGGER assistant_conversations_touch_updated_at
    BEFORE UPDATE ON public.assistant_conversations
    FOR EACH ROW EXECUTE FUNCTION public.touch_offer_updated_at();
  END IF;
END $$;

ALTER TABLE public.assistant_conversations ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  op text;
  pol text;
BEGIN
  FOREACH op IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
    pol := 'owner ' || lower(op) || ' assistant_conversations';
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'assistant_conversations' AND policyname = pol
    ) THEN
      IF op = 'INSERT' THEN
        EXECUTE format('CREATE POLICY %I ON public.assistant_conversations FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()))', pol);
      ELSIF op = 'UPDATE' THEN
        EXECUTE format('CREATE POLICY %I ON public.assistant_conversations FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()))', pol);
      ELSE
        EXECUTE format('CREATE POLICY %I ON public.assistant_conversations FOR %s TO authenticated USING (user_id = (SELECT auth.uid()))', pol, op);
      END IF;
    END IF;
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.assistant_conversations TO authenticated;
REVOKE ALL ON public.assistant_conversations FROM anon;

-- NES teklif kayıtlarının ilk, finans-güvenli omurgası.
-- Teklif kalemleri, revizyonlar ve proje/Drive devri sonraki migration'larda eklenir.

CREATE OR REPLACE FUNCTION public.can_manage_finance(target_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT target_user_id IS NOT NULL
    AND public.has_role(target_user_id, 'admin'::public.app_role);
$$;

REVOKE ALL ON FUNCTION public.can_manage_finance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_finance(uuid) TO authenticated;

CREATE TABLE public.offer_number_sequences (
  period char(4) PRIMARY KEY,
  last_value integer NOT NULL DEFAULT 0 CHECK (last_value >= 0)
);

ALTER TABLE public.offer_number_sequences ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_no text NOT NULL UNIQUE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(trim(title)) BETWEEN 3 AND 180),
  offer_type text NOT NULL DEFAULT 'diger'
    CHECK (offer_type IN ('siva_alti', 'montaj', 'diger')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'internal_review', 'sent', 'revision_pending', 'approved', 'lost', 'cancelled')),
  currency char(3) NOT NULL DEFAULT 'TRY' CHECK (currency ~ '^[A-Z]{3}$'),
  total_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  valid_until date,
  source_summary text,
  notes text,
  customer_approved_at timestamptz,
  project_id uuid UNIQUE REFERENCES public.projects(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX offers_customer_id_idx ON public.offers(customer_id);
CREATE INDEX offers_status_created_at_idx ON public.offers(status, created_at DESC);

CREATE OR REPLACE FUNCTION public.assign_offer_no()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  period_value char(4) := to_char(COALESCE(NEW.created_at, now()), 'YYMM');
  next_value integer;
BEGIN
  IF NEW.offer_no IS NOT NULL AND btrim(NEW.offer_no) <> '' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.offer_number_sequences (period, last_value)
  VALUES (period_value, 1)
  ON CONFLICT (period)
  DO UPDATE SET last_value = public.offer_number_sequences.last_value + 1
  RETURNING last_value INTO next_value;

  NEW.offer_no := format('NES-TKF-%s-%s', period_value, lpad(next_value::text, 4, '0'));
  RETURN NEW;
END;
$$;

-- Sayaç satırları yalnız bu tetikleyici tarafından güncellenir. Böylece
-- uygulama kullanıcısı teklif numarasını veya sonraki sıra değerini doğrudan
-- değiştiremez; RLS, numara üretimini engellemez.
REVOKE ALL ON FUNCTION public.assign_offer_no() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER offers_assign_number
BEFORE INSERT ON public.offers
FOR EACH ROW EXECUTE FUNCTION public.assign_offer_no();

CREATE OR REPLACE FUNCTION public.touch_offer_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER offers_touch_updated_at
BEFORE UPDATE ON public.offers
FOR EACH ROW EXECUTE FUNCTION public.touch_offer_updated_at();

ALTER TABLE public.offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "finance managers can view offers"
ON public.offers FOR SELECT TO authenticated
USING ((SELECT public.can_manage_finance(auth.uid())));

CREATE POLICY "finance managers can create offers"
ON public.offers FOR INSERT TO authenticated
WITH CHECK (
  (SELECT public.can_manage_finance(auth.uid()))
  AND created_by = (SELECT auth.uid())
);

CREATE POLICY "finance managers can update offers"
ON public.offers FOR UPDATE TO authenticated
USING ((SELECT public.can_manage_finance(auth.uid())))
WITH CHECK ((SELECT public.can_manage_finance(auth.uid())));

CREATE POLICY "finance managers can delete draft offers"
ON public.offers FOR DELETE TO authenticated
USING (
  (SELECT public.can_manage_finance(auth.uid()))
  AND status = 'draft'
);

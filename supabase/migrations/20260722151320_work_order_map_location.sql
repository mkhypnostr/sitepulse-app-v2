-- İş emirlerinde düz adres yerine güvenli harita bağlantısı saklanır.
ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS location_url TEXT;

COMMENT ON COLUMN public.work_orders.location_url IS
  'Google Maps veya uyumlu harita konum bağlantısı';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'work_orders_location_url_http_check'
      AND conrelid = 'public.work_orders'::regclass
  ) THEN
    ALTER TABLE public.work_orders
      ADD CONSTRAINT work_orders_location_url_http_check
      CHECK (location_url IS NULL OR location_url ~* '^https://');
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.create_work_order(
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TIMESTAMPTZ,
  NUMERIC,
  BOOLEAN,
  UUID
);

CREATE OR REPLACE FUNCTION public.create_work_order(
  target_customer_id UUID,
  order_title TEXT,
  order_description TEXT,
  order_location TEXT,
  order_scheduled_at TIMESTAMPTZ,
  order_total_amount NUMERIC,
  visible_to_customer BOOLEAN,
  assigned_contractor_id UUID DEFAULT NULL,
  order_location_url TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  new_work_order_id UUID;
  normalized_location_url TEXT := NULLIF(trim(order_location_url), '');
BEGIN
  IF NOT public.has_role(current_user_id, 'admin') THEN
    RAISE EXCEPTION 'Bu işlem için yönetici yetkisi gerekir';
  END IF;
  IF NULLIF(trim(order_title), '') IS NULL THEN
    RAISE EXCEPTION 'İş emri başlığı zorunludur';
  END IF;
  IF order_total_amount < 0 THEN
    RAISE EXCEPTION 'İş bedeli negatif olamaz';
  END IF;
  IF normalized_location_url IS NULL OR normalized_location_url !~* '^https://' THEN
    RAISE EXCEPTION 'Geçerli bir güvenli harita bağlantısı zorunludur';
  END IF;
  IF length(normalized_location_url) > 2048 THEN
    RAISE EXCEPTION 'Harita bağlantısı çok uzun';
  END IF;

  INSERT INTO public.work_orders (
    customer_id,
    title,
    description,
    location,
    location_url,
    scheduled_at,
    show_to_customer,
    created_by
  ) VALUES (
    target_customer_id,
    trim(order_title),
    NULLIF(trim(order_description), ''),
    NULLIF(trim(order_location), ''),
    normalized_location_url,
    order_scheduled_at,
    visible_to_customer,
    current_user_id
  )
  RETURNING id INTO new_work_order_id;

  INSERT INTO public.work_order_financials (work_order_id, total_amount)
  VALUES (new_work_order_id, order_total_amount);

  IF assigned_contractor_id IS NOT NULL THEN
    IF NOT public.has_role(assigned_contractor_id, 'contractor') THEN
      RAISE EXCEPTION 'Seçilen kullanıcı taşeron rolünde değil';
    END IF;
    INSERT INTO public.work_order_assignments (work_order_id, contractor_id)
    VALUES (new_work_order_id, assigned_contractor_id);
  END IF;

  RETURN new_work_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_work_order(
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TIMESTAMPTZ,
  NUMERIC,
  BOOLEAN,
  UUID,
  TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_work_order(
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TIMESTAMPTZ,
  NUMERIC,
  BOOLEAN,
  UUID,
  TEXT
) TO authenticated;

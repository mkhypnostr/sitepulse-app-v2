-- İş bitirme akışı: taşeron fotoğraf ve açıklama ile kontrole gönderir;
-- yalnızca yönetici onayı işi tamamlar.

ALTER TYPE public.work_status ADD VALUE IF NOT EXISTS 'review_pending';

ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS completion_note TEXT,
  ADD COLUMN IF NOT EXISTS completion_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completion_submitted_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS review_note TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES auth.users(id);

-- İlerleme yüzdesi %100 olabilir; fakat bu tek başına işi kapatmaz.
CREATE OR REPLACE FUNCTION public.submit_progress_update(
  target_work_order_id UUID,
  new_pct INT,
  progress_note TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  current_status public.work_status;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Oturum bulunamadı';
  END IF;
  IF new_pct < 0 OR new_pct > 100 THEN
    RAISE EXCEPTION 'İlerleme 0 ile 100 arasında olmalıdır';
  END IF;
  IF NOT public.has_role(current_user_id, 'admin')
     AND NOT EXISTS (
       SELECT 1 FROM public.work_order_assignments a
       WHERE a.work_order_id = target_work_order_id
         AND a.contractor_id = current_user_id
     ) THEN
    RAISE EXCEPTION 'Bu iş emri size atanmamış';
  END IF;

  SELECT status INTO current_status
  FROM public.work_orders
  WHERE id = target_work_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'İş emri bulunamadı';
  END IF;
  IF current_status IN ('completed', 'cancelled', 'review_pending') THEN
    RAISE EXCEPTION 'Bu iş emrinin ilerlemesi bu durumda değiştirilemez';
  END IF;

  INSERT INTO public.progress_updates (work_order_id, contractor_id, pct, note)
  VALUES (target_work_order_id, current_user_id, new_pct, NULLIF(trim(progress_note), ''));

  UPDATE public.work_orders
  SET progress_pct = new_pct,
      status = CASE
        WHEN new_pct > 0 THEN 'in_progress'::public.work_status
        ELSE status
      END,
      updated_at = now()
  WHERE id = target_work_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_work_for_review(
  target_work_order_id UUID,
  submitted_completion_note TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  current_progress INT;
  current_status public.work_status;
  normalized_note TEXT := NULLIF(trim(submitted_completion_note), '');
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Oturum bulunamadı';
  END IF;
  IF NOT public.has_role(current_user_id, 'admin')
     AND NOT EXISTS (
       SELECT 1 FROM public.work_order_assignments a
       WHERE a.work_order_id = target_work_order_id
         AND a.contractor_id = current_user_id
     ) THEN
    RAISE EXCEPTION 'Bu iş emri size atanmamış';
  END IF;
  IF normalized_note IS NULL THEN
    RAISE EXCEPTION 'İş bitiş açıklaması zorunludur';
  END IF;

  SELECT progress_pct, status
  INTO current_progress, current_status
  FROM public.work_orders
  WHERE id = target_work_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'İş emri bulunamadı';
  END IF;
  IF current_status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Bu iş emri kontrole gönderilemez';
  END IF;
  IF current_progress <> 100 THEN
    RAISE EXCEPTION 'İşi kontrole göndermek için ilerleme %%100 olmalıdır';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.photos p
    WHERE p.work_order_id = target_work_order_id
      AND p.photo_type = 'montaj_sonrasi'
  ) THEN
    RAISE EXCEPTION 'En az bir Montaj Sonrası fotoğrafı zorunludur';
  END IF;

  UPDATE public.work_orders
  SET status = 'review_pending'::public.work_status,
      completion_note = normalized_note,
      completion_submitted_at = now(),
      completion_submitted_by = current_user_id,
      review_note = NULL,
      reviewed_at = NULL,
      reviewed_by = NULL,
      updated_at = now()
  WHERE id = target_work_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.review_work_completion(
  target_work_order_id UUID,
  approve_completion BOOLEAN,
  manager_review_note TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  current_status public.work_status;
  normalized_note TEXT := NULLIF(trim(manager_review_note), '');
BEGIN
  IF NOT public.has_role(current_user_id, 'admin') THEN
    RAISE EXCEPTION 'Bu işlem için yönetici yetkisi gerekir';
  END IF;
  IF NOT approve_completion AND normalized_note IS NULL THEN
    RAISE EXCEPTION 'Revizyona gönderirken açıklama zorunludur';
  END IF;

  SELECT status INTO current_status
  FROM public.work_orders
  WHERE id = target_work_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'İş emri bulunamadı';
  END IF;
  IF current_status <> 'review_pending' THEN
    RAISE EXCEPTION 'Bu iş emri yönetici kontrolünde değil';
  END IF;

  UPDATE public.work_orders
  SET status = CASE
        WHEN approve_completion THEN 'completed'::public.work_status
        ELSE 'in_progress'::public.work_status
      END,
      review_note = normalized_note,
      reviewed_at = now(),
      reviewed_by = current_user_id,
      updated_at = now()
  WHERE id = target_work_order_id;
END;
$$;

-- Müşteri, iş ancak yönetici tarafından tamamlandıktan sonra paylaşılmışsa görür.
DROP POLICY IF EXISTS "wo_customer_read" ON public.work_orders;
CREATE POLICY "wo_customer_read" ON public.work_orders
  FOR SELECT TO authenticated
  USING (
    show_to_customer = true
    AND status = 'completed'::public.work_status
    AND EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = work_orders.customer_id
        AND c.contact_user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "photos_customer_read" ON public.photos;
CREATE POLICY "photos_customer_read" ON public.photos
  FOR SELECT TO authenticated
  USING (
    show_to_customer = true
    AND EXISTS (
      SELECT 1
      FROM public.work_orders wo
      JOIN public.customers c ON c.id = wo.customer_id
      WHERE wo.id = photos.work_order_id
        AND wo.show_to_customer = true
        AND wo.status = 'completed'::public.work_status
        AND c.contact_user_id = (SELECT auth.uid())
    )
  );

REVOKE ALL ON FUNCTION public.submit_work_for_review(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.review_work_completion(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_work_for_review(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_work_completion(UUID, BOOLEAN, TEXT) TO authenticated;

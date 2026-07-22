-- İş emri ilerlemeleri: yeni fotoğraf + en az 10 karakter açıklama + yönetici onayı.
-- Onay verilene kadar work_orders.progress_pct değişmez.

ALTER TABLE public.progress_updates
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS evidence_photo_id UUID REFERENCES public.photos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_note TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS progress_updates_one_pending_per_order
  ON public.progress_updates(work_order_id)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS progress_updates_evidence_photo_unique
  ON public.progress_updates(evidence_photo_id)
  WHERE evidence_photo_id IS NOT NULL;

-- Taşeronun tabloya doğrudan kayıt ekleyerek veya iş emrini doğrudan güncelleyerek
-- kanıt/onay akışını atlamasını engelle.
DROP POLICY IF EXISTS "pu_contractor_insert" ON public.progress_updates;
DROP POLICY IF EXISTS "wo_contractor_update" ON public.work_orders;
REVOKE INSERT, UPDATE, DELETE ON public.progress_updates FROM authenticated;
-- UPDATE tablo yetkisi yöneticinin müşteri görünürlüğü gibi mevcut işlemleri için kalır;
-- taşeronun güncelleme RLS politikası kaldırıldığı için taşeron yine doğrudan yazamaz.
GRANT UPDATE ON public.work_orders TO authenticated;

DROP FUNCTION IF EXISTS public.submit_progress_update(UUID, INT, TEXT);

CREATE FUNCTION public.submit_progress_update(
  target_work_order_id UUID,
  new_pct INT,
  progress_note TEXT,
  evidence_storage_path TEXT,
  evidence_photo_type public.photo_type DEFAULT 'saha'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  normalized_note TEXT := trim(COALESCE(progress_note, ''));
  current_progress INT;
  current_status public.work_status;
  new_photo_id UUID;
  new_update_id UUID;
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
  IF char_length(normalized_note) < 10 THEN
    RAISE EXCEPTION 'Yapılan iş açıklaması en az 10 karakter olmalıdır';
  END IF;
  IF evidence_storage_path IS NULL OR trim(evidence_storage_path) = '' THEN
    RAISE EXCEPTION 'Yeni bir kanıt fotoğrafı zorunludur';
  END IF;
  IF evidence_storage_path NOT LIKE current_user_id::TEXT || '/' || target_work_order_id::TEXT || '/%' THEN
    RAISE EXCEPTION 'Kanıt fotoğrafı bu kullanıcıya ve iş emrine ait değil';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM storage.objects o
    WHERE o.bucket_id = 'work-photos' AND o.name = evidence_storage_path
  ) THEN
    RAISE EXCEPTION 'Kanıt fotoğrafı yüklenmemiş';
  END IF;

  SELECT progress_pct, status
  INTO current_progress, current_status
  FROM public.work_orders
  WHERE id = target_work_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'İş emri bulunamadı';
  END IF;
  IF current_status IN ('completed', 'cancelled', 'review_pending') THEN
    RAISE EXCEPTION 'Bu iş emrinin ilerlemesi bu durumda değiştirilemez';
  END IF;
  IF new_pct <= current_progress OR new_pct > 100 THEN
    RAISE EXCEPTION 'İlerleme mevcut onaylı değerden yüksek ve en fazla %%100 olmalıdır';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.progress_updates p
    WHERE p.work_order_id = target_work_order_id AND p.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'Bu iş emri için zaten yönetici onayı bekleyen bir ilerleme vardır';
  END IF;

  INSERT INTO public.photos (
    work_order_id, uploaded_by, storage_path, caption, photo_type, show_to_customer
  ) VALUES (
    target_work_order_id, current_user_id, evidence_storage_path,
    normalized_note, evidence_photo_type, false
  )
  RETURNING id INTO new_photo_id;

  INSERT INTO public.progress_updates (
    work_order_id, contractor_id, pct, note, status, evidence_photo_id
  ) VALUES (
    target_work_order_id, current_user_id, new_pct, normalized_note, 'pending', new_photo_id
  )
  RETURNING id INTO new_update_id;

  RETURN new_update_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.review_progress_update(
  target_progress_update_id UUID,
  approve_update BOOLEAN,
  manager_review_note TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  normalized_review_note TEXT := NULLIF(trim(COALESCE(manager_review_note, '')), '');
  current_update public.progress_updates%ROWTYPE;
  current_progress INT;
  order_total NUMERIC;
  approval_amount NUMERIC;
BEGIN
  IF current_user_id IS NULL OR NOT public.has_role(current_user_id, 'admin') THEN
    RAISE EXCEPTION 'Bu işlem için yönetici yetkisi gerekir';
  END IF;
  IF NOT approve_update AND normalized_review_note IS NULL THEN
    RAISE EXCEPTION 'Reddetme açıklaması zorunludur';
  END IF;

  SELECT * INTO current_update
  FROM public.progress_updates
  WHERE id = target_progress_update_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'İlerleme talebi bulunamadı';
  END IF;
  IF current_update.status <> 'pending' THEN
    RAISE EXCEPTION 'Bu ilerleme talebi daha önce sonuçlandırılmış';
  END IF;

  SELECT progress_pct INTO current_progress
  FROM public.work_orders
  WHERE id = current_update.work_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'İş emri bulunamadı';
  END IF;

  IF approve_update THEN
    IF current_update.pct <= current_progress THEN
      RAISE EXCEPTION 'Talep edilen ilerleme mevcut onaylı ilerlemeden yüksek değil';
    END IF;

    UPDATE public.work_orders
    SET progress_pct = current_update.pct,
        status = CASE
          WHEN current_update.pct > 0 THEN 'in_progress'::public.work_status
          ELSE status
        END,
        updated_at = now()
    WHERE id = current_update.work_order_id;

    SELECT total_amount INTO order_total
    FROM public.work_order_financials
    WHERE work_order_id = current_update.work_order_id
    FOR UPDATE;

    IF FOUND THEN
      approval_amount := round(order_total * current_update.pct / 100, 2);
      UPDATE public.work_order_financials
      SET approved_progress_pct = current_update.pct, updated_at = now()
      WHERE work_order_id = current_update.work_order_id;

      INSERT INTO public.progress_approvals (
        work_order_id, approved_pct, approved_amount, approved_by
      ) VALUES (
        current_update.work_order_id, current_update.pct, approval_amount, current_user_id
      );
    END IF;
  END IF;

  UPDATE public.progress_updates
  SET status = CASE WHEN approve_update THEN 'approved' ELSE 'rejected' END,
      reviewed_by = current_user_id,
      reviewed_at = now(),
      review_note = normalized_review_note
  WHERE id = target_progress_update_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_progress_update(UUID, INT, TEXT, TEXT, public.photo_type)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.review_progress_update(UUID, BOOLEAN, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_progress_update(UUID, INT, TEXT, TEXT, public.photo_type)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_progress_update(UUID, BOOLEAN, TEXT)
  TO authenticated;

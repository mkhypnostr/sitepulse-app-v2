-- Taşerona iş emri: keşif/tekliften açılır, taşeron "İşi üstlendim" der,
-- yöneticiye ve teknik ofise bildirim gider.
--
-- - work_orders.offer_id / site_survey_id: iş emrinin kaynağı (yalnız NES
--   kullanır; taşeron teklifi göremez, offers RLS finans yetkisi ister).
-- - work_orders.accepted_at / accepted_by: atanan taşeronun işi üstlendiği an.
--   Taşeron değişirse sıfırlanır.
-- Tekrar çalıştırılabilir; veri silmez.

ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS offer_id uuid REFERENCES public.offers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS site_survey_id uuid REFERENCES public.site_surveys(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS work_orders_offer_idx ON public.work_orders (offer_id);
CREATE INDEX IF NOT EXISTS work_orders_site_survey_idx ON public.work_orders (site_survey_id);

-- Kaynak bağlama: yönetici ve teknik ofis.
CREATE OR REPLACE FUNCTION public.link_work_order_sources(
  target_work_order_id uuid,
  source_offer_id uuid DEFAULT NULL,
  source_survey_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.can_manage_projects(auth.uid()) THEN
    RAISE EXCEPTION 'Bu işlem için yetkiniz yok';
  END IF;
  UPDATE public.work_orders
     SET offer_id = COALESCE(source_offer_id, offer_id),
         site_survey_id = COALESCE(source_survey_id, site_survey_id)
   WHERE id = target_work_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.link_work_order_sources(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_work_order_sources(uuid, uuid, uuid) TO authenticated;

-- Taşeron işi üstlenir; yöneticiye ve teknik ofise e-posta + telefon bildirimi.
CREATE OR REPLACE FUNCTION public.accept_work_order(target_work_order_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  rec record;
  accepted timestamptz;
  admins jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.work_order_assignments
     WHERE work_order_id = target_work_order_id
       AND contractor_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Bu iş emri size atanmamış';
  END IF;

  SELECT wo.id, wo.title, wo.work_order_no, wo.status, wo.accepted_at,
         wo.scheduled_at, p.full_name AS contractor_name
    INTO rec
    FROM public.work_orders wo
    LEFT JOIN public.profiles p ON p.id = auth.uid()
   WHERE wo.id = target_work_order_id;

  IF rec.id IS NULL THEN
    RAISE EXCEPTION 'İş emri bulunamadı';
  END IF;
  IF rec.status IN ('completed', 'cancelled', 'draft') THEN
    RAISE EXCEPTION 'Bu iş emri üstlenilemez';
  END IF;
  IF rec.accepted_at IS NOT NULL THEN
    RETURN rec.accepted_at;
  END IF;

  accepted := now();
  UPDATE public.work_orders
     SET accepted_at = accepted, accepted_by = auth.uid()
   WHERE id = target_work_order_id;

  BEGIN
    admins := public.notification_emails_for_roles(
      ARRAY['admin', 'technical_office']::public.app_role[]
    );
    IF jsonb_array_length(admins) > 0 THEN
      PERFORM public.send_notification_email(
        'work_order_accepted',
        admins,
        jsonb_build_object(
          'taskName', COALESCE(rec.title, 'Saha iş emri')
            || CASE WHEN rec.work_order_no IS NOT NULL THEN ' (#' || rec.work_order_no || ')' ELSE '' END,
          'contractorName', COALESCE(rec.contractor_name, 'Taşeron'),
          'acceptedAt', accepted,
          'plannedStart', rec.scheduled_at,
          'workOrderId', rec.id
        )
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Üstlenme bildirimi gönderilemedi: %', SQLERRM;
  END;

  RETURN accepted;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_work_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_work_order(uuid) TO authenticated;

-- Taşeron değişirse üstlenme sıfırlanır.
CREATE OR REPLACE FUNCTION public.reset_work_order_acceptance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.work_orders SET accepted_at = NULL, accepted_by = NULL
     WHERE id = OLD.work_order_id AND accepted_by = OLD.contractor_id;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.contractor_id IS NOT DISTINCT FROM OLD.contractor_id THEN
    RETURN NEW;
  END IF;
  UPDATE public.work_orders SET accepted_at = NULL, accepted_by = NULL
   WHERE id = NEW.work_order_id
     AND accepted_by IS DISTINCT FROM NEW.contractor_id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_work_order_acceptance() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS work_order_assignments_reset_acceptance ON public.work_order_assignments;
CREATE TRIGGER work_order_assignments_reset_acceptance
AFTER INSERT OR UPDATE OF contractor_id OR DELETE ON public.work_order_assignments
FOR EACH ROW EXECUTE FUNCTION public.reset_work_order_acceptance();

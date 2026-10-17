-- Teklif verilince satış takibine otomatik aday.
--
-- Satış Takibi'nde kaydı olmayan biri için doğrudan teklif hazırlanıp
-- müşteriye gönderildiğinde (durum: sent / revision_pending / approved),
-- teklif bilgilerinden bir fırsat (sales_leads) açılır ve teklif ona bağlanır.
--
-- Doldurulan alanlar:
--   başlık, kayıtlı müşteri veya aday kişi/firma, ilgili kişi, telefon,
--   e-posta (module_config.recipient), proje yeri (projectLocation),
--   hizmet (GES / şarj modülünden), tahmini tutar ve para birimi (teklif
--   toplamı), kaynak (kayıtlı müşteriyse "mevcut_musteri", değilse "diger").
-- Aşama: onaylandıysa "kazanildi", değilse "teklif"; 3 gün sonrasına
-- "Teklif dönüşü için ara" adımı yazılır ve geçmişe "teklif" kaydı düşülür.
--
-- Taslak teklifler aday oluşturmaz. Hata olursa teklif kaydı engellenmez
-- (yalnız uyarı yazılır). Yalnız ekleme yapar (DROP içermez) ve tekrar
-- çalıştırılabilir.

CREATE OR REPLACE FUNCTION public.offer_auto_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec jsonb := COALESCE(NEW.module_config -> 'recipient', '{}'::jsonb);
  is_candidate boolean;
  v_service text := 'diger';
  v_stage text;
  v_currency text := 'TRY';
  v_value numeric := NULL;
  v_lead_id uuid;
  v_owner uuid := COALESCE(auth.uid(), NEW.created_by);
BEGIN
  IF NEW.lead_id IS NOT NULL
     OR NEW.status NOT IN ('sent', 'revision_pending', 'approved') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  BEGIN
    is_candidate := rec ->> 'mode' = 'aday';

    IF COALESCE((NEW.module_config -> 'ges' ->> 'enabled')::boolean, false) THEN
      v_service := 'ges';
    ELSIF COALESCE((NEW.module_config -> 'sarj' ->> 'enabled')::boolean, false) THEN
      v_service := 'sarj';
    END IF;

    IF NEW.currency IN ('TRY', 'USD', 'EUR') THEN
      v_currency := NEW.currency;
      v_value := NULLIF(NEW.total_amount, 0);
    END IF;

    v_stage := CASE WHEN NEW.status = 'approved' THEN 'kazanildi' ELSE 'teklif' END;

    INSERT INTO public.sales_leads (
      title, customer_id, company_name, contact_name, phone, email, location,
      service, source, stage, estimated_value, currency,
      next_action, next_action_at, closed_at, owner_id, created_by
    ) VALUES (
      left(trim(NEW.title), 180),
      NEW.customer_id,
      CASE WHEN is_candidate THEN left(NULLIF(trim(rec ->> 'name'), ''), 160) END,
      left(NULLIF(trim(rec ->> 'contactName'), ''), 120),
      CASE WHEN is_candidate THEN left(NULLIF(trim(rec ->> 'phone'), ''), 40) END,
      CASE WHEN is_candidate THEN left(NULLIF(trim(rec ->> 'email'), ''), 160) END,
      left(NULLIF(trim(NEW.module_config ->> 'projectLocation'), ''), 160),
      v_service,
      CASE WHEN NEW.customer_id IS NOT NULL THEN 'mevcut_musteri' ELSE 'diger' END,
      v_stage,
      v_value,
      v_currency,
      CASE WHEN v_stage = 'teklif' THEN 'Teklif dönüşü için ara' END,
      CASE WHEN v_stage = 'teklif' THEN current_date + 3 END,
      CASE WHEN v_stage = 'kazanildi' THEN now() END,
      v_owner,
      v_owner
    )
    RETURNING id INTO v_lead_id;

    INSERT INTO public.sales_activities (lead_id, customer_id, kind, summary, created_by)
    VALUES (
      v_lead_id,
      NEW.customer_id,
      'teklif',
      left(
        format(
          'Teklif %s verildi: %s. Satış takibine tekliften otomatik eklendi.',
          COALESCE(NEW.offer_no, ''),
          trim(NEW.title)
        ),
        2000
      ),
      v_owner
    );

    NEW.lead_id := v_lead_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'offer_auto_lead: aday oluşturulamadı (teklif %): %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.offer_auto_lead() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'offers_auto_lead'
      AND tgrelid = 'public.offers'::regclass
  ) THEN
    CREATE TRIGGER offers_auto_lead
    BEFORE INSERT OR UPDATE OF status ON public.offers
    FOR EACH ROW EXECUTE FUNCTION public.offer_auto_lead();
  END IF;
END $$;

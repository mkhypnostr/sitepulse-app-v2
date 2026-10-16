-- Otomatik görev kuralları ve kazanılan fırsatın projeye bağlanması.
--
-- 1) automation_rules: "şu durum olunca N gün sonra şu görevi aç" veya
--    "şu tarihten N gün önce şu görevi aç" kuralları. Görev, mevcut
--    Görevler ekranındaki operational_tasks tablosuna açılır; atanan kişiye
--    mevcut "görev atandı" bildirimi gider.
--    Tetikleyiciler:
--      lead_stage       satış fırsatının aşaması (sales_leads.stage)
--      offer_status     teklif durumu (offers.status)
--      project_status   proje durumu (projects.status)
--      service_status   teknik servis talebi durumu
--      contract_end     trafo sorumluluk sözleşmesi bitişinden N gün önce
--      offer_valid_until gönderilmiş teklifin geçerlilik bitişinden N gün önce
-- 2) automation_runs: aynı kural aynı kayıt için iki kez görev açmasın.
-- 3) Durum tetikleyicileri tablo tetikleyicisiyle anında, tarih
--    tetikleyicileri pg_cron ile her sabah 08:00'de (TR) çalışır.
-- 4) sales_leads.project_id: kazanılan fırsatın açılan projesi.
--
-- Kurallar yalnız yönetici tarafından görülür/düzenlenir. İç fonksiyonlar
-- SECURITY DEFINER'dır ve doğrudan çağrılamaz (EXECUTE herkesten alınır);
-- yalnız "şimdi çalıştır" RPC'si yöneticiye açıktır.
-- Yalnız ekleme yapar (DROP içermez) ve tekrar çalıştırılabilir.

CREATE TABLE IF NOT EXISTS public.automation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE CHECK (char_length(trim(name)) BETWEEN 2 AND 120),
  is_active boolean NOT NULL DEFAULT true,
  trigger_type text NOT NULL CHECK (trigger_type IN (
    'lead_stage', 'offer_status', 'project_status', 'service_status',
    'contract_end', 'offer_valid_until')),
  trigger_value text CHECK (trigger_value IS NULL OR char_length(trigger_value) <= 40),
  offset_days integer NOT NULL DEFAULT 0 CHECK (offset_days BETWEEN 0 AND 365),
  task_title text NOT NULL CHECK (char_length(trim(task_title)) BETWEEN 2 AND 200),
  task_description text CHECK (task_description IS NULL OR char_length(task_description) <= 2000),
  assign_mode text NOT NULL DEFAULT 'owner' CHECK (assign_mode IN ('owner', 'user', 'none')),
  assignee_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by uuid DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (assign_mode <> 'user' OR assignee_id IS NOT NULL),
  CHECK (
    (trigger_type IN ('contract_end', 'offer_valid_until') AND trigger_value IS NULL)
    OR (trigger_type NOT IN ('contract_end', 'offer_valid_until') AND trigger_value IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.automation_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rule_id uuid NOT NULL REFERENCES public.automation_rules(id) ON DELETE CASCADE,
  record_id uuid NOT NULL,
  fire_key text NOT NULL,
  task_id uuid REFERENCES public.operational_tasks(id) ON DELETE SET NULL,
  fired_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_id, record_id, fire_key)
);

CREATE INDEX IF NOT EXISTS automation_runs_rule_idx ON public.automation_runs (rule_id, fired_at DESC);

ALTER TABLE public.sales_leads ADD COLUMN IF NOT EXISTS project_id uuid
  REFERENCES public.projects(id) ON DELETE SET NULL;

ALTER TABLE public.automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'automation_rules' AND policyname = 'admins manage automation rules') THEN
    CREATE POLICY "admins manage automation rules" ON public.automation_rules
      FOR ALL TO authenticated
      USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
      WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'automation_runs' AND policyname = 'admins view automation runs') THEN
    CREATE POLICY "admins view automation runs" ON public.automation_runs
      FOR SELECT TO authenticated
      USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.automation_rules TO authenticated;
GRANT SELECT ON public.automation_runs TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'automation_rules_touch_updated_at'
      AND tgrelid = 'public.automation_rules'::regclass
  ) THEN
    CREATE TRIGGER automation_rules_touch_updated_at
    BEFORE UPDATE ON public.automation_rules
    FOR EACH ROW EXECUTE FUNCTION public.touch_offer_updated_at();
  END IF;
END $$;

-- Durum tetikleyicileri: durum değişince (ya da kayıt açılınca) çalışır.
-- Görev tarihi = bugün + kuraldaki gün; aynı gün aynı duruma tekrar
-- girilirse ikinci görev açılmaz.
CREATE OR REPLACE FUNCTION public.automation_on_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trigger text;
  v_value text;
  v_label text;
  v_customer uuid;
  v_project uuid;
  v_owner uuid;
  r public.automation_rules%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'sales_leads' THEN
    IF TG_OP = 'UPDATE' AND NEW.stage IS NOT DISTINCT FROM OLD.stage THEN RETURN NEW; END IF;
    v_trigger := 'lead_stage'; v_value := NEW.stage; v_label := NEW.title;
    v_customer := NEW.customer_id; v_project := NEW.project_id;
    v_owner := COALESCE(NEW.owner_id, NEW.created_by);
  ELSIF TG_TABLE_NAME = 'offers' THEN
    IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
    v_trigger := 'offer_status'; v_value := NEW.status;
    v_label := concat_ws(' ', NEW.offer_no, NEW.title);
    v_customer := NEW.customer_id; v_project := NEW.project_id; v_owner := NEW.created_by;
  ELSIF TG_TABLE_NAME = 'projects' THEN
    IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
    v_trigger := 'project_status'; v_value := NEW.status::text;
    v_label := concat_ws(' ', NEW.project_no, NEW.name);
    v_customer := NEW.customer_id; v_project := NEW.id;
    v_owner := COALESCE(NEW.manager_id, NEW.created_by);
  ELSIF TG_TABLE_NAME = 'technical_service_requests' THEN
    IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
    v_trigger := 'service_status'; v_value := NEW.status;
    v_label := concat_ws(' ', '#' || NEW.request_no::text, NEW.title);
    v_customer := NEW.customer_id; v_project := NULL; v_owner := NULL;
  ELSE
    RETURN NEW;
  END IF;

  -- Kural başına görev tarihi farklı olduğundan kurallar tek tek çalıştırılır.
  FOR r IN
    SELECT * FROM public.automation_rules
    WHERE is_active AND trigger_type = v_trigger AND trigger_value = v_value
  LOOP
    -- Otomasyon hatası asıl kaydı (teklif, proje vb.) asla engellemesin.
    BEGIN
      PERFORM public.fire_automation_rule_core(
        r, NEW.id, v_label, v_customer, v_project, v_owner,
        current_date + r.offset_days, v_value || ':' || current_date::text);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Otomatik görev kuralı % çalışmadı: %', r.name, SQLERRM;
    END;
  END LOOP;
  RETURN NEW;
END;
$$;

-- Tek kural için görev açar; aynı kayıt ve anahtar için ikinci kez açmaz.
CREATE OR REPLACE FUNCTION public.fire_automation_rule_core(
  r public.automation_rules,
  p_record uuid,
  p_label text,
  p_customer uuid,
  p_project uuid,
  p_owner uuid,
  p_planned date,
  p_fire_key text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assignee uuid;
  v_creator uuid;
  v_task uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.automation_runs
    WHERE rule_id = r.id AND record_id = p_record AND fire_key = p_fire_key
  ) THEN
    RETURN 0;
  END IF;

  v_assignee := CASE r.assign_mode
    WHEN 'user' THEN r.assignee_id
    WHEN 'owner' THEN p_owner
    ELSE NULL
  END;
  IF v_assignee IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_assignee) THEN
    v_assignee := NULL;
  END IF;

  v_creator := COALESCE(
    -- Müşteri/taşeron bir talep açtığında görevin sahibi o kişi olmasın.
    (SELECT id FROM public.profiles
     WHERE id = auth.uid() AND public.can_manage_projects(auth.uid())),
    (SELECT id FROM public.profiles WHERE id = r.created_by),
    (SELECT ur.user_id FROM public.user_roles ur
       JOIN public.profiles p ON p.id = ur.user_id
     WHERE ur.role = 'admin'::public.app_role
     ORDER BY ur.created_at LIMIT 1)
  );
  IF v_creator IS NULL THEN
    RETURN 0;
  END IF;

  INSERT INTO public.operational_tasks
    (title, description, project_id, customer_id, assigned_to, planned_date, created_by)
  VALUES (
    left(replace(r.task_title, '{ad}', COALESCE(NULLIF(trim(p_label), ''), 'kayıt')), 200),
    concat_ws(E'\n', NULLIF(trim(r.task_description), ''), 'Otomatik görev — kural: ' || r.name),
    p_project,
    p_customer,
    v_assignee,
    COALESCE(p_planned, current_date),
    v_creator
  )
  RETURNING id INTO v_task;

  INSERT INTO public.automation_runs (rule_id, record_id, fire_key, task_id)
  VALUES (r.id, p_record, p_fire_key, v_task)
  ON CONFLICT (rule_id, record_id, fire_key) DO NOTHING;
  RETURN 1;
END;
$$;

-- Tarih kuralları: her sabah çalışır. Bitişe N gün kala (ve bitiş henüz
-- geçmemişken) bir kez görev açar; aynı bitiş tarihi için tekrar açmaz.
CREATE OR REPLACE FUNCTION public.run_date_automations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.automation_rules%ROWTYPE;
  c record;
  o record;
  v_total integer := 0;
BEGIN
  FOR r IN SELECT * FROM public.automation_rules WHERE is_active AND trigger_type = 'contract_end' LOOP
    FOR c IN
      SELECT id, customer_name, subscriber_no, contract_end_date
      FROM public.transformer_responsibility_contracts
      WHERE status = 'active'
        AND contract_end_date IS NOT NULL
        AND contract_end_date >= current_date
        AND contract_end_date - r.offset_days <= current_date
    LOOP
      v_total := v_total + public.fire_automation_rule_core(
        r, c.id,
        concat_ws(' ', c.customer_name, CASE WHEN c.subscriber_no IS NOT NULL THEN '(' || c.subscriber_no || ')' END)
          || ' — bitiş ' || to_char(c.contract_end_date, 'DD.MM.YYYY'),
        NULL, NULL, NULL, current_date, 'end:' || c.contract_end_date::text);
    END LOOP;
  END LOOP;

  FOR r IN SELECT * FROM public.automation_rules WHERE is_active AND trigger_type = 'offer_valid_until' LOOP
    FOR o IN
      SELECT id, offer_no, title, customer_id, project_id, created_by, valid_until
      FROM public.offers
      WHERE status IN ('sent', 'revision_pending')
        AND valid_until IS NOT NULL
        AND valid_until >= current_date
        AND valid_until - r.offset_days <= current_date
    LOOP
      v_total := v_total + public.fire_automation_rule_core(
        r, o.id,
        concat_ws(' ', o.offer_no, o.title) || ' — geçerlilik ' || to_char(o.valid_until, 'DD.MM.YYYY'),
        o.customer_id, o.project_id, o.created_by, current_date, 'valid:' || o.valid_until::text);
    END LOOP;
  END LOOP;
  RETURN v_total;
END;
$$;

-- Yöneticinin "şimdi çalıştır" düğmesi için.
CREATE OR REPLACE FUNCTION public.run_automations_now()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role((SELECT auth.uid()), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Bu işlem için yönetici yetkisi gerekir';
  END IF;
  RETURN public.run_date_automations();
END;
$$;

REVOKE ALL ON FUNCTION public.fire_automation_rule_core(public.automation_rules, uuid, text, uuid, uuid, uuid, date, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.run_date_automations() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.automation_on_status_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.run_automations_now() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_automations_now() TO authenticated;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales_leads', 'offers', 'projects', 'technical_service_requests'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = t || '_automation_status'
        AND tgrelid = ('public.' || t)::regclass
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER %I AFTER INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.automation_on_status_change()',
        t || '_automation_status', t);
    END IF;
  END LOOP;
END $$;

-- Her sabah 05:00 UTC (08:00 TR).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'run-date-automations') THEN
    PERFORM cron.schedule('run-date-automations', '0 5 * * *', 'SELECT public.run_date_automations();');
  END IF;
END $$;

-- Başlangıç kuralları (adı aynı olan varsa eklenmez; ekrandan kapatılabilir).
INSERT INTO public.automation_rules
  (name, trigger_type, trigger_value, offset_days, task_title, task_description, assign_mode)
VALUES
  ('Gönderilen teklifin dönüşünü ara', 'offer_status', 'sent', 3,
   'Teklif dönüşü için ara: {ad}', 'Müşteri teklifi aldı mı, sorusu var mı? Görüşmeyi satış fırsatına not edin.', 'owner'),
  ('Onaylanan teklif için projeyi başlat', 'offer_status', 'approved', 0,
   'Onaylanan teklif: proje/iş emrini aç, avans faturasını kes: {ad}', NULL, 'owner'),
  ('Teklif geçerliliği bitmeden hatırlat', 'offer_valid_until', NULL, 2,
   'Teklif süresi doluyor, müşteriyi ara: {ad}', 'Gerekirse süreyi uzatın veya revize teklif verin.', 'owner'),
  ('Keşif aşamasına gelen fırsat', 'lead_stage', 'kesif', 0,
   'Keşif randevusu planla: {ad}', NULL, 'owner'),
  ('Yeni servis talebini incele', 'service_status', 'new', 0,
   'Yeni servis talebini incele: {ad}', 'Aciliyeti değerlendirip planlayın veya iş emrine çevirin.', 'none'),
  ('Tamamlanan projede memnuniyet araması', 'project_status', 'completed', 7,
   'Memnuniyet araması yap, referans ve yorum iste: {ad}', NULL, 'owner'),
  ('Trafo sorumluluk sözleşmesi yenileme', 'contract_end', NULL, 30,
   'Sözleşme yenileme görüşmesi: {ad}', 'Yeni dönem fiyatını hazırlayıp müşteriyle görüşün.', 'none')
ON CONFLICT (name) DO NOTHING;

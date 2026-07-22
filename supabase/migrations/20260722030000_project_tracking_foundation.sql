-- NES Enerji Proje / Şantiye Takip kalıbı
-- Mevcut iş emri akışını değiştirmeden proje, süreç ve kontrol listesi altyapısını ekler.

DO $$
BEGIN
  CREATE TYPE public.project_status AS ENUM (
    'draft',
    'active',
    'on_hold',
    'completed',
    'cancelled'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE public.project_type AS ENUM (
    'electric_permit',
    'site_project',
    'connection_line'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE public.project_task_status AS ENUM (
    'not_started',
    'in_progress',
    'external_approval',
    'revision_required',
    'blocked',
    'completed',
    'not_applicable'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS public.project_number_counters (
  year INTEGER PRIMARY KEY CHECK (year BETWEEN 2020 AND 9999),
  last_value BIGINT NOT NULL DEFAULT 0 CHECK (last_value >= 0)
);

CREATE TABLE IF NOT EXISTS public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_no TEXT NOT NULL UNIQUE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (NULLIF(trim(name), '') IS NOT NULL),
  external_reference_no TEXT,
  location_url TEXT,
  province TEXT,
  district TEXT,
  neighborhood TEXT,
  block_no TEXT,
  parcel_no TEXT,
  area NUMERIC(14,2) CHECK (area IS NULL OR area > 0),
  manager_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  start_date DATE,
  target_end_date DATE,
  status public.project_status NOT NULL DEFAULT 'draft',
  show_to_customer BOOLEAN NOT NULL DEFAULT false,
  description TEXT,
  admin_notes TEXT,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT projects_date_order_check CHECK (
    start_date IS NULL OR target_end_date IS NULL OR target_end_date >= start_date
  )
);

CREATE TABLE IF NOT EXISTS public.project_processes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  process_type public.project_type NOT NULL,
  position INTEGER NOT NULL DEFAULT 1 CHECK (position > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, process_type)
);

CREATE TABLE IF NOT EXISTS public.workflow_task_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  process_type public.project_type NOT NULL,
  phase_name TEXT NOT NULL CHECK (NULLIF(trim(phase_name), '') IS NOT NULL),
  phase_order INTEGER NOT NULL CHECK (phase_order > 0),
  task_name TEXT NOT NULL CHECK (NULLIF(trim(task_name), '') IS NOT NULL),
  task_order INTEGER NOT NULL CHECK (task_order > 0),
  external_system TEXT,
  requires_photo BOOLEAN NOT NULL DEFAULT false,
  requires_document BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (process_type, phase_order, task_order)
);

CREATE TABLE IF NOT EXISTS public.project_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  process_id UUID NOT NULL REFERENCES public.project_processes(id) ON DELETE CASCADE,
  template_id UUID REFERENCES public.workflow_task_templates(id) ON DELETE SET NULL,
  phase_name TEXT NOT NULL,
  phase_order INTEGER NOT NULL CHECK (phase_order > 0),
  task_name TEXT NOT NULL,
  task_order INTEGER NOT NULL CHECK (task_order > 0),
  status public.project_task_status NOT NULL DEFAULT 'not_started',
  responsible_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  planned_date DATE,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  external_system TEXT,
  note TEXT,
  requires_photo BOOLEAN NOT NULL DEFAULT false,
  requires_document BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (process_id, phase_order, task_order)
);

CREATE TABLE IF NOT EXISTS public.project_task_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_task_id UUID NOT NULL REFERENCES public.project_tasks(id) ON DELETE CASCADE,
  actor_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  old_status public.project_task_status,
  new_status public.project_task_status NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS projects_customer_id_idx ON public.projects(customer_id);
CREATE INDEX IF NOT EXISTS projects_manager_id_idx ON public.projects(manager_id);
CREATE INDEX IF NOT EXISTS projects_status_idx ON public.projects(status);
CREATE INDEX IF NOT EXISTS project_processes_project_id_idx ON public.project_processes(project_id);
CREATE INDEX IF NOT EXISTS workflow_task_templates_process_idx
  ON public.workflow_task_templates(process_type, phase_order, task_order);
CREATE INDEX IF NOT EXISTS project_tasks_project_id_idx ON public.project_tasks(project_id);
CREATE INDEX IF NOT EXISTS project_tasks_process_id_idx ON public.project_tasks(process_id);
CREATE INDEX IF NOT EXISTS project_tasks_responsible_id_idx ON public.project_tasks(responsible_id);
CREATE INDEX IF NOT EXISTS project_tasks_status_idx ON public.project_tasks(status);
CREATE INDEX IF NOT EXISTS project_task_activity_task_idx
  ON public.project_task_activity(project_task_id, created_at DESC);

-- Excel'deki iş takip çizelgesinden alınan başlangıç kontrol listeleri.
INSERT INTO public.workflow_task_templates (
  process_type,
  phase_name,
  phase_order,
  task_name,
  task_order,
  external_system,
  requires_photo,
  requires_document
)
VALUES
  ('electric_permit', 'Belge Toplama', 1, 'Tapu alındı', 1, NULL, false, true),
  ('electric_permit', 'Belge Toplama', 1, 'Aplikasyon krokisi alındı', 2, NULL, false, true),
  ('electric_permit', 'Belge Toplama', 1, 'Mekanik proje alındı', 3, NULL, false, true),
  ('electric_permit', 'Proje ve Onay', 2, 'Elektrik ruhsat projesi çizimi', 1, NULL, false, true),
  ('electric_permit', 'Proje ve Onay', 2, 'YBS sistemine yükleme', 2, 'YBS', false, true),
  ('electric_permit', 'Proje ve Onay', 2, 'ADM onayı', 3, 'ADM / YBS', false, true),
  ('electric_permit', 'Proje ve Onay', 2, 'EMO onayı', 4, 'EMO', false, true),
  ('electric_permit', 'Proje ve Onay', 2, 'Müellif taahhütnamesi', 5, NULL, false, true),
  ('electric_permit', 'Proje ve Onay', 2, 'Universe sistemine yükleme', 6, 'UNIVERSE', false, true),
  ('electric_permit', 'Proje ve Onay', 2, 'İmzaların tamamlanması', 7, NULL, false, true),
  ('electric_permit', 'Proje ve Onay', 2, 'Ruhsat alımı', 8, 'BELEDİYE', false, true),

  ('site_project', 'Saha ve Metraj', 1, 'Sahadan metraj geldi', 1, NULL, false, true),
  ('site_project', 'Başvuru ve Onay', 2, 'Ruhsat ile şantiye başvurusu', 1, NULL, false, true),
  ('site_project', 'Başvuru ve Onay', 2, 'Şantiye projesi onayı', 2, NULL, false, true),
  ('site_project', 'Başvuru ve Onay', 2, 'Bağlantı görüşü başvurusu', 3, NULL, false, true),
  ('site_project', 'Başvuru ve Onay', 2, 'Bağlantı görüşü onayı', 4, NULL, false, true),
  ('site_project', 'Başvuru ve Onay', 2, 'Bağlantı hattı projesi çizimi', 5, NULL, false, true),
  ('site_project', 'Başvuru ve Onay', 2, 'Bağlantı anlaşması', 6, NULL, false, true),
  ('site_project', 'Başvuru ve Onay', 2, 'Tercih formu', 7, NULL, false, true),
  ('site_project', 'Sayaç ve Tesisat', 3, 'Saha fotoğrafları alındı', 1, NULL, true, false),
  ('site_project', 'Sayaç ve Tesisat', 3, 'İş başlama ve bitirme evrakları', 2, NULL, false, true),
  ('site_project', 'Sayaç ve Tesisat', 3, 'Sayaç takma başvurusu', 3, NULL, false, true),
  ('site_project', 'Sayaç ve Tesisat', 3, 'Sayaç takıldı', 4, NULL, true, false),
  ('site_project', 'Sayaç ve Tesisat', 3, 'Tesisat kontrol başvurusu', 5, NULL, false, true),
  ('site_project', 'Sayaç ve Tesisat', 3, 'Tesisat kontrolü yapıldı', 6, NULL, true, false),
  ('site_project', 'Sayaç ve Tesisat', 3, 'İş tamamlandı', 7, NULL, true, true),

  ('connection_line', 'Başvuru ve Çizim', 1, 'Ruhsat ile bağlantı görüşü başvurusu', 1, NULL, false, true),
  ('connection_line', 'Başvuru ve Çizim', 1, 'Bağlantı hattı projesi çizimi', 2, NULL, false, true),
  ('connection_line', 'Başvuru ve Çizim', 1, 'Bağlantı anlaşması', 3, NULL, false, true),
  ('connection_line', 'Başvuru ve Çizim', 1, 'Tercih formu onayı', 4, NULL, false, true),
  ('connection_line', 'Sayaç ve Kontroller', 2, 'Saha fotoğrafları alındı', 1, NULL, true, false),
  ('connection_line', 'Sayaç ve Kontroller', 2, 'İş başlama ve bitirme evrakları', 2, NULL, false, true),
  ('connection_line', 'Sayaç ve Kontroller', 2, 'Sayaç takma başvurusu', 3, NULL, false, true),
  ('connection_line', 'Sayaç ve Kontroller', 2, 'Sayaç takıldı', 4, NULL, true, false),
  ('connection_line', 'Sayaç ve Kontroller', 2, 'Tesisat kontrol başvurusu', 5, NULL, false, true),
  ('connection_line', 'Sayaç ve Kontroller', 2, 'Tesisat kontrolü yapıldı', 6, NULL, true, false),
  ('connection_line', 'Sayaç ve Kontroller', 2, 'İş tamamlandı', 7, NULL, true, true)
ON CONFLICT (process_type, phase_order, task_order) DO UPDATE
SET
  phase_name = EXCLUDED.phase_name,
  task_name = EXCLUDED.task_name,
  external_system = EXCLUDED.external_system,
  requires_photo = EXCLUDED.requires_photo,
  requires_document = EXCLUDED.requires_document,
  active = true;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projects_set_updated_at ON public.projects;
CREATE TRIGGER projects_set_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS project_tasks_set_updated_at ON public.project_tasks;
CREATE TRIGGER project_tasks_set_updated_at
  BEFORE UPDATE ON public.project_tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.project_number_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_processes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_task_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_task_activity ENABLE ROW LEVEL SECURITY;

-- Data API için yalnızca okuma erişimi açılır; yazma güvenli RPC'lerden yapılır.
GRANT SELECT ON public.projects TO authenticated;
GRANT SELECT ON public.project_processes TO authenticated;
GRANT SELECT ON public.workflow_task_templates TO authenticated;
GRANT SELECT ON public.project_tasks TO authenticated;
GRANT SELECT ON public.project_task_activity TO authenticated;

GRANT ALL ON public.project_number_counters TO service_role;
GRANT ALL ON public.projects TO service_role;
GRANT ALL ON public.project_processes TO service_role;
GRANT ALL ON public.workflow_task_templates TO service_role;
GRANT ALL ON public.project_tasks TO service_role;
GRANT ALL ON public.project_task_activity TO service_role;

DROP POLICY IF EXISTS "projects_admin_read" ON public.projects;
CREATE POLICY "projects_admin_read" ON public.projects
  FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'));

DROP POLICY IF EXISTS "project_processes_admin_read" ON public.project_processes;
CREATE POLICY "project_processes_admin_read" ON public.project_processes
  FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'));

DROP POLICY IF EXISTS "workflow_task_templates_admin_read" ON public.workflow_task_templates;
CREATE POLICY "workflow_task_templates_admin_read" ON public.workflow_task_templates
  FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'));

DROP POLICY IF EXISTS "project_tasks_admin_read" ON public.project_tasks;
CREATE POLICY "project_tasks_admin_read" ON public.project_tasks
  FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'));

DROP POLICY IF EXISTS "project_task_activity_admin_read" ON public.project_task_activity;
CREATE POLICY "project_task_activity_admin_read" ON public.project_task_activity
  FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'));

CREATE OR REPLACE FUNCTION public.create_project_with_workflow(
  target_customer_id UUID,
  project_name TEXT,
  selected_processes public.project_type[],
  project_external_reference_no TEXT DEFAULT NULL,
  project_location_url TEXT DEFAULT NULL,
  project_province TEXT DEFAULT NULL,
  project_district TEXT DEFAULT NULL,
  project_neighborhood TEXT DEFAULT NULL,
  project_block_no TEXT DEFAULT NULL,
  project_parcel_no TEXT DEFAULT NULL,
  project_area NUMERIC DEFAULT NULL,
  target_manager_id UUID DEFAULT NULL,
  project_start_date DATE DEFAULT NULL,
  project_target_end_date DATE DEFAULT NULL,
  project_state public.project_status DEFAULT 'draft',
  visible_to_customer BOOLEAN DEFAULT false,
  project_description TEXT DEFAULT NULL,
  project_admin_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  current_year INTEGER := EXTRACT(YEAR FROM now())::INTEGER;
  next_sequence BIGINT;
  generated_project_no TEXT;
  new_project_id UUID;
  new_process_id UUID;
  current_process public.project_type;
  process_position INTEGER;
BEGIN
  IF current_user_id IS NULL OR NOT public.has_role(current_user_id, 'admin') THEN
    RAISE EXCEPTION 'Bu işlem için yönetici yetkisi gerekir';
  END IF;

  IF NULLIF(trim(project_name), '') IS NULL THEN
    RAISE EXCEPTION 'Proje adı zorunludur';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = target_customer_id) THEN
    RAISE EXCEPTION 'Geçerli bir müşteri seçin';
  END IF;

  IF COALESCE(array_length(selected_processes, 1), 0) = 0
     OR EXISTS (SELECT 1 FROM unnest(selected_processes) AS item(value) WHERE value IS NULL) THEN
    RAISE EXCEPTION 'En az bir süreç türü seçin';
  END IF;

  IF target_manager_id IS NOT NULL
     AND NOT public.has_role(target_manager_id, 'admin') THEN
    RAISE EXCEPTION 'Sorumlu kişi yönetici rolünde olmalıdır';
  END IF;

  IF project_area IS NOT NULL AND project_area <= 0 THEN
    RAISE EXCEPTION 'Alan sıfırdan büyük olmalıdır';
  END IF;

  IF project_start_date IS NOT NULL
     AND project_target_end_date IS NOT NULL
     AND project_target_end_date < project_start_date THEN
    RAISE EXCEPTION 'Hedef bitiş tarihi başlangıçtan önce olamaz';
  END IF;

  INSERT INTO public.project_number_counters (year, last_value)
  VALUES (current_year, 1)
  ON CONFLICT (year) DO UPDATE
  SET last_value = public.project_number_counters.last_value + 1
  RETURNING last_value INTO next_sequence;

  generated_project_no := format(
    'NES-%s-%s',
    current_year,
    lpad(next_sequence::TEXT, 4, '0')
  );

  INSERT INTO public.projects (
    project_no,
    customer_id,
    name,
    external_reference_no,
    location_url,
    province,
    district,
    neighborhood,
    block_no,
    parcel_no,
    area,
    manager_id,
    start_date,
    target_end_date,
    status,
    show_to_customer,
    description,
    admin_notes,
    created_by
  )
  VALUES (
    generated_project_no,
    target_customer_id,
    trim(project_name),
    NULLIF(trim(project_external_reference_no), ''),
    NULLIF(trim(project_location_url), ''),
    NULLIF(trim(project_province), ''),
    NULLIF(trim(project_district), ''),
    NULLIF(trim(project_neighborhood), ''),
    NULLIF(trim(project_block_no), ''),
    NULLIF(trim(project_parcel_no), ''),
    project_area,
    target_manager_id,
    project_start_date,
    project_target_end_date,
    project_state,
    visible_to_customer,
    NULLIF(trim(project_description), ''),
    NULLIF(trim(project_admin_notes), ''),
    current_user_id
  )
  RETURNING id INTO new_project_id;

  FOR current_process, process_position IN
    SELECT item.value, MIN(item.position)::INTEGER
    FROM unnest(selected_processes) WITH ORDINALITY AS item(value, position)
    GROUP BY item.value
    ORDER BY MIN(item.position)
  LOOP
    INSERT INTO public.project_processes (project_id, process_type, position)
    VALUES (new_project_id, current_process, process_position)
    RETURNING id INTO new_process_id;

    INSERT INTO public.project_tasks (
      project_id,
      process_id,
      template_id,
      phase_name,
      phase_order,
      task_name,
      task_order,
      external_system,
      requires_photo,
      requires_document
    )
    SELECT
      new_project_id,
      new_process_id,
      template.id,
      template.phase_name,
      template.phase_order,
      template.task_name,
      template.task_order,
      template.external_system,
      template.requires_photo,
      template.requires_document
    FROM public.workflow_task_templates AS template
    WHERE template.process_type = current_process
      AND template.active = true
    ORDER BY template.phase_order, template.task_order;
  END LOOP;

  RETURN new_project_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_project_task(
  target_task_id UUID,
  new_status public.project_task_status,
  assigned_user_id UUID DEFAULT NULL,
  planned_on DATE DEFAULT NULL,
  task_system TEXT DEFAULT NULL,
  task_note TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  previous_status public.project_task_status;
BEGIN
  IF current_user_id IS NULL OR NOT public.has_role(current_user_id, 'admin') THEN
    RAISE EXCEPTION 'Bu işlem için yönetici yetkisi gerekir';
  END IF;

  SELECT status
  INTO previous_status
  FROM public.project_tasks
  WHERE id = target_task_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Görev bulunamadı';
  END IF;

  IF assigned_user_id IS NOT NULL
     AND NOT public.has_role(assigned_user_id, 'admin') THEN
    RAISE EXCEPTION 'Görev sorumlusu yönetici rolünde olmalıdır';
  END IF;

  UPDATE public.project_tasks
  SET
    status = new_status,
    responsible_id = assigned_user_id,
    planned_date = planned_on,
    external_system = NULLIF(trim(task_system), ''),
    note = NULLIF(trim(task_note), ''),
    completed_at = CASE
      WHEN new_status = 'completed' THEN COALESCE(completed_at, now())
      ELSE NULL
    END,
    completed_by = CASE
      WHEN new_status = 'completed' THEN COALESCE(completed_by, current_user_id)
      ELSE NULL
    END
  WHERE id = target_task_id;

  IF previous_status IS DISTINCT FROM new_status THEN
    INSERT INTO public.project_task_activity (
      project_task_id,
      actor_user_id,
      old_status,
      new_status,
      note
    )
    VALUES (
      target_task_id,
      current_user_id,
      previous_status,
      new_status,
      NULLIF(trim(task_note), '')
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_project_with_workflow(
  UUID,
  TEXT,
  public.project_type[],
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  NUMERIC,
  UUID,
  DATE,
  DATE,
  public.project_status,
  BOOLEAN,
  TEXT,
  TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_project_task(
  UUID,
  public.project_task_status,
  UUID,
  DATE,
  TEXT,
  TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_project_with_workflow(
  UUID,
  TEXT,
  public.project_type[],
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  NUMERIC,
  UUID,
  DATE,
  DATE,
  public.project_status,
  BOOLEAN,
  TEXT,
  TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_project_task(
  UUID,
  public.project_task_status,
  UUID,
  DATE,
  TEXT,
  TEXT
) TO authenticated;


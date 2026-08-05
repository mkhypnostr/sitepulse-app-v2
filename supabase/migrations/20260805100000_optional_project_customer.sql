-- Proje oluşturma sırasında müşteri artık opsiyonel: bazı projeler (iç
-- işler, henüz müşterisi netleşmemiş şantiyeler) müşterisiz başlatılabilmeli.

ALTER TABLE public.projects ALTER COLUMN customer_id DROP NOT NULL;

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

  -- Müşteri artık opsiyonel; yalnızca bir müşteri seçildiyse geçerliliğini doğrula.
  IF target_customer_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.customers WHERE id = target_customer_id) THEN
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
    -- Müşterisiz bir proje müşteri paneline gösterilemez.
    visible_to_customer AND target_customer_id IS NOT NULL,
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

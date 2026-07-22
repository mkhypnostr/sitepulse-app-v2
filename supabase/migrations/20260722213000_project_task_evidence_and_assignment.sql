-- Proje görevlerinin taşerona atanması, kanıt dosyaları ve gerçekleşen tarih.
-- İlerleme yüzdeleri bu migration'da değiştirilmez; kanıt onay akışı ayrı pakette kurulacaktır.

ALTER TABLE public.project_tasks
  ADD COLUMN IF NOT EXISTS actual_date DATE;

CREATE TABLE IF NOT EXISTS public.project_task_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_task_id UUID NOT NULL REFERENCES public.project_tasks(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL UNIQUE CHECK (NULLIF(trim(storage_path), '') IS NOT NULL),
  file_name TEXT NOT NULL CHECK (NULLIF(trim(file_name), '') IS NOT NULL),
  mime_type TEXT NOT NULL CHECK (NULLIF(trim(mime_type), '') IS NOT NULL),
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 20971520),
  evidence_type TEXT NOT NULL CHECK (evidence_type IN ('photo', 'document')),
  description TEXT,
  uploaded_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_task_evidence_task_created_idx
  ON public.project_task_evidence(project_task_id, created_at DESC);

ALTER TABLE public.project_task_evidence ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.project_task_evidence TO authenticated;
GRANT ALL ON public.project_task_evidence TO service_role;

DROP POLICY IF EXISTS "project_task_evidence_admin_all" ON public.project_task_evidence;
CREATE POLICY "project_task_evidence_admin_all"
ON public.project_task_evidence
FOR ALL TO authenticated
USING (public.has_role((SELECT auth.uid()), 'admin'))
WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'));

DROP POLICY IF EXISTS "project_tasks_contractor_read_assigned" ON public.project_tasks;
CREATE POLICY "project_tasks_contractor_read_assigned"
ON public.project_tasks
FOR SELECT TO authenticated
USING (
  public.has_role((SELECT auth.uid()), 'contractor')
  AND responsible_id = (SELECT auth.uid())
);

DROP POLICY IF EXISTS "project_task_evidence_contractor_read_assigned" ON public.project_task_evidence;
CREATE POLICY "project_task_evidence_contractor_read_assigned"
ON public.project_task_evidence
FOR SELECT TO authenticated
USING (
  public.has_role((SELECT auth.uid()), 'contractor')
  AND EXISTS (
    SELECT 1
    FROM public.project_tasks AS task
    WHERE task.id = project_task_evidence.project_task_id
      AND task.responsible_id = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS "project_task_evidence_contractor_insert_assigned" ON public.project_task_evidence;
CREATE POLICY "project_task_evidence_contractor_insert_assigned"
ON public.project_task_evidence
FOR INSERT TO authenticated
WITH CHECK (
  public.has_role((SELECT auth.uid()), 'contractor')
  AND uploaded_by = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.project_tasks AS task
    WHERE task.id = project_task_evidence.project_task_id
      AND task.responsible_id = (SELECT auth.uid())
  )
);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'project-evidence',
  'project-evidence',
  false,
  20971520,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::TEXT[]
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "project_evidence_admin_all" ON storage.objects;
CREATE POLICY "project_evidence_admin_all"
ON storage.objects
FOR ALL TO authenticated
USING (
  bucket_id = 'project-evidence'
  AND public.has_role((SELECT auth.uid()), 'admin')
)
WITH CHECK (
  bucket_id = 'project-evidence'
  AND public.has_role((SELECT auth.uid()), 'admin')
);

DROP POLICY IF EXISTS "project_evidence_contractor_upload_assigned" ON storage.objects;
CREATE POLICY "project_evidence_contractor_upload_assigned"
ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'project-evidence'
  AND public.has_role((SELECT auth.uid()), 'contractor')
  AND (storage.foldername(name))[1] = 'tasks'
  AND EXISTS (
    SELECT 1
    FROM public.project_tasks AS task
    WHERE task.id::TEXT = (storage.foldername(name))[2]
      AND task.responsible_id = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS "project_evidence_contractor_read_assigned" ON storage.objects;
CREATE POLICY "project_evidence_contractor_read_assigned"
ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'project-evidence'
  AND public.has_role((SELECT auth.uid()), 'contractor')
  AND (storage.foldername(name))[1] = 'tasks'
  AND EXISTS (
    SELECT 1
    FROM public.project_tasks AS task
    WHERE task.id::TEXT = (storage.foldername(name))[2]
      AND task.responsible_id = (SELECT auth.uid())
  )
);

DROP FUNCTION IF EXISTS public.update_project_task(
  UUID,
  public.project_task_status,
  UUID,
  DATE,
  TEXT,
  TEXT
);

CREATE FUNCTION public.update_project_task(
  target_task_id UUID,
  new_status public.project_task_status,
  assigned_user_id UUID DEFAULT NULL,
  planned_on DATE DEFAULT NULL,
  task_system TEXT DEFAULT NULL,
  task_note TEXT DEFAULT NULL,
  actual_on DATE DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  previous_status public.project_task_status;
  parent_project_status public.project_status;
BEGIN
  IF current_user_id IS NULL OR NOT public.has_role(current_user_id, 'admin') THEN
    RAISE EXCEPTION 'Bu işlem için yönetici yetkisi gerekir';
  END IF;

  SELECT task.status, project.status
  INTO previous_status, parent_project_status
  FROM public.project_tasks AS task
  JOIN public.projects AS project ON project.id = task.project_id
  WHERE task.id = target_task_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Görev bulunamadı';
  END IF;
  IF parent_project_status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Tamamlanan veya iptal edilen projenin görevleri değiştirilemez';
  END IF;
  IF assigned_user_id IS NOT NULL
     AND NOT (
       public.has_role(assigned_user_id, 'admin')
       OR public.has_role(assigned_user_id, 'contractor')
     ) THEN
    RAISE EXCEPTION 'Görev sorumlusu yönetici veya taşeron rolünde olmalıdır';
  END IF;

  UPDATE public.project_tasks
  SET
    status = new_status,
    responsible_id = assigned_user_id,
    planned_date = planned_on,
    actual_date = CASE
      WHEN new_status = 'completed' THEN COALESCE(actual_on, actual_date, CURRENT_DATE)
      ELSE actual_on
    END,
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
    ) VALUES (
      target_task_id,
      current_user_id,
      previous_status,
      new_status,
      NULLIF(trim(task_note), '')
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.update_project_task(
  UUID,
  public.project_task_status,
  UUID,
  DATE,
  TEXT,
  TEXT,
  DATE
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_project_task(
  UUID,
  public.project_task_status,
  UUID,
  DATE,
  TEXT,
  TEXT,
  DATE
) TO authenticated;

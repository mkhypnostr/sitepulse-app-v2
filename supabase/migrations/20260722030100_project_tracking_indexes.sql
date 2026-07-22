-- Proje takip tablolarındaki kalan yabancı anahtarlar için performans indeksleri.

CREATE INDEX IF NOT EXISTS projects_created_by_idx
  ON public.projects(created_by);

CREATE INDEX IF NOT EXISTS project_tasks_template_id_idx
  ON public.project_tasks(template_id);

CREATE INDEX IF NOT EXISTS project_tasks_completed_by_idx
  ON public.project_tasks(completed_by);

CREATE INDEX IF NOT EXISTS project_task_activity_actor_idx
  ON public.project_task_activity(actor_user_id);


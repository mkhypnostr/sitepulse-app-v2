-- Eski Drive aktarım işlerinin durumunu izlemek için kalıcı tablo.
-- Aktarım tamamlandığı için burada herhangi bir cron job, HTTP çağrısı veya
-- otomatik zamanlayıcı oluşturulmaz; yalnızca durum kaydı tutulur.

CREATE TABLE IF NOT EXISTS public.nes_workspace_migration_jobs (
  job_key text PRIMARY KEY,
  job_token uuid NOT NULL DEFAULT gen_random_uuid(),
  state text NOT NULL DEFAULT 'running' CHECK (state IN ('running', 'completed', 'failed')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.nes_workspace_migration_jobs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.nes_workspace_migration_jobs FROM PUBLIC, anon, authenticated;

GRANT ALL ON public.nes_workspace_migration_jobs TO service_role;

INSERT INTO public.nes_workspace_migration_jobs (job_key, state)
VALUES ('legacy_nes', 'completed')
ON CONFLICT (job_key) DO NOTHING;

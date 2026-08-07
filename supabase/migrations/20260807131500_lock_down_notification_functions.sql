-- REVOKE ... FROM PUBLIC tek başına yetmiyor: Supabase, public şemadaki yeni
-- fonksiyonlara varsayılan olarak anon/authenticated rollerine de doğrudan
-- EXECUTE veriyor (ALTER DEFAULT PRIVILEGES). Bildirim fonksiyonları yalnızca
-- tetikleyiciler/pg_cron içinden (postgres sahibi olarak) çağrılmalı; anon
-- veya authenticated üzerinden PostgREST RPC ile çağrılabilir olmamalı.
REVOKE ALL ON FUNCTION public.notification_email_for_user(UUID) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_emails_for_roles(public.app_role[]) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.send_notification_email(TEXT, JSONB, JSONB) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_overdue_tasks() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_reset_overdue_notice() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_notify_work_order_assigned() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_notify_project_task_assigned() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_notify_operational_task_assigned() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_notify_completion_pending() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_notify_progress_pending() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_notify_project_task_progress_pending() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_notify_completion_decision() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_notify_progress_decision() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_notify_project_task_progress_decision() FROM anon, authenticated;

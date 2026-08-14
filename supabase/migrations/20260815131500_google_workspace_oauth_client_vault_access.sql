create or replace function public.get_google_workspace_oauth_client_credentials()
returns table (
  client_id text,
  client_secret text,
  redirect_uri text
)
language sql
security definer
set search_path = public, vault, pg_temp
as $function$
  select
    max(decrypted_secret) filter (
      where name = 'google_workspace_client_id'
    ) as client_id,
    max(decrypted_secret) filter (
      where name = 'google_workspace_client_secret'
    ) as client_secret,
    max(decrypted_secret) filter (
      where name = 'google_workspace_redirect_uri'
    ) as redirect_uri
  from vault.decrypted_secrets
  where name in (
    'google_workspace_client_id',
    'google_workspace_client_secret',
    'google_workspace_redirect_uri'
  );
$function$;

revoke all
  on function public.get_google_workspace_oauth_client_credentials()
  from public;
revoke all
  on function public.get_google_workspace_oauth_client_credentials()
  from anon;
revoke all
  on function public.get_google_workspace_oauth_client_credentials()
  from authenticated;
grant execute
  on function public.get_google_workspace_oauth_client_credentials()
  to service_role;

-- Run as a database operator after storing the worker key in Vault under
-- gymmi_google_calendar_worker. The key must also be an Edge Function secret.
-- Store the legacy public anon JWT in Vault as gymmi_google_calendar_gateway.
-- The anon JWT only passes the gateway. The worker key authorizes the job.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule('gymmi-google-calendar-sync', '*/2 * * * *', $job$
  select net.http_post(
    url := 'https://yvzfkaswrohpniheubpn.supabase.co/functions/v1/google-calendar-sync',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer ' || gateway.decrypted_secret,
      'x-gymmi-calendar-worker', worker.decrypted_secret),
    body := '{"action":"worker"}'::jsonb,
    timeout_milliseconds := 55000
  )
  from vault.decrypted_secrets worker
  cross join vault.decrypted_secrets gateway
  where worker.name = 'gymmi_google_calendar_worker'
    and gateway.name = 'gymmi_google_calendar_gateway'
    and exists (
      select 1 from public.google_calendar_connections
      where not paused and next_sync_at <= now()
        and (lease_until is null or lease_until < now())
    );
$job$);

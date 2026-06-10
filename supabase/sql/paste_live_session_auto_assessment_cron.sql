-- DISABLED: Auto leadership assessment is manual-only for now.
-- Run paste_disable_live_session_auto_assessment_cron.sql to remove any scheduled job.
--
-- To re-enable later: set Edge secret LIVE_SESSION_AUTO_ASSESSMENT_ENABLED=true, then run this file.
-- Schedules live-session-auto-assessment every 30 min on Wednesdays (America/Toronto session window).

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Re-run safe: drop prior job name if present
do $$
declare
  job_id bigint;
begin
  select jobid into job_id from cron.job where jobname = 'live-session-auto-assessment';
  if job_id is not null then
    perform cron.unschedule(job_id);
  end if;
end $$;

-- Store cron secret in Vault (replace YOUR_SECRET before running, or use CLI one-liner below).
select vault.create_secret(
  'YOUR_LIVE_SESSION_AUTO_CRON_SECRET',
  'live_session_auto_cron_secret',
  'Header x-cron-secret for live-session-auto-assessment'
);

select cron.schedule(
  'live-session-auto-assessment',
  '*/30 * * * 3',
  $$
  select net.http_post(
    url := 'https://hlfufjrjztuknioydlut.supabase.co/functions/v1/live-session-auto-assessment',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'live_session_auto_cron_secret' limit 1)
    ),
    body := jsonb_build_object('triggered_by', 'pg_cron'),
    timeout_milliseconds := 120000
  ) as request_id;
  $$
);

-- Verify: select jobid, jobname, schedule, active from cron.job where jobname = 'live-session-auto-assessment';

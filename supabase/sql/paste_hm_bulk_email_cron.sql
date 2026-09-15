-- Bulk email server worker (keeps campaigns sending when the browser is closed).
-- Runs every minute against Hiring Machine project.
--
-- BEFORE RUNNING:
-- 1. Deploy hm-bulk-email
-- 2. Ensure Edge secret HM_CRON_SECRET is set (same value as YOUR_CRON_SECRET below)
-- 3. Replace YOUR_CRON_SECRET and confirm project URL

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

do $$
declare
  job_id bigint;
begin
  select jobid into job_id from cron.job where jobname = 'hm-bulk-email-tick';
  if job_id is not null then
    perform cron.unschedule(job_id);
  end if;
end $$;

select cron.schedule(
  'hm-bulk-email-tick',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://ofhcnsuwrhyvxtvtdunw.supabase.co/functions/v1/hm-bulk-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'YOUR_CRON_SECRET'
    ),
    body := jsonb_build_object('action', 'tick', 'triggered_by', 'pg_cron'),
    timeout_milliseconds := 120000
  ) as request_id;
  $$
);

-- Verify:
-- select jobid, jobname, schedule, active from cron.job where jobname = 'hm-bulk-email-tick';

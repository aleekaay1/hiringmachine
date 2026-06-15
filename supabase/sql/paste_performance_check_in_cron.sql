-- Mid-week coaching email automation (Supabase pg_cron — no external server).
-- Runs Mon & Tue at 15:00 UTC (~10am Eastern). Edge function skips other weekdays.
--
-- BEFORE RUNNING:
-- 1. Deploy: performance-check-in-reminder Edge function
-- 2. Supabase Dashboard → Edge Functions → performance-check-in-reminder → Secrets:
--      PERFORMANCE_CHECKIN_CRON_SECRET = (same string as step 3 below)
--      PERFORMANCE_CHECKIN_AUTOMATION_ENABLED = true
--      SMTP_* (same as other staff emails)
-- 3. Replace YOUR_CRON_SECRET below (use a long random string)

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

do $$
declare
  job_id bigint;
begin
  select jobid into job_id from cron.job where jobname = 'performance-check-in-reminder';
  if job_id is not null then
    perform cron.unschedule(job_id);
  end if;
end $$;

-- Optional: store secret in Vault (skip if you prefer hardcoding in the HTTP call below)
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'performance_checkin_cron_secret') then
    perform vault.create_secret(
      'YOUR_CRON_SECRET',
      'performance_checkin_cron_secret',
      'x-cron-secret for performance-check-in-reminder'
    );
  end if;
exception
  when others then
    raise notice 'Vault secret not created (use hardcoded secret in cron body or create manually).';
end $$;

select cron.schedule(
  'performance-check-in-reminder',
  '0 15 * * 1,2',
  $$
  select net.http_post(
    url := 'https://hlfufjrjztuknioydlut.supabase.co/functions/v1/performance-check-in-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', coalesce(
        (select decrypted_secret from vault.decrypted_secrets where name = 'performance_checkin_cron_secret' limit 1),
        'YOUR_CRON_SECRET'
      )
    ),
    body := jsonb_build_object('triggered_by', 'pg_cron'),
    timeout_milliseconds := 180000
  ) as request_id;
  $$
);

-- Verify:
-- select jobid, jobname, schedule, active from cron.job where jobname = 'performance-check-in-reminder';

-- Disable:
-- select cron.unschedule(jobid) from cron.job where jobname = 'performance-check-in-reminder';

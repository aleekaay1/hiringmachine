-- Paste in Supabase SQL Editor — stops scheduled auto leadership assessment sends.
-- Manual sends still work from Live Sessions → Sync pipeline → send assessments.

do $$
declare
  job_id bigint;
begin
  select jobid into job_id from cron.job where jobname = 'live-session-auto-assessment';
  if job_id is not null then
    perform cron.unschedule(job_id);
  end if;
end $$;

-- Verify removed: select jobid, jobname, active from cron.job where jobname = 'live-session-auto-assessment';

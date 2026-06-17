-- Disable mid-week coaching reminder cron (stops automated check-in emails).
-- Run in Supabase → SQL Editor when MID_WEEK_COACHING_ENABLED is false in the app.
-- Re-enable: run paste_performance_check_in_cron.sql

do $$
declare
  job_id bigint;
begin
  select jobid into job_id from cron.job where jobname = 'performance-check-in-reminder';
  if job_id is not null then
    perform cron.unschedule(job_id);
    raise notice 'Unscheduled performance-check-in-reminder (job %)', job_id;
  else
    raise notice 'No performance-check-in-reminder cron job found — already disabled.';
  end if;
end $$;

-- Verify:
-- select jobid, jobname, schedule, active from cron.job where jobname = 'performance-check-in-reminder';

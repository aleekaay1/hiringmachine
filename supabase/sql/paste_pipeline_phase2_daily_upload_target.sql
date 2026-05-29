-- Paste in Supabase SQL Editor
-- Same as migration 20260529_233900_pipeline_phase2_daily_upload_target.sql
alter table if exists public.pipeline_user_call_settings
  add column if not exists daily_upload_target integer;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'pipeline_user_call_settings_daily_upload_target_check'
  ) then
    alter table public.pipeline_user_call_settings
      add constraint pipeline_user_call_settings_daily_upload_target_check
      check (daily_upload_target is null or daily_upload_target >= 0);
  end if;
end$$;

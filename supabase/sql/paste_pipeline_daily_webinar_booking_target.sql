-- Paste in Supabase SQL Editor
-- Same as migration 20260530_020500_pipeline_daily_webinar_booking_target.sql
alter table if exists public.pipeline_user_call_settings
  add column if not exists daily_webinar_booking_target integer;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'pipeline_user_call_settings_daily_webinar_booking_target_check'
  ) then
    alter table public.pipeline_user_call_settings
      add constraint pipeline_user_call_settings_daily_webinar_booking_target_check
      check (daily_webinar_booking_target is null or daily_webinar_booking_target >= 0);
  end if;
end$$;

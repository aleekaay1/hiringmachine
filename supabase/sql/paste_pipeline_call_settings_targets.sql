-- Run if coaching hub 400s on pipeline_user_call_settings target columns.

alter table if exists public.pipeline_user_call_settings
  add column if not exists daily_upload_target integer;

alter table if exists public.pipeline_user_call_settings
  add column if not exists daily_webinar_booking_target integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'pipeline_user_call_settings_daily_upload_target_check'
  ) then
    alter table public.pipeline_user_call_settings
      add constraint pipeline_user_call_settings_daily_upload_target_check
      check (daily_upload_target is null or daily_upload_target >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'pipeline_user_call_settings_daily_webinar_booking_target_check'
  ) then
    alter table public.pipeline_user_call_settings
      add constraint pipeline_user_call_settings_daily_webinar_booking_target_check
      check (daily_webinar_booking_target is null or daily_webinar_booking_target >= 0);
  end if;
end $$;

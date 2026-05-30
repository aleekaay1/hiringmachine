-- Paste in Supabase SQL Editor
-- Same as migration: 20260530_224500_pipeline_call_records_allow_booked.sql
do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'pipeline_call_records_disposition_check'
  ) then
    alter table public.pipeline_call_records
      drop constraint pipeline_call_records_disposition_check;
  end if;

  alter table public.pipeline_call_records
    add constraint pipeline_call_records_disposition_check
    check (
      disposition in (
        'No answer',
        'Voicemail left',
        'Busy / line busy',
        'Callback requested',
        'Wrong number',
        'Not interested',
        'Connected',
        'Interested – next step',
        'Scheduled interview',
        'Do not call',
        'Booked'
      )
    );
end$$;

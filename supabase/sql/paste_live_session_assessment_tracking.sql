-- Paste in Supabase SQL Editor
-- Same as migration: 20260602_200000_live_session_assessment_tracking.sql

alter table public.live_session_registrants
  add column if not exists assessment_email_sent_at timestamptz,
  add column if not exists assessment_email_status text,
  add column if not exists assessment_email_mode text,
  add column if not exists assessment_email_error text;

alter table public.live_session_occurrences
  add column if not exists assessment_auto_run_at timestamptz,
  add column if not exists assessment_emails_sent_count int not null default 0,
  add column if not exists assessment_emails_failed_count int not null default 0;

comment on column public.live_session_registrants.assessment_email_status is
  'sent | failed | skipped_not_in_portal | skipped_already_sent | skipped_disqualified | skipped_submitted | pending';
comment on column public.live_session_registrants.assessment_email_mode is 'auto | manual';

create index if not exists live_session_registrants_assessment_status_idx
  on public.live_session_registrants (session_date, assessment_email_status);

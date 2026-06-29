-- Paste after paste_webinar_geek_questionnaires.sql (attendance + source tracking).

alter table public.webinar_geek_questionnaire_submissions
  add column if not exists source_type text not null default 'wg_sync',
  add column if not exists watched boolean,
  add column if not exists watch_duration_seconds int;

alter table public.webinar_geek_questionnaire_submissions
  drop constraint if exists webinar_geek_questionnaire_submissions_hiring_stage_check;

alter table public.webinar_geek_questionnaire_submissions
  add constraint webinar_geek_questionnaire_submissions_hiring_stage_check
  check (hiring_stage in ('questionnaire_submitted', 'ready_for_followup', 'attended_only'));

create index if not exists webinar_geek_questionnaire_submissions_source_idx
  on public.webinar_geek_questionnaire_submissions (source_type, submitted_at desc nulls last);

comment on column public.webinar_geek_questionnaire_submissions.source_type is
  'wg_sync = live WebinarGeek API; dashboard_cache = imported from webinar_geek_dashboard_snapshots.';

-- WebinarGeek post-webinar evaluation / questionnaire submissions (synced from API).

create table if not exists public.webinar_geek_questionnaire_submissions (
  id uuid primary key default gen_random_uuid(),
  wg_submission_key text not null,
  subscription_id text,
  webinar_id text,
  broadcast_id text,
  webinar_title text,
  broadcast_title text,
  email text,
  first_name text,
  last_name text,
  phone text,
  submitted_at timestamptz,
  answers jsonb not null default '[]'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  pipeline_candidate_id uuid references public.pipeline_candidates (id) on delete set null,
  journey_candidate_id text references public.candidates (id) on delete set null,
  booked_by_user_id uuid references auth.users (id) on delete set null,
  booked_by_label text,
  recruiter_custom_field text,
  match_method text,
  hiring_stage text not null default 'questionnaire_submitted'
    check (hiring_stage in ('questionnaire_submitted', 'ready_for_followup', 'attended_only')),
  source_type text not null default 'wg_sync',
  watched boolean,
  watch_duration_seconds int,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint webinar_geek_questionnaire_submissions_key_unique unique (wg_submission_key)
);

create index if not exists webinar_geek_questionnaire_submissions_email_idx
  on public.webinar_geek_questionnaire_submissions (lower(trim(email)));

create index if not exists webinar_geek_questionnaire_submissions_submitted_idx
  on public.webinar_geek_questionnaire_submissions (submitted_at desc nulls last);

create index if not exists webinar_geek_questionnaire_submissions_booked_by_idx
  on public.webinar_geek_questionnaire_submissions (booked_by_user_id, submitted_at desc);

create index if not exists webinar_geek_questionnaire_submissions_pipeline_candidate_idx
  on public.webinar_geek_questionnaire_submissions (pipeline_candidate_id);

create index if not exists webinar_geek_questionnaire_submissions_source_idx
  on public.webinar_geek_questionnaire_submissions (source_type, submitted_at desc nulls last);

comment on table public.webinar_geek_questionnaire_submissions is
  'Post-webinar evaluation/questionnaire responses from WebinarGeek, matched to pipeline candidates and booking recruiter.';

alter table public.webinar_geek_questionnaire_submissions enable row level security;

drop policy if exists webinar_geek_questionnaire_submissions_select on public.webinar_geek_questionnaire_submissions;
create policy webinar_geek_questionnaire_submissions_select
on public.webinar_geek_questionnaire_submissions
for select
to authenticated
using (
  exists (
    select 1 from public.user_profiles up
    where up.user_id = auth.uid()
      and up.role in ('admin', 'leadership', 'hr', 'webinar')
  )
  or booked_by_user_id = auth.uid()
  or exists (
    select 1
    from public.pipeline_user_call_settings pcs
    where pcs.user_id = auth.uid()
      and pcs.webinar_geek_custom_field is not null
      and trim(pcs.webinar_geek_custom_field) <> ''
      and lower(trim(pcs.webinar_geek_custom_field)) = lower(trim(recruiter_custom_field))
  )
);

drop policy if exists webinar_geek_questionnaire_submissions_service_write on public.webinar_geek_questionnaire_submissions;
create policy webinar_geek_questionnaire_submissions_service_write
on public.webinar_geek_questionnaire_submissions
for all
to service_role
using (true)
with check (true);

create table if not exists public.webinar_geek_questionnaire_sync_runs (
  id uuid primary key default gen_random_uuid(),
  synced_at timestamptz not null default now(),
  fetched_count int not null default 0,
  upserted_count int not null default 0,
  matched_pipeline_count int not null default 0,
  api_sources jsonb not null default '[]'::jsonb,
  triggered_by_user_id uuid references auth.users (id) on delete set null,
  error_message text
);

comment on table public.webinar_geek_questionnaire_sync_runs is
  'Audit log for manual WebinarGeek questionnaire sync runs.';

alter table public.webinar_geek_questionnaire_sync_runs enable row level security;

drop policy if exists webinar_geek_questionnaire_sync_runs_select on public.webinar_geek_questionnaire_sync_runs;
create policy webinar_geek_questionnaire_sync_runs_select
on public.webinar_geek_questionnaire_sync_runs
for select
to authenticated
using (
  exists (
    select 1 from public.user_profiles up
    where up.user_id = auth.uid()
      and up.role in ('admin', 'leadership', 'hr', 'webinar')
  )
);

drop policy if exists webinar_geek_questionnaire_sync_runs_service_write on public.webinar_geek_questionnaire_sync_runs;
create policy webinar_geek_questionnaire_sync_runs_service_write
on public.webinar_geek_questionnaire_sync_runs
for all
to service_role
using (true)
with check (true);

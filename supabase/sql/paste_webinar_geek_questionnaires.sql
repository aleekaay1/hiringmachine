-- Paste in Supabase SQL editor (run this entire file once).
-- WebinarGeek questionnaire + attendance submissions.

-- Prerequisite for recruiter-scoped RLS (from webinar geek caller portal).
alter table if exists public.pipeline_user_call_settings
  add column if not exists webinar_geek_custom_field text;

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

-- If an older failed attempt created journey_candidate_id as uuid, fix it:
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'webinar_geek_questionnaire_submissions'
      and column_name = 'journey_candidate_id'
      and data_type = 'uuid'
  ) then
    alter table public.webinar_geek_questionnaire_submissions
      drop constraint if exists webinar_geek_questionnaire_submission_journey_candidate_id_fkey;
    alter table public.webinar_geek_questionnaire_submissions
      drop constraint if exists webinar_geek_questionnaire_submissions_journey_candidate_id_fkey;
    alter table public.webinar_geek_questionnaire_submissions
      alter column journey_candidate_id type text using journey_candidate_id::text;
    alter table public.webinar_geek_questionnaire_submissions
      add constraint webinar_geek_questionnaire_submissions_journey_candidate_id_fkey
      foreign key (journey_candidate_id) references public.candidates (id) on delete set null;
  end if;
end $$;

alter table public.webinar_geek_questionnaire_submissions
  add column if not exists source_type text not null default 'wg_sync',
  add column if not exists watched boolean,
  add column if not exists watch_duration_seconds int;

alter table public.webinar_geek_questionnaire_submissions
  drop constraint if exists webinar_geek_questionnaire_submissions_hiring_stage_check;

alter table public.webinar_geek_questionnaire_submissions
  add constraint webinar_geek_questionnaire_submissions_hiring_stage_check
  check (hiring_stage in ('questionnaire_submitted', 'ready_for_followup', 'attended_only'));

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

comment on column public.webinar_geek_questionnaire_submissions.source_type is
  'wg_sync = live WebinarGeek API; dashboard_cache = imported from webinar_geek_dashboard_snapshots.';

alter table public.webinar_geek_questionnaire_submissions enable row level security;

create or replace function public.wg_recruiter_can_view_questionnaire_row(
  p_recruiter_custom_field text,
  p_booked_by_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_booked_by_user_id = auth.uid()
    or (
      p_recruiter_custom_field is not null
      and trim(p_recruiter_custom_field) <> ''
      and exists (
        select 1
        from public.user_profiles up
        left join public.pipeline_user_call_settings pcs on pcs.user_id = up.user_id
        where up.user_id = auth.uid()
          and up.role = 'recruiter'
          and (
            lower(trim(coalesce(pcs.webinar_geek_custom_field, ''))) = lower(trim(p_recruiter_custom_field))
            or (
              coalesce(nullif(trim(split_part(coalesce(up.full_name, ''), ' ', 1)), ''), nullif(trim(split_part(split_part(coalesce(up.email, ''), '@', 1), '.', 1)), '')) is not null
              and lower(p_recruiter_custom_field) like '%' || lower(coalesce(
                nullif(trim(split_part(coalesce(up.full_name, ''), ' ', 1)), ''),
                nullif(trim(split_part(split_part(coalesce(up.email, ''), '@', 1), '.', 1)), '')
              )) || '%'
            )
          )
      )
    );
$$;

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
  or public.wg_recruiter_can_view_questionnaire_row(recruiter_custom_field, booked_by_user_id)
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

notify pgrst, 'reload schema';

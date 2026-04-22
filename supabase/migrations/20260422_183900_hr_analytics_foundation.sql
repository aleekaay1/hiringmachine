-- HR Analytics Foundation (beta-safe, additive only)
-- Creates isolated analytics schema so existing CRM flow remains untouched.

create schema if not exists hr_analytics;

-- 1) Candidate signals (latest denormalized snapshot)
create table if not exists hr_analytics.hr_candidate_signals (
  candidate_id text primary key references public.candidates(id) on delete cascade,
  pipeline_stage text not null,
  score numeric,
  fit_category text,
  invited_live_session boolean not null default false,
  attended_live_session boolean not null default false,
  webinar_invited_count integer not null default 0,
  webinar_watched_count integer not null default 0,
  webinar_watched_live_count integer not null default 0,
  webinar_watched_replay_count integer not null default 0,
  first_check_in_at timestamptz,
  latest_stage_change_at timestamptz,
  assessment_submitted_at timestamptz,
  interview_scheduled_at timestamptz,
  rating numeric,
  tags text[] not null default '{}',
  next_step text,
  updated_at timestamptz not null default now()
);

create index if not exists idx_hr_candidate_signals_stage on hr_analytics.hr_candidate_signals (pipeline_stage);
create index if not exists idx_hr_candidate_signals_updated on hr_analytics.hr_candidate_signals (updated_at desc);

-- 2) Readiness score snapshots (versioned explainability)
create table if not exists hr_analytics.hr_readiness_scores (
  id bigserial primary key,
  candidate_id text not null references public.candidates(id) on delete cascade,
  score numeric not null check (score >= 0 and score <= 100),
  band text not null check (band in ('Hot', 'Warm', 'Monitor')),
  component_scores jsonb not null default '{}'::jsonb,
  why text[] not null default '{}',
  model_version text not null default 'v1',
  created_at timestamptz not null default now()
);

create index if not exists idx_hr_readiness_scores_candidate_created
  on hr_analytics.hr_readiness_scores (candidate_id, created_at desc);

-- 3) Risk flags (active + historical)
create table if not exists hr_analytics.hr_risk_flags (
  id bigserial primary key,
  candidate_id text not null references public.candidates(id) on delete cascade,
  risk_type text not null check (risk_type in ('no_show_risk', 'ghost_risk', 'low_conversion_risk')),
  status text not null default 'active' check (status in ('active', 'resolved')),
  confidence numeric not null default 0 check (confidence >= 0 and confidence <= 1),
  reason text not null,
  metadata jsonb not null default '{}'::jsonb,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists idx_hr_risk_flags_candidate_active
  on hr_analytics.hr_risk_flags (candidate_id, status, detected_at desc);

-- 4) Stage SLA config
create table if not exists hr_analytics.hr_stage_sla (
  stage text primary key,
  sla_minutes integer not null check (sla_minutes > 0),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into hr_analytics.hr_stage_sla (stage, sla_minutes)
values
  ('Checked In', 720),
  ('Invited to Live Career Overview Session', 2880),
  ('Live Career Overview Session Attended', 1440),
  ('Leadership assessment form sent', 2880),
  ('Leadership form submitted, awaiting evaluation', 1440),
  ('Evaluation Done', 1440),
  ('Interview scheduled', 4320)
on conflict (stage) do nothing;

-- 5) Task system
create table if not exists hr_analytics.hr_tasks (
  id bigserial primary key,
  candidate_id text not null references public.candidates(id) on delete cascade,
  task_type text not null check (task_type in ('call_now', 'send_reminder', 'evaluate_assessment', 'schedule_interview', 'archive_candidate')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'critical')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'done', 'cancelled')),
  title text not null,
  details text,
  due_at timestamptz,
  owner_email text,
  source text not null default 'system',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_hr_tasks_status_due on hr_analytics.hr_tasks (status, due_at);
create index if not exists idx_hr_tasks_candidate on hr_analytics.hr_tasks (candidate_id, created_at desc);

create table if not exists hr_analytics.hr_task_events (
  id bigserial primary key,
  task_id bigint not null references hr_analytics.hr_tasks(id) on delete cascade,
  event_type text not null check (event_type in ('created', 'claimed', 'status_changed', 'commented', 'completed', 'cancelled')),
  actor_email text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_hr_task_events_task on hr_analytics.hr_task_events (task_id, created_at desc);

-- 6) Stage event stream
create table if not exists hr_analytics.hr_stage_events (
  id bigserial primary key,
  candidate_id text not null references public.candidates(id) on delete cascade,
  stage text not null,
  event_at timestamptz not null default now(),
  source text not null default 'system',
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_hr_stage_events_candidate_time
  on hr_analytics.hr_stage_events (candidate_id, event_at desc);
create index if not exists idx_hr_stage_events_stage_time
  on hr_analytics.hr_stage_events (stage, event_at desc);

-- 7) Broadcast cohort rollup table
create table if not exists hr_analytics.hr_broadcast_cohorts (
  id bigserial primary key,
  cohort_date date not null,
  webinar_id text,
  webinar_title text,
  broadcast_id text,
  invited_count integer not null default 0,
  watched_count integer not null default 0,
  watched_live_count integer not null default 0,
  watched_replay_count integer not null default 0,
  assessment_submitted_count integer not null default 0,
  interview_scheduled_count integer not null default 0,
  hired_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_hr_broadcast_cohorts_date on hr_analytics.hr_broadcast_cohorts (cohort_date desc);
create unique index if not exists idx_hr_broadcast_cohorts_unique
  on hr_analytics.hr_broadcast_cohorts (cohort_date, coalesce(webinar_id, ''), coalesce(broadcast_id, ''));

-- 8) Daily funnel view (materialized for speed)
drop materialized view if exists hr_analytics.hr_funnel_daily;
create materialized view hr_analytics.hr_funnel_daily as
select
  date_trunc('day', c.timestamp::timestamptz)::date as day,
  coalesce((c.admin_data ->> 'pipelineStage'), 'Checked In') as pipeline_stage,
  count(*)::integer as candidates
from public.candidates c
group by 1, 2;

create unique index if not exists idx_hr_funnel_daily_day_stage
  on hr_analytics.hr_funnel_daily (day, pipeline_stage);

-- 9) Helpful operational views
create or replace view hr_analytics.v_hr_latest_readiness as
select distinct on (candidate_id)
  candidate_id, score, band, component_scores, why, model_version, created_at
from hr_analytics.hr_readiness_scores
order by candidate_id, created_at desc;

create or replace view hr_analytics.v_hr_open_tasks as
select *
from hr_analytics.hr_tasks
where status in ('open', 'in_progress');

-- 10) RLS (authenticated/admin app users only)
alter table hr_analytics.hr_candidate_signals enable row level security;
alter table hr_analytics.hr_readiness_scores enable row level security;
alter table hr_analytics.hr_risk_flags enable row level security;
alter table hr_analytics.hr_stage_sla enable row level security;
alter table hr_analytics.hr_tasks enable row level security;
alter table hr_analytics.hr_task_events enable row level security;
alter table hr_analytics.hr_stage_events enable row level security;
alter table hr_analytics.hr_broadcast_cohorts enable row level security;

drop policy if exists hr_candidate_signals_auth_rw on hr_analytics.hr_candidate_signals;
create policy hr_candidate_signals_auth_rw on hr_analytics.hr_candidate_signals
for all to authenticated using (true) with check (true);

drop policy if exists hr_readiness_scores_auth_rw on hr_analytics.hr_readiness_scores;
create policy hr_readiness_scores_auth_rw on hr_analytics.hr_readiness_scores
for all to authenticated using (true) with check (true);

drop policy if exists hr_risk_flags_auth_rw on hr_analytics.hr_risk_flags;
create policy hr_risk_flags_auth_rw on hr_analytics.hr_risk_flags
for all to authenticated using (true) with check (true);

drop policy if exists hr_stage_sla_auth_rw on hr_analytics.hr_stage_sla;
create policy hr_stage_sla_auth_rw on hr_analytics.hr_stage_sla
for all to authenticated using (true) with check (true);

drop policy if exists hr_tasks_auth_rw on hr_analytics.hr_tasks;
create policy hr_tasks_auth_rw on hr_analytics.hr_tasks
for all to authenticated using (true) with check (true);

drop policy if exists hr_task_events_auth_rw on hr_analytics.hr_task_events;
create policy hr_task_events_auth_rw on hr_analytics.hr_task_events
for all to authenticated using (true) with check (true);

drop policy if exists hr_stage_events_auth_rw on hr_analytics.hr_stage_events;
create policy hr_stage_events_auth_rw on hr_analytics.hr_stage_events
for all to authenticated using (true) with check (true);

drop policy if exists hr_broadcast_cohorts_auth_rw on hr_analytics.hr_broadcast_cohorts;
create policy hr_broadcast_cohorts_auth_rw on hr_analytics.hr_broadcast_cohorts
for all to authenticated using (true) with check (true);


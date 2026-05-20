-- Paste this in Supabase SQL Editor (same as migration 20260520_200800_pipeline_wednesday_campaign_runs.sql)

create table if not exists public.pipeline_wednesday_campaign_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  trigger_label text not null default 'manual_wednesday_live_overview',
  source text not null default 'email_log',
  initiated_by_user_id uuid references auth.users(id) on delete set null,
  session_title text not null,
  session_start_at timestamptz not null,
  session_label text not null,
  fetched_invitee_count integer not null default 0,
  selected_count integer not null default 0,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  skipped_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists pipeline_wednesday_campaign_runs_created_idx
  on public.pipeline_wednesday_campaign_runs(created_at desc);

create index if not exists pipeline_wednesday_campaign_runs_trigger_idx
  on public.pipeline_wednesday_campaign_runs(trigger_label, created_at desc);

comment on table public.pipeline_wednesday_campaign_runs is
  'Fetch/send run headers for Wednesday Live Overview campaign from pages/EmailLog.tsx.';

create table if not exists public.pipeline_wednesday_campaign_run_recipients (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.pipeline_wednesday_campaign_runs(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  recipient_key text not null,
  invitee_name text not null,
  invitee_email text not null,
  invitee_status text,
  candidate_id text references public.candidates(id) on delete set null,
  selected boolean not null default true,
  send_status text not null default 'pending',
  sent_at timestamptz,
  error_message text,
  email_send_log_id uuid references public.email_send_logs(id) on delete set null,
  invitee_uri text,
  event_uri text,
  constraint pipeline_wednesday_campaign_run_recipients_send_status_check check (
    send_status in ('pending', 'sent', 'failed', 'skipped')
  ),
  constraint pipeline_wednesday_campaign_run_recipients_run_email_unique unique (run_id, invitee_email)
);

create index if not exists pipeline_wednesday_campaign_run_recipients_run_idx
  on public.pipeline_wednesday_campaign_run_recipients(run_id, created_at asc);

create index if not exists pipeline_wednesday_campaign_run_recipients_status_idx
  on public.pipeline_wednesday_campaign_run_recipients(send_status, created_at desc);

comment on table public.pipeline_wednesday_campaign_run_recipients is
  'Invitee snapshot and per-recipient send status for a Wednesday campaign run.';

alter table public.pipeline_wednesday_campaign_runs enable row level security;
alter table public.pipeline_wednesday_campaign_run_recipients enable row level security;

drop policy if exists pipeline_wednesday_campaign_runs_auth_rw on public.pipeline_wednesday_campaign_runs;
create policy pipeline_wednesday_campaign_runs_auth_rw on public.pipeline_wednesday_campaign_runs
for all to authenticated using (true) with check (true);

drop policy if exists pipeline_wednesday_campaign_run_recipients_auth_rw on public.pipeline_wednesday_campaign_run_recipients;
create policy pipeline_wednesday_campaign_run_recipients_auth_rw on public.pipeline_wednesday_campaign_run_recipients
for all to authenticated using (true) with check (true);

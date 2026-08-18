-- Paste in clone Supabase SQL editor if migrations are not pushed.
-- Same as supabase/migrations/20260817_120000_hiring_machine_instantly.sql

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
        'Booked',
        'Send to AO Hub'
      )
    );
end$$;

create table if not exists public.hm_people (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  full_name text,
  phone text,
  extracted_email text,
  extracted_phone text,
  instantly_lead_id text,
  campaign_id text,
  campaign_name text,
  instantly_email_id text,
  instantly_email_account text,
  unibox_url text,
  reply_snippet text,
  last_reply_text text,
  last_reply_subject text,
  stage text not null default 'replied'
    check (stage in (
      'replied',
      'shortlisted',
      'call_ready',
      'called',
      'sent_to_hub',
      'not_interested',
      'ooo'
    )),
  positive_source text
    check (positive_source is null or positive_source in ('instantly', 'groq')),
  instantly_interested_at timestamptz,
  groq_positive_at timestamptz,
  ai_summary text,
  ai_score integer,
  ai_recommendation text,
  ai_raw jsonb not null default '{}'::jsonb,
  qualify_status text not null default 'none'
    check (qualify_status in ('none', 'pending', 'claimed', 'done', 'failed', 'skipped')),
  qualify_claimed_at timestamptz,
  qualify_error text,
  shortlisted_email_sent_at timestamptz,
  sent_to_hub_at timestamptz,
  last_called_at timestamptz,
  pipeline_candidate_id uuid references public.pipeline_candidates(id) on delete set null,
  raw_lead jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists hm_people_email_unique
  on public.hm_people (lower(email));

create index if not exists hm_people_stage_idx
  on public.hm_people (stage, updated_at desc);

create index if not exists hm_people_qualify_idx
  on public.hm_people (qualify_status, qualify_claimed_at);

create index if not exists hm_people_pipeline_candidate_idx
  on public.hm_people (pipeline_candidate_id);

create table if not exists public.hm_instantly_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  lead_email text,
  campaign_id text,
  campaign_name text,
  event_timestamp timestamptz,
  instantly_email_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists hm_instantly_events_dedupe_idx
  on public.hm_instantly_events (
    event_type,
    coalesce(lead_email, ''),
    coalesce(event_timestamp, '1970-01-01'::timestamptz),
    coalesce(campaign_id, ''),
    coalesce(instantly_email_id, '')
  );

create index if not exists hm_instantly_events_created_idx
  on public.hm_instantly_events (created_at desc);

create table if not exists public.hm_email_sends (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.hm_people(id) on delete cascade,
  template_key text not null check (template_key in ('shortlisted', 'ao_hub')),
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed', 'cancelled')),
  instantly_reply_id text,
  reply_to_uuid text,
  error text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index if not exists hm_email_sends_person_template_active_idx
  on public.hm_email_sends (person_id, template_key)
  where status in ('pending', 'sending', 'sent');

create index if not exists hm_email_sends_status_idx
  on public.hm_email_sends (status, created_at);

create table if not exists public.hm_metrics_cache (
  cache_key text primary key,
  payload jsonb not null default '{}'::jsonb,
  pulled_at timestamptz not null default now()
);

create table if not exists public.hm_rate_locks (
  lock_key text primary key,
  last_ran_at timestamptz not null default now()
);

alter table public.hm_people enable row level security;
alter table public.hm_instantly_events enable row level security;
alter table public.hm_email_sends enable row level security;
alter table public.hm_metrics_cache enable row level security;
alter table public.hm_rate_locks enable row level security;

drop policy if exists hm_people_auth_select on public.hm_people;
create policy hm_people_auth_select on public.hm_people
for select to authenticated using (true);

drop policy if exists hm_people_auth_update on public.hm_people;
create policy hm_people_auth_update on public.hm_people
for update to authenticated using (true) with check (true);

drop policy if exists hm_events_auth_select on public.hm_instantly_events;
create policy hm_events_auth_select on public.hm_instantly_events
for select to authenticated using (true);

drop policy if exists hm_email_sends_auth_select on public.hm_email_sends;
create policy hm_email_sends_auth_select on public.hm_email_sends
for select to authenticated using (true);

drop policy if exists hm_metrics_auth_select on public.hm_metrics_cache;
create policy hm_metrics_auth_select on public.hm_metrics_cache
for select to authenticated using (true);

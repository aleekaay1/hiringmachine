-- Hiring Machine: bulk mass email campaigns (SMTP paced sends, 500/day per from-address).

create table if not exists public.hm_bulk_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Bulk campaign',
  subject text not null,
  body_text text not null default '',
  body_html text,
  status text not null default 'draft'
    check (status in (
      'draft',
      'queued',
      'sending',
      'paused',
      'completed',
      'cancelled',
      'failed'
    )),
  gap_seconds integer not null default 60 check (gap_seconds >= 5 and gap_seconds <= 3600),
  daily_cap integer not null default 500 check (daily_cap >= 1 and daily_cap <= 500),
  from_email text,
  provider text not null default 'smtp'
    check (provider in ('smtp', 'instantly', 'apollo', 'billionmail')),
  settings jsonb not null default '{}'::jsonb,
  total_count integer not null default 0,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  last_error text
);

create index if not exists hm_bulk_campaigns_status_idx
  on public.hm_bulk_campaigns (status, updated_at desc);

create index if not exists hm_bulk_campaigns_created_idx
  on public.hm_bulk_campaigns (created_at desc);

create table if not exists public.hm_bulk_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.hm_bulk_campaigns(id) on delete cascade,
  full_name text,
  email text not null,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  error text,
  row_index integer,
  raw jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists hm_bulk_recipients_campaign_email_uidx
  on public.hm_bulk_recipients (campaign_id, lower(email));

create index if not exists hm_bulk_recipients_campaign_status_idx
  on public.hm_bulk_recipients (campaign_id, status, created_at);

create table if not exists public.hm_bulk_daily_counts (
  send_date date not null,
  from_email text not null,
  sent_count integer not null default 0 check (sent_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (send_date, from_email)
);

create table if not exists public.hm_bulk_app_settings (
  id integer primary key default 1 check (id = 1),
  gap_seconds integer not null default 60 check (gap_seconds >= 5 and gap_seconds <= 3600),
  daily_cap integer not null default 500 check (daily_cap >= 1 and daily_cap <= 500),
  default_provider text not null default 'smtp'
    check (default_provider in ('smtp', 'instantly', 'apollo', 'billionmail')),
  smtp jsonb not null default '{}'::jsonb,
  instantly jsonb not null default '{}'::jsonb,
  apollo jsonb not null default '{}'::jsonb,
  billionmail jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.hm_bulk_app_settings (id)
values (1)
on conflict (id) do nothing;

alter table public.hm_bulk_campaigns enable row level security;
alter table public.hm_bulk_recipients enable row level security;
alter table public.hm_bulk_daily_counts enable row level security;
alter table public.hm_bulk_app_settings enable row level security;

drop policy if exists hm_bulk_campaigns_auth_all on public.hm_bulk_campaigns;
create policy hm_bulk_campaigns_auth_all on public.hm_bulk_campaigns
for all to authenticated using (true) with check (true);

drop policy if exists hm_bulk_recipients_auth_all on public.hm_bulk_recipients;
create policy hm_bulk_recipients_auth_all on public.hm_bulk_recipients
for all to authenticated using (true) with check (true);

drop policy if exists hm_bulk_daily_counts_auth_select on public.hm_bulk_daily_counts;
create policy hm_bulk_daily_counts_auth_select on public.hm_bulk_daily_counts
for select to authenticated using (true);

drop policy if exists hm_bulk_app_settings_auth_all on public.hm_bulk_app_settings;
create policy hm_bulk_app_settings_auth_all on public.hm_bulk_app_settings
for all to authenticated using (true) with check (true);

comment on table public.hm_bulk_campaigns is 'Bulk mass-email campaigns (SMTP paced).';
comment on table public.hm_bulk_recipients is 'Recipients for hm_bulk_campaigns.';
comment on table public.hm_bulk_daily_counts is 'Per from-address daily send counters (cap 500).';
comment on table public.hm_bulk_app_settings is 'Bulk email defaults + Instantly/Apollo/BillionMail settings.';

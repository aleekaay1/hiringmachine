-- Persist bulk email HTML template + draft uploaded leads across refreshes.

alter table public.hm_bulk_app_settings
  add column if not exists template_subject text,
  add column if not exists template_body text,
  add column if not exists draft_campaign_name text,
  add column if not exists draft_from_email text,
  add column if not exists draft_source_file text,
  add column if not exists draft_name_column text,
  add column if not exists draft_email_column text,
  add column if not exists draft_gap_seconds integer,
  add column if not exists draft_daily_cap integer;

create table if not exists public.hm_bulk_draft_leads (
  id uuid primary key default gen_random_uuid(),
  full_name text,
  email text not null,
  row_index integer,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists hm_bulk_draft_leads_email_uidx
  on public.hm_bulk_draft_leads (lower(email));

create index if not exists hm_bulk_draft_leads_created_idx
  on public.hm_bulk_draft_leads (created_at);

alter table public.hm_bulk_draft_leads enable row level security;

drop policy if exists hm_bulk_draft_leads_auth_all on public.hm_bulk_draft_leads;
create policy hm_bulk_draft_leads_auth_all on public.hm_bulk_draft_leads
for all to authenticated using (true) with check (true);

comment on table public.hm_bulk_draft_leads is 'Uploaded bulk-email leads staged before a campaign starts.';
comment on column public.hm_bulk_app_settings.template_body is 'Saved compose body (HTML or plain text) exactly as entered.';

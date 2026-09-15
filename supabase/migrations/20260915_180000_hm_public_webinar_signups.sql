-- Public /schedule-webinar form submissions (cold-email self-schedule).

create table if not exists public.hm_public_webinar_signups (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  first_name text not null,
  last_name text,
  email text not null,
  phone text,
  schedule_mode text not null default 'pick'
    check (schedule_mode in ('pick', 'quick')),
  session_at timestamptz,
  session_label text,
  broadcast_id text,
  webinar_id text,
  wg_subscription_id text,
  already_registered boolean not null default false,
  email_verified boolean,
  watch_link text,
  confirmation_link text,
  custom_field text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists hm_public_webinar_signups_created_at_idx
  on public.hm_public_webinar_signups (created_at desc);

create index if not exists hm_public_webinar_signups_email_idx
  on public.hm_public_webinar_signups (lower(trim(email)));

create index if not exists hm_public_webinar_signups_session_at_idx
  on public.hm_public_webinar_signups (session_at desc nulls last);

alter table public.hm_public_webinar_signups enable row level security;

drop policy if exists hm_public_webinar_signups_select on public.hm_public_webinar_signups;
create policy hm_public_webinar_signups_select
on public.hm_public_webinar_signups
for select
to authenticated
using (true);

grant select on public.hm_public_webinar_signups to authenticated;
-- Inserts only from Edge (service role); no public/anon insert grant.

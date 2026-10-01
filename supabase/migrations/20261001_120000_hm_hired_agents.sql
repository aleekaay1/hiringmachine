-- Hired agents: onboarding emails, public signature card, portal invite.

create table if not exists public.hm_hired_agents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  hired_at timestamptz not null default now(),
  hired_by uuid,
  source text not null default 'manual'
    check (source in ('signup', 'pipeline', 'manual')),
  signup_id uuid,
  person_id uuid,
  full_name text not null,
  email text not null,
  portal_email text,
  title text not null default 'Life Insurance Producer',
  team_line text not null default 'AO Globe Life - Team Paz',
  tagline text not null default 'AO Let''s Grow - Make Tomorrow Better',
  office_phone text,
  office_ext text,
  direct_phone text,
  address text not null default '59-700 Third Line, Oakville, ON. L6L 4B1',
  website_url text not null default 'https://globelife-paz.com',
  contact_slug text not null,
  portal_user_id uuid,
  welcome_html text,
  welcome_sent_at timestamptz,
  signature_sent_at timestamptz,
  invite_sent_at timestamptz,
  last_error text
);

create unique index if not exists hm_hired_agents_email_uidx
  on public.hm_hired_agents (lower(trim(email)));
create unique index if not exists hm_hired_agents_slug_uidx
  on public.hm_hired_agents (contact_slug);
create index if not exists hm_hired_agents_hired_at_idx
  on public.hm_hired_agents (hired_at desc);

alter table public.hm_hired_agents enable row level security;

drop policy if exists hm_hired_agents_select on public.hm_hired_agents;
create policy hm_hired_agents_select
on public.hm_hired_agents
for select
to authenticated
using (true);

grant select on public.hm_hired_agents to authenticated;

comment on table public.hm_hired_agents is
  'Agents marked hired; drives welcome email, signature card, and portal invite.';

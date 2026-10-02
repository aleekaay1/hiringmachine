-- Hired agents get a public Agent ID and a portal login flagged separately from staff.

alter table public.hm_hired_agents
  add column if not exists agent_code text;

create unique index if not exists hm_hired_agents_agent_code_uidx
  on public.hm_hired_agents (agent_code)
  where agent_code is not null;

alter table public.user_profiles
  add column if not exists hired_agent_id uuid references public.hm_hired_agents (id) on delete set null,
  add column if not exists agent_code text;

create index if not exists user_profiles_hired_agent_id_idx
  on public.user_profiles (hired_agent_id)
  where hired_agent_id is not null;

comment on column public.hm_hired_agents.agent_code is
  'Public Agent ID assigned when a candidate is marked hired (e.g. PAZ-XXXXXXXX).';
comment on column public.user_profiles.hired_agent_id is
  'When set, this login is a hired agent portal (empty workspace), not staff hiring tools.';
comment on column public.user_profiles.agent_code is
  'Copy of hired Agent ID for display in the agent portal.';

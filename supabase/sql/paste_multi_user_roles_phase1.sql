-- Paste in Supabase SQL Editor
-- Same as migration: 20260529_220800_multi_user_roles_phase1.sql

-- IMPORTANT:
-- If your existing enum does not have "leadership" yet, run:
--   supabase/sql/paste_multi_user_roles_phase1_step1_enum.sql
-- first, then run this file.
do $$
begin
  if not exists (
    select 1
    from pg_type t
    where t.typnamespace = 'public'::regnamespace
      and t.typname = 'app_role'
  ) then
    create type public.app_role as enum ('admin', 'leadership', 'recruiter', 'webinar', 'hr', 'viewer');
  elsif not exists (
    select 1
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    where t.typnamespace = 'public'::regnamespace
      and t.typname = 'app_role'
      and e.enumlabel = 'leadership'
  ) then
    raise exception 'Enum value leadership is missing. Run paste_multi_user_roles_phase1_step1_enum.sql first, then rerun this file.';
  end if;
end
$$;

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role public.app_role not null default 'viewer',
  points integer not null default 0,
  points_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_profiles
  add column if not exists points integer not null default 0,
  add column if not exists points_updated_at timestamptz;

create index if not exists user_profiles_role_idx on public.user_profiles(role);
create index if not exists user_profiles_email_lower_idx on public.user_profiles(lower(email));

update public.user_profiles
set
  points = coalesce(points, 0),
  points_updated_at = coalesce(points_updated_at, updated_at, created_at, now());

create or replace function public.current_user_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select up.role
  from public.user_profiles up
  where up.user_id = auth.uid()
  limit 1
$$;

grant execute on function public.current_user_app_role() to authenticated;

alter table public.user_profiles enable row level security;

drop policy if exists user_profiles_admin_leadership_select on public.user_profiles;
create policy user_profiles_admin_leadership_select
on public.user_profiles
for select
to authenticated
using (
  auth.uid() = user_id
  or public.current_user_app_role() in ('admin', 'leadership')
);

create table if not exists public.user_profile_hierarchy (
  leader_user_id uuid not null references auth.users(id) on delete cascade,
  member_user_id uuid not null references auth.users(id) on delete cascade,
  relationship_role text not null default 'manager',
  created_at timestamptz not null default now(),
  primary key (leader_user_id, member_user_id),
  constraint user_profile_hierarchy_no_self check (leader_user_id <> member_user_id)
);

create index if not exists user_profile_hierarchy_member_idx
  on public.user_profile_hierarchy(member_user_id);

alter table public.user_profile_hierarchy enable row level security;

drop policy if exists user_profile_hierarchy_select on public.user_profile_hierarchy;
create policy user_profile_hierarchy_select
on public.user_profile_hierarchy
for select
to authenticated
using (
  auth.uid() = leader_user_id
  or auth.uid() = member_user_id
  or public.current_user_app_role() in ('admin', 'leadership')
);

drop policy if exists user_profile_hierarchy_write on public.user_profile_hierarchy;
create policy user_profile_hierarchy_write
on public.user_profile_hierarchy
for all
to authenticated
using (public.current_user_app_role() in ('admin', 'leadership'))
with check (public.current_user_app_role() in ('admin', 'leadership'));

insert into public.role_permissions (role, permission_key)
values
  ('leadership', 'all'),
  ('recruiter', 'view_pipeline'),
  ('recruiter', 'view_pipeline_settings'),
  ('recruiter', 'view_calls_analytics'),
  ('recruiter', 'view_webinar_geek'),
  ('recruiter', 'view_settings')
on conflict do nothing;

with mapped(email, role) as (
  values
    ('ali@globelife-paz.com', 'admin'::public.app_role),
    ('alex@globelife-paz.com', 'admin'::public.app_role),
    ('reginald_bentajado@globelife-paz.com', 'admin'::public.app_role),
    ('hr.licensing@globelife-paz.com', 'admin'::public.app_role),
    ('akram@globelife-paz.com', 'leadership'::public.app_role),
    ('walid@globelife-paz.com', 'leadership'::public.app_role),
    ('nicolas@globelife-paz.com', 'leadership'::public.app_role),
    ('nita@globelife-paz.com', 'leadership'::public.app_role),
    ('raman@globelife-paz.com', 'leadership'::public.app_role),
    ('devanshi@globelife-paz.com', 'leadership'::public.app_role),
    ('emilio@globelife-paz.com', 'leadership'::public.app_role),
    ('gamar_baghirli@globelife-paz.com', 'recruiter'::public.app_role),
    ('herlyn_desingano@globelife-paz.com', 'recruiter'::public.app_role),
    ('hasaan_khalid@globelife-paz.com', 'recruiter'::public.app_role),
    ('jonalyn_manuel@globelife-paz.com', 'recruiter'::public.app_role)
),
auth_seed as (
  select
    au.id as user_id,
    lower(au.email) as email,
    coalesce(au.raw_user_meta_data ->> 'full_name', au.raw_user_meta_data ->> 'name') as full_name,
    m.role
  from auth.users au
  join mapped m on lower(au.email) = m.email
)
insert into public.user_profiles (user_id, email, full_name, role, points, points_updated_at)
select
  a.user_id,
  a.email,
  a.full_name,
  a.role,
  0,
  coalesce(now(), now())
from auth_seed a
on conflict (user_id) do update
set
  email = excluded.email,
  full_name = coalesce(excluded.full_name, public.user_profiles.full_name),
  role = excluded.role,
  updated_at = now();

with mapped(email, role) as (
  values
    ('ali@globelife-paz.com', 'admin'::public.app_role),
    ('alex@globelife-paz.com', 'admin'::public.app_role),
    ('reginald_bentajado@globelife-paz.com', 'admin'::public.app_role),
    ('hr.licensing@globelife-paz.com', 'admin'::public.app_role),
    ('akram@globelife-paz.com', 'leadership'::public.app_role),
    ('walid@globelife-paz.com', 'leadership'::public.app_role),
    ('nicolas@globelife-paz.com', 'leadership'::public.app_role),
    ('nita@globelife-paz.com', 'leadership'::public.app_role),
    ('raman@globelife-paz.com', 'leadership'::public.app_role),
    ('devanshi@globelife-paz.com', 'leadership'::public.app_role),
    ('emilio@globelife-paz.com', 'leadership'::public.app_role),
    ('gamar_baghirli@globelife-paz.com', 'recruiter'::public.app_role),
    ('herlyn_desingano@globelife-paz.com', 'recruiter'::public.app_role),
    ('hasaan_khalid@globelife-paz.com', 'recruiter'::public.app_role),
    ('jonalyn_manuel@globelife-paz.com', 'recruiter'::public.app_role)
)
update public.user_profiles up
set
  role = m.role,
  updated_at = now()
from mapped m
where lower(coalesce(up.email, '')) = m.email
  and up.role is distinct from m.role;

do $$
begin
  if to_regclass('public.pipeline_user_call_settings') is not null then
    execute 'drop policy if exists pipeline_user_call_settings_select on public.pipeline_user_call_settings';
    execute $policy$
      create policy pipeline_user_call_settings_select
      on public.pipeline_user_call_settings
      for select
      to authenticated
      using (
        auth.uid() = user_id
        or public.current_user_app_role() in ('admin', 'leadership')
      )
    $policy$;
  end if;
end
$$;

-- Hierarchy seeds intentionally deferred until leadership provides MGA/RGA tree.

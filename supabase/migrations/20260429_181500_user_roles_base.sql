-- Base role model for CRM users.
-- Works with Supabase Auth users (email/password or Google SSO).

create type public.app_role as enum ('admin', 'recruiter', 'webinar', 'hr', 'viewer');

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role public.app_role not null default 'viewer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.role_permissions (
  role public.app_role not null,
  permission_key text not null,
  created_at timestamptz not null default now(),
  primary key (role, permission_key)
);

insert into public.role_permissions (role, permission_key)
values
  ('admin', 'all'),
  ('recruiter', 'view_candidates'),
  ('recruiter', 'edit_candidates'),
  ('recruiter', 'view_live_sessions'),
  ('webinar', 'view_webinar'),
  ('webinar', 'edit_webinar'),
  ('hr', 'view_candidates'),
  ('hr', 'edit_candidates'),
  ('hr', 'view_hr_dashboard'),
  ('viewer', 'view_overview')
on conflict do nothing;

alter table public.user_profiles enable row level security;
alter table public.role_permissions enable row level security;

create policy "users can view their profile"
on public.user_profiles
for select
to authenticated
using (auth.uid() = user_id);

create policy "users can update their profile basics"
on public.user_profiles
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "role permissions readable by authenticated users"
on public.role_permissions
for select
to authenticated
using (true);

create or replace function public.set_user_profile_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_user_profiles_updated_at on public.user_profiles;
create trigger trg_user_profiles_updated_at
before update on public.user_profiles
for each row
execute function public.set_user_profile_updated_at();

create or replace function public.handle_new_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (user_id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    'viewer'
  )
  on conflict (user_id) do update
  set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, public.user_profiles.full_name);
  return new;
end;
$$;

drop trigger if exists trg_on_auth_user_created_profile on auth.users;
create trigger trg_on_auth_user_created_profile
after insert on auth.users
for each row
execute function public.handle_new_auth_user_profile();

create or replace view public.user_profiles_with_permissions as
select
  up.user_id,
  up.email,
  up.full_name,
  up.role,
  array_remove(array_agg(rp.permission_key), null) as permissions
from public.user_profiles up
left join public.role_permissions rp on rp.role = up.role
group by up.user_id, up.email, up.full_name, up.role;

-- Paste in Supabase SQL Editor AFTER creating the Auth user:
--   alex@globelife-paz.com  →  admin
--
-- Authentication → Users → Add user (email + password or invite).
-- Then run this whole script.

with mapped(email, full_name, role) as (
  values
    ('alex@globelife-paz.com', 'Alex', 'admin'::public.app_role)
),
auth_seed as (
  select
    au.id as user_id,
    lower(au.email) as email,
    coalesce(
      nullif(trim(au.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(au.raw_user_meta_data ->> 'name'), ''),
      m.full_name
    ) as full_name,
    m.role
  from auth.users au
  inner join mapped m on lower(au.email) = m.email
)
insert into public.user_profiles (user_id, email, full_name, role, points, points_updated_at)
select
  s.user_id,
  s.email,
  s.full_name,
  s.role,
  0,
  now()
from auth_seed s
on conflict (user_id) do update
set
  email = excluded.email,
  full_name = coalesce(excluded.full_name, public.user_profiles.full_name),
  role = excluded.role,
  updated_at = now();

-- Optional: mirror role into JWT metadata (fallback if profile read fails)
update auth.users au
set
  raw_user_meta_data =
    coalesce(au.raw_user_meta_data, '{}'::jsonb)
    || jsonb_build_object('role', 'admin', 'full_name', coalesce(au.raw_user_meta_data ->> 'full_name', au.raw_user_meta_data ->> 'name', 'Alex')),
  raw_app_meta_data =
    coalesce(au.raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('role', 'admin')
where lower(au.email) = 'alex@globelife-paz.com';

select up.email, up.full_name, up.role, up.updated_at
from public.user_profiles up
where lower(up.email) = 'alex@globelife-paz.com';

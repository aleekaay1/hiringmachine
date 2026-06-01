-- Paste in Supabase SQL Editor AFTER you create Auth users (Authentication → Users → Add user).
--
-- Suggested demo accounts (use the exact same emails in Auth):
--   demo-admin@globelife-paz.com      → admin
--   demo-leadership@globelife-paz.com → leadership  (app role name; not "leaders")
--
-- Your existing recruiter account: only run the block for that email if you need to re-assign role.
--
-- Verify:
--   select email, full_name, role from public.user_profiles
--   where lower(email) like 'demo-%@globelife-paz.com';

with demo_accounts(email, full_name, role) as (
  values
    ('demo-admin@globelife-paz.com', 'Demo Admin', 'admin'::public.app_role),
    ('demo-leadership@globelife-paz.com', 'Demo Leadership', 'leadership'::public.app_role)
    -- ('your-recruiter@globelife-paz.com', 'Demo Recruiter', 'recruiter'::public.app_role)
),
auth_seed as (
  select
    au.id as user_id,
    lower(au.email) as email,
    coalesce(
      nullif(trim(au.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(au.raw_user_meta_data ->> 'name'), ''),
      d.full_name
    ) as full_name,
    d.role
  from auth.users au
  inner join demo_accounts d on lower(au.email) = d.email
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
    || jsonb_build_object('role', m.role, 'full_name', m.full_name),
  raw_app_meta_data =
    coalesce(au.raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('role', m.role)
from (
  values
    ('demo-admin@globelife-paz.com', 'Demo Admin', 'admin'),
    ('demo-leadership@globelife-paz.com', 'Demo Leadership', 'leadership')
) as m(email, full_name, role)
where lower(au.email) = m.email;

select up.email, up.full_name, up.role, up.updated_at
from public.user_profiles up
where lower(up.email) in (
  'demo-admin@globelife-paz.com',
  'demo-leadership@globelife-paz.com'
)
order by up.role, up.email;

-- Remove demo training accounts from the portal (leaderboard, reports, staff lists).
--
-- Recommended: also delete the Auth user in Supabase Dashboard:
--   Authentication → Users → search demo-leadership / demo-admin → Delete user
--
-- This script removes their profile row and demotes any leftover JWT metadata.

delete from public.user_profiles
where lower(email) in (
  'demo-leadership@globelife-paz.com',
  'demo-admin@globelife-paz.com'
)
or lower(email) like 'demo-%@globelife-paz.com';

update auth.users au
set
  raw_user_meta_data = coalesce(au.raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'viewer'),
  raw_app_meta_data = coalesce(au.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'viewer')
where lower(au.email) like 'demo-%@globelife-paz.com';

select email, full_name, role
from public.user_profiles
where lower(email) like 'demo-%@globelife-paz.com';

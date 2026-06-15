-- Raman Kumar — recruiter call workspace access
-- Portal email: raman_kumar@globelife-paz.com | 3CX ext: 5908
-- Run once in Supabase → SQL Editor
--
-- PREREQ (if migrating from raman@globelife-paz.com):
--   Raman signs in once with raman_kumar@globelife-paz.com first (creates auth row).
-- After running: log out and back in with raman_kumar@globelife-paz.com

-- 0) See what exists today
select
  au.id as auth_user_id,
  au.email as auth_email,
  up.full_name,
  up.role,
  up.extension,
  pcs.extension as call_settings_extension
from auth.users au
left join public.user_profiles up on up.user_id = au.id
left join public.pipeline_user_call_settings pcs on pcs.user_id = au.id
where lower(au.email) in ('raman@globelife-paz.com', 'raman_kumar@globelife-paz.com')
order by au.email;

-- 1) If he only has the OLD auth email, just rename + grant recruiter access
update public.user_profiles
set
  email = 'raman_kumar@globelife-paz.com',
  full_name = coalesce(nullif(trim(full_name), ''), 'Raman Kumar'),
  role = 'recruiter'::public.app_role,
  extension = '5908',
  updated_at = now()
where lower(trim(coalesce(email, ''))) = 'raman@globelife-paz.com';

update auth.users
set
  email = 'raman_kumar@globelife-paz.com',
  raw_user_meta_data =
    coalesce(raw_user_meta_data, '{}'::jsonb)
    || jsonb_build_object('role', 'recruiter', 'full_name', 'Raman Kumar'),
  raw_app_meta_data =
    coalesce(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('role', 'recruiter')
where lower(email) = 'raman@globelife-paz.com'
  and not exists (
    select 1 from auth.users u2 where lower(u2.email) = 'raman_kumar@globelife-paz.com'
  );

-- 2) Ensure profile on the NEW email (new sign-in or after rename above)
insert into public.user_profiles (user_id, email, full_name, role, extension, points, points_updated_at, updated_at)
select
  au.id,
  'raman_kumar@globelife-paz.com',
  'Raman Kumar',
  'recruiter'::public.app_role,
  '5908',
  0,
  now(),
  now()
from auth.users au
where lower(au.email) = 'raman_kumar@globelife-paz.com'
on conflict (user_id) do update
set
  email = 'raman_kumar@globelife-paz.com',
  full_name = coalesce(nullif(trim(excluded.full_name), ''), 'Raman Kumar'),
  role = 'recruiter'::public.app_role,
  extension = '5908',
  updated_at = now();

update auth.users
set
  raw_user_meta_data =
    coalesce(raw_user_meta_data, '{}'::jsonb)
    || jsonb_build_object('role', 'recruiter', 'full_name', 'Raman Kumar'),
  raw_app_meta_data =
    coalesce(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('role', 'recruiter')
where lower(email) = 'raman_kumar@globelife-paz.com';

-- 3) Call workspace settings (extension + Canada dialing)
insert into public.pipeline_user_call_settings (user_id, extension, dialing_locale, updated_at)
select up.user_id, '5908', 'ca', now()
from public.user_profiles up
where lower(trim(coalesce(up.email, ''))) = 'raman_kumar@globelife-paz.com'
on conflict (user_id) do update
set
  extension = excluded.extension,
  dialing_locale = excluded.dialing_locale,
  updated_at = now();

-- 4) Optional: migrate history if BOTH old + new auth users exist (same pattern as Nita/ Nicolas)
-- Uncomment and run ONLY when step 0 shows two different auth_user_id rows.
/*
do $$
declare
  old_id uuid;
  new_id uuid;
begin
  select id into old_id from auth.users where lower(email) = 'raman@globelife-paz.com' limit 1;
  select id into new_id from auth.users where lower(email) = 'raman_kumar@globelife-paz.com' limit 1;
  if old_id is null or new_id is null or old_id = new_id then
    raise notice 'Skip merge — need two distinct auth users';
    return;
  end if;
  update public.pipeline_call_records set recruiter_user_id = new_id where recruiter_user_id = old_id;
  update public.pipeline_call_logs set created_by_user_id = new_id where created_by_user_id = old_id;
  update public.pipeline_candidates set uploader_user_id = new_id where uploader_user_id = old_id;
  update public.pipeline_candidates set assigned_to_user_id = new_id where assigned_to_user_id = old_id;
  delete from public.user_profiles where user_id = old_id;
  delete from auth.users where id = old_id;
end $$;
*/

-- 5) Verify
select
  au.id,
  au.email,
  up.full_name,
  up.role,
  up.extension,
  pcs.extension as call_settings_extension,
  pcs.dialing_locale
from auth.users au
join public.user_profiles up on up.user_id = au.id
left join public.pipeline_user_call_settings pcs on pcs.user_id = au.id
where lower(au.email) = 'raman_kumar@globelife-paz.com';

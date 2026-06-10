-- Paste in Supabase SQL Editor (Dashboard → SQL)
-- Move Nicolas Demers from nicolas@globelife-paz.com → nicolas_demers@globelife-paz.com
-- Keeps leadership role, points, pipeline history, dashboard data, etc.
--
-- PREREQ: Nicolas has already signed in once with nicolas_demers@globelife-paz.com
-- (that creates the new auth.users row — usually as "viewer").
--
-- After running: have Nicolas log out and log back in with nicolas_demers@globelife-paz.com

do $$
declare
  old_id uuid;
  new_id uuid;
  old_role public.app_role;
  old_points int;
  old_full_name text;
begin
  select id into old_id
  from auth.users
  where lower(email) = 'nicolas@globelife-paz.com'
  limit 1;

  select id into new_id
  from auth.users
  where lower(email) = 'nicolas_demers@globelife-paz.com'
  limit 1;

  if old_id is null then
    raise exception 'Old account not found: nicolas@globelife-paz.com';
  end if;
  if new_id is null then
    raise exception 'New account not found: nicolas_demers@globelife-paz.com — have Nicolas sign in once first';
  end if;
  if old_id = new_id then
    raise exception 'Old and new accounts are the same user_id — nothing to migrate';
  end if;

  select role, points, full_name
  into old_role, old_points, old_full_name
  from public.user_profiles
  where user_id = old_id;

  if old_role is null then
    old_role := 'leadership'::public.app_role;
  end if;

  -- Ensure new profile row exists, then copy role/points/name from old account
  insert into public.user_profiles (user_id, email, full_name, role, points, points_updated_at)
  values (
    new_id,
    'nicolas_demers@globelife-paz.com',
    coalesce(old_full_name, 'Nicolas Demers'),
    old_role,
    coalesce(old_points, 0),
    now()
  )
  on conflict (user_id) do update
  set
    email = 'nicolas_demers@globelife-paz.com',
    full_name = coalesce(old_full_name, excluded.full_name, 'Nicolas Demers'),
    role = old_role,
    points = coalesce(old_points, public.user_profiles.points, 0),
    points_updated_at = coalesce(public.user_profiles.points_updated_at, now()),
    updated_at = now();

  -- Re-point user-owned rows (delete empty new rows first when PK = user_id)
  delete from public.user_home_dashboard_snapshots where user_id = new_id;
  update public.user_home_dashboard_snapshots set user_id = new_id where user_id = old_id;

  delete from public.pipeline_user_call_settings where user_id = new_id;
  update public.pipeline_user_call_settings set user_id = new_id where user_id = old_id;

  delete from public.webinar_geek_user_booking_identities where user_id = new_id;
  update public.webinar_geek_user_booking_identities set user_id = new_id where user_id = old_id;

  update public.recruiter_coin_ledger set user_id = new_id where user_id = old_id;
  update public.user_dashboard_day_notes set user_id = new_id where user_id = old_id;
  update public.user_dashboard_sticky_notes set user_id = new_id where user_id = old_id;

  update public.pipeline_candidates set uploader_user_id = new_id where uploader_user_id = old_id;
  update public.pipeline_candidates set assigned_to_user_id = new_id where assigned_to_user_id = old_id;
  update public.pipeline_candidates set assigned_by_user_id = new_id where assigned_by_user_id = old_id;

  update public.pipeline_notes set author_user_id = new_id where author_user_id = old_id;
  update public.pipeline_evaluations set created_by_user_id = new_id where created_by_user_id = old_id;
  update public.pipeline_call_logs set created_by_user_id = new_id where created_by_user_id = old_id;
  update public.pipeline_call_records set recruiter_user_id = new_id where recruiter_user_id = old_id;
  update public.email_send_logs set sent_by_user_id = new_id where sent_by_user_id = old_id;
  update public.pipeline_wednesday_campaign_runs set initiated_by_user_id = new_id where initiated_by_user_id = old_id;

  update public.pipeline_lead_batches set created_by_user_id = new_id where created_by_user_id = old_id;

  update public.user_profile_hierarchy set leader_user_id = new_id where leader_user_id = old_id;
  update public.user_profile_hierarchy set member_user_id = new_id where member_user_id = old_id;

  update public.support_tickets set user_id = new_id where user_id = old_id;
  update public.support_ticket_events set actor_user_id = new_id where actor_user_id = old_id;
  update public.ops_health_snapshots set captured_by_user_id = new_id where captured_by_user_id = old_id;
  update public.webinar_geek_portal_bookings set booked_by_user_id = new_id where booked_by_user_id = old_id;

  -- JWT metadata fallback on new auth user
  update auth.users
  set
    raw_user_meta_data =
      coalesce(raw_user_meta_data, '{}'::jsonb)
      || jsonb_build_object(
        'role', old_role::text,
        'full_name', coalesce(old_full_name, raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'name', 'Nicolas Demers')
      ),
    raw_app_meta_data =
      coalesce(raw_app_meta_data, '{}'::jsonb)
      || jsonb_build_object('role', old_role::text)
  where id = new_id;

  -- Remove old profile + auth account (history already moved to new_id)
  delete from public.user_profiles where user_id = old_id;
  delete from auth.users where id = old_id;

  raise notice 'Migrated Nicolas Demers: % → % (role: %)', old_id, new_id, old_role;
end $$;

-- Verify
select
  au.id,
  au.email,
  up.full_name,
  up.role,
  up.points,
  up.updated_at
from auth.users au
join public.user_profiles up on up.user_id = au.id
where lower(au.email) = 'nicolas_demers@globelife-paz.com';

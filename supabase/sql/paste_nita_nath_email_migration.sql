-- Paste in Supabase SQL Editor (Dashboard → SQL)
-- Move Nita Nath from nita@globelife-paz.com → nita_nath@globelife-paz.com
-- Keeps leadership role, points, pipeline history, dashboard data, etc.
--
-- PREREQ: Nita has already signed in once with nita_nath@globelife-paz.com
-- (that creates the new auth.users row — usually as "viewer").
--
-- After running: have Nita log out and log back in with nita_nath@globelife-paz.com
-- Safe to re-run: skips tables/columns that do not exist in your project.

create or replace function pg_temp.migrate_user_column_if_exists(
  p_table text,
  p_column text,
  p_old_id uuid,
  p_new_id uuid
) returns void
language plpgsql
as $$
begin
  if not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = p_table
      and c.column_name = p_column
  ) then
    return;
  end if;

  execute format(
    'update public.%I set %I = $1 where %I = $2',
    p_table,
    p_column,
    p_column
  )
  using p_new_id, p_old_id;
end;
$$;

create or replace function pg_temp.migrate_user_pk_table_if_exists(
  p_table text,
  p_old_id uuid,
  p_new_id uuid
) returns void
language plpgsql
as $$
begin
  if not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = p_table
      and c.column_name = 'user_id'
  ) then
    return;
  end if;

  execute format('delete from public.%I where user_id = $1', p_table) using p_new_id;
  execute format('update public.%I set user_id = $1 where user_id = $2', p_table)
    using p_new_id, p_old_id;
end;
$$;

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
  where lower(email) = 'nita@globelife-paz.com'
  limit 1;

  select id into new_id
  from auth.users
  where lower(email) = 'nita_nath@globelife-paz.com'
  limit 1;

  if old_id is null then
    raise exception 'Old account not found: nita@globelife-paz.com';
  end if;
  if new_id is null then
    raise exception 'New account not found: nita_nath@globelife-paz.com — have Nita sign in once first';
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

  insert into public.user_profiles (user_id, email, full_name, role, points, points_updated_at)
  values (
    new_id,
    'nita_nath@globelife-paz.com',
    coalesce(old_full_name, 'Nita Nath'),
    old_role,
    coalesce(old_points, 0),
    now()
  )
  on conflict (user_id) do update
  set
    email = 'nita_nath@globelife-paz.com',
    full_name = coalesce(old_full_name, excluded.full_name, 'Nita Nath'),
    role = old_role,
    points = coalesce(old_points, public.user_profiles.points, 0),
    points_updated_at = coalesce(public.user_profiles.points_updated_at, now()),
    updated_at = now();

  perform pg_temp.migrate_user_pk_table_if_exists('user_home_dashboard_snapshots', old_id, new_id);
  perform pg_temp.migrate_user_pk_table_if_exists('pipeline_user_call_settings', old_id, new_id);
  perform pg_temp.migrate_user_pk_table_if_exists('webinar_geek_user_booking_identities', old_id, new_id);

  perform pg_temp.migrate_user_column_if_exists('recruiter_coin_ledger', 'user_id', old_id, new_id);
  perform pg_temp.migrate_user_column_if_exists('user_dashboard_day_notes', 'user_id', old_id, new_id);
  perform pg_temp.migrate_user_column_if_exists('user_dashboard_sticky_notes', 'user_id', old_id, new_id);

  perform pg_temp.migrate_user_column_if_exists('pipeline_candidates', 'uploader_user_id', old_id, new_id);
  perform pg_temp.migrate_user_column_if_exists('pipeline_candidates', 'assigned_to_user_id', old_id, new_id);
  perform pg_temp.migrate_user_column_if_exists('pipeline_candidates', 'assigned_by_user_id', old_id, new_id);

  perform pg_temp.migrate_user_column_if_exists('pipeline_notes', 'author_user_id', old_id, new_id);
  perform pg_temp.migrate_user_column_if_exists('pipeline_evaluations', 'created_by_user_id', old_id, new_id);
  perform pg_temp.migrate_user_column_if_exists('pipeline_call_logs', 'created_by_user_id', old_id, new_id);
  perform pg_temp.migrate_user_column_if_exists('pipeline_call_records', 'recruiter_user_id', old_id, new_id);
  perform pg_temp.migrate_user_column_if_exists('email_send_logs', 'sent_by_user_id', old_id, new_id);
  perform pg_temp.migrate_user_column_if_exists('pipeline_wednesday_campaign_runs', 'initiated_by_user_id', old_id, new_id);
  perform pg_temp.migrate_user_column_if_exists('pipeline_lead_batches', 'created_by_user_id', old_id, new_id);

  perform pg_temp.migrate_user_column_if_exists('user_profile_hierarchy', 'leader_user_id', old_id, new_id);
  perform pg_temp.migrate_user_column_if_exists('user_profile_hierarchy', 'member_user_id', old_id, new_id);

  perform pg_temp.migrate_user_column_if_exists('support_tickets', 'user_id', old_id, new_id);
  perform pg_temp.migrate_user_column_if_exists('support_ticket_events', 'actor_user_id', old_id, new_id);
  perform pg_temp.migrate_user_column_if_exists('ops_health_snapshots', 'captured_by_user_id', old_id, new_id);
  perform pg_temp.migrate_user_column_if_exists('webinar_geek_portal_bookings', 'booked_by_user_id', old_id, new_id);

  update auth.users
  set
    raw_user_meta_data =
      coalesce(raw_user_meta_data, '{}'::jsonb)
      || jsonb_build_object(
        'role', old_role::text,
        'full_name', coalesce(old_full_name, raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'name', 'Nita Nath')
      ),
    raw_app_meta_data =
      coalesce(raw_app_meta_data, '{}'::jsonb)
      || jsonb_build_object('role', old_role::text)
  where id = new_id;

  delete from public.user_profiles where user_id = old_id;
  delete from auth.users where id = old_id;

  raise notice 'Migrated Nita Nath: % → % (role: %)', old_id, new_id, old_role;
end $$;

-- Verify
select
  au.id,
  au.email,
  up.full_name,
  up.role,
  up.points,
  up.extension,
  up.updated_at
from auth.users au
join public.user_profiles up on up.user_id = au.id
where lower(au.email) = 'nita_nath@globelife-paz.com';

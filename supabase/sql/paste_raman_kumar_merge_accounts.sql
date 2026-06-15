-- Raman Kumar — merge OLD profile into Google login (keeps leads + call history)
--
-- OLD (email/password, has pipeline profile + assigned leads):
--   0eb3fbcc-fd19-4951-954d-9d2a7395a2d8  raman@globelife-paz.com
-- NEW (Google sign-in — keep this auth account):
--   df47b415-9eec-4461-be5c-42a7f8d79ac7  raman_kumar@globelife-paz.com
--
-- Run once in Supabase → SQL Editor. Safe to re-run helper functions; migration block is idempotent-ish
-- (will error if old user already deleted — that means you're done).
-- After: Raman logs out and back in with Google (raman_kumar@globelife-paz.com).

-- 0) Before snapshot
select
  au.id,
  au.email,
  up.full_name,
  up.role,
  up.extension,
  up.points,
  (select count(*) from public.pipeline_candidates pc where pc.assigned_to_user_id = au.id) as assigned_leads,
  (select count(*) from public.pipeline_call_records pcr where pcr.recruiter_user_id = au.id) as call_records
from auth.users au
left join public.user_profiles up on up.user_id = au.id
where au.id in (
  '0eb3fbcc-fd19-4951-954d-9d2a7395a2d8'::uuid,
  'df47b415-9eec-4461-be5c-42a7f8d79ac7'::uuid
)
order by au.email;

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
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = p_table and c.column_name = p_column
  ) then
    return;
  end if;
  execute format('update public.%I set %I = $1 where %I = $2', p_table, p_column, p_column)
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
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = p_table and c.column_name = 'user_id'
  ) then
    return;
  end if;
  execute format('delete from public.%I where user_id = $1', p_table) using p_new_id;
  execute format('update public.%I set user_id = $1 where user_id = $2', p_table) using p_new_id, p_old_id;
end;
$$;

do $$
declare
  old_id uuid := '0eb3fbcc-fd19-4951-954d-9d2a7395a2d8';
  new_id uuid := 'df47b415-9eec-4461-be5c-42a7f8d79ac7';
  old_role public.app_role;
  old_points int;
  old_full_name text;
  old_extension text;
begin
  if not exists (select 1 from auth.users where id = old_id) then
    raise notice 'Old user already removed — merge likely done.';
    return;
  end if;
  if not exists (select 1 from auth.users where id = new_id) then
    raise exception 'New Google user not found: df47b415-9eec-4461-be5c-42a7f8d79ac7';
  end if;

  select role, points, full_name, extension
  into old_role, old_points, old_full_name, old_extension
  from public.user_profiles
  where user_id = old_id;

  if old_role is null then
    old_role := 'recruiter'::public.app_role;
  end if;

  -- Move old profile onto Google account (delete empty new profile row first)
  delete from public.user_profiles where user_id = new_id;

  update public.user_profiles
  set
    user_id = new_id,
    email = 'raman_kumar@globelife-paz.com',
    full_name = coalesce(nullif(trim(old_full_name), ''), 'Raman Kumar'),
    role = coalesce(old_role, 'recruiter'::public.app_role),
    extension = coalesce(nullif(trim(old_extension), ''), '5908'),
    points = coalesce(old_points, 0),
    points_updated_at = now(),
    updated_at = now()
  where user_id = old_id;

  if not found then
    insert into public.user_profiles (user_id, email, full_name, role, extension, points, points_updated_at, updated_at)
    values (new_id, 'raman_kumar@globelife-paz.com', 'Raman Kumar', 'recruiter'::public.app_role, '5908', 0, now(), now());
  end if;

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
  perform pg_temp.migrate_user_column_if_exists('pipeline_lead_assignments', 'recruiter_user_id', old_id, new_id);
  perform pg_temp.migrate_user_column_if_exists('pipeline_lead_assignments', 'assigned_by_user_id', old_id, new_id);

  perform pg_temp.migrate_user_column_if_exists('recruiter_performance_check_ins', 'user_id', old_id, new_id);
  perform pg_temp.migrate_user_column_if_exists('recruiter_performance_check_in_invites', 'user_id', old_id, new_id);

  perform pg_temp.migrate_user_column_if_exists('user_profile_hierarchy', 'leader_user_id', old_id, new_id);
  perform pg_temp.migrate_user_column_if_exists('user_profile_hierarchy', 'member_user_id', old_id, new_id);

  perform pg_temp.migrate_user_column_if_exists('support_tickets', 'user_id', old_id, new_id);
  perform pg_temp.migrate_user_column_if_exists('support_ticket_events', 'actor_user_id', old_id, new_id);
  perform pg_temp.migrate_user_column_if_exists('ops_health_snapshots', 'captured_by_user_id', old_id, new_id);
  perform pg_temp.migrate_user_column_if_exists('webinar_geek_portal_bookings', 'booked_by_user_id', old_id, new_id);

  insert into public.pipeline_user_call_settings (user_id, extension, dialing_locale, updated_at)
  values (new_id, coalesce(nullif(trim(old_extension), ''), '5908'), 'ca', now())
  on conflict (user_id) do update
  set
    extension = coalesce(excluded.extension, public.pipeline_user_call_settings.extension, '5908'),
    dialing_locale = coalesce(public.pipeline_user_call_settings.dialing_locale, 'ca'),
    updated_at = now();

  update auth.users
  set
    raw_user_meta_data =
      coalesce(raw_user_meta_data, '{}'::jsonb)
      || jsonb_build_object(
        'role', coalesce(old_role, 'recruiter'::public.app_role)::text,
        'full_name', coalesce(old_full_name, raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'name', 'Raman Kumar')
      ),
    raw_app_meta_data =
      coalesce(raw_app_meta_data, '{}'::jsonb)
      || jsonb_build_object('role', coalesce(old_role, 'recruiter'::public.app_role)::text)
  where id = new_id;

  delete from public.user_profiles where user_id = old_id;
  delete from auth.users where id = old_id;

  raise notice 'Merged Raman Kumar % → % (role: %)', old_id, new_id, old_role;
end $$;

-- 1) After snapshot — should be ONE user with leads + call access
select
  au.id,
  au.email,
  up.full_name,
  up.role,
  up.extension,
  pcs.extension as call_settings_extension,
  pcs.dialing_locale,
  (select count(*) from public.pipeline_candidates pc where pc.assigned_to_user_id = au.id) as assigned_leads,
  (select count(*) from public.pipeline_call_records pcr where pcr.recruiter_user_id = au.id) as call_records
from auth.users au
join public.user_profiles up on up.user_id = au.id
left join public.pipeline_user_call_settings pcs on pcs.user_id = au.id
where au.id = 'df47b415-9eec-4461-be5c-42a7f8d79ac7'::uuid;

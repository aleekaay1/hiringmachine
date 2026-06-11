-- Reg Bentajado — Admin / Director HR (full leadership access + HR lead packs)
-- Email: reginald_bentajado@globelife-paz.com | 3CX ext: 5208
-- Run once in Supabase → SQL Editor

-- 1) Admin role, display name, 3CX extension
update public.user_profiles
set
  role = 'admin'::public.app_role,
  full_name = 'Reg Bentajado',
  extension = '5208',
  updated_at = now()
where lower(trim(coalesce(email, ''))) = 'reginald_bentajado@globelife-paz.com';

-- 2) Call workspace bar (extension / locale)
insert into public.pipeline_user_call_settings (user_id, extension, dialing_locale, updated_at)
select up.user_id, '5208', 'ca', now()
from public.user_profiles up
where lower(trim(coalesce(up.email, ''))) = 'reginald_bentajado@globelife-paz.com'
on conflict (user_id) do update
set
  extension = excluded.extension,
  dialing_locale = excluded.dialing_locale,
  updated_at = now();

-- 3) HR lead pool + all hr_csv_batch packs (lead manager, batches, assign from pool)
create or replace function public.pipeline_hr_lead_distributor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    lower(trim(auth.jwt() ->> 'email')) = any (array[
      'ali@globelife-paz.com',
      'hr.licensing@globelife-paz.com',
      'reginald_bentajado@globelife-paz.com'
    ]),
    false
  )
  or exists (
    select 1
    from public.user_profiles up
    where up.user_id = auth.uid()
      and up.role = 'hr'
  );
$$;

grant execute on function public.pipeline_hr_lead_distributor() to authenticated;

-- 4) Call-log joins + full pipeline candidate reads for HR distributors / admins
create or replace function public.pipeline_can_read_all_call_telemetry()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_app_role() = 'admin'::public.app_role
    or public.pipeline_hr_lead_distributor();
$$;

grant execute on function public.pipeline_can_read_all_call_telemetry() to authenticated;

-- 5) Verify
select
  up.user_id,
  up.email,
  up.full_name,
  up.role,
  up.extension,
  pcs.extension as call_settings_extension
from public.user_profiles up
left join public.pipeline_user_call_settings pcs on pcs.user_id = up.user_id
where lower(trim(coalesce(up.email, ''))) = 'reginald_bentajado@globelife-paz.com';

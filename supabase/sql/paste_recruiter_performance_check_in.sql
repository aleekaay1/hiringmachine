-- Paste in Supabase SQL Editor: mid-week performance check-in tables + RLS.
-- Same as migration 20260615_120000_recruiter_performance_check_in.sql

create table if not exists public.recruiter_performance_check_in_invites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  submitter_email text not null,
  submitter_name text,
  week_since date not null,
  week_until date not null,
  invite_token uuid not null unique default gen_random_uuid(),
  email_sent_at timestamptz,
  daily_call_target integer,
  daily_booking_target integer,
  elapsed_days integer not null default 0,
  actual_calls integer not null default 0,
  actual_booked integer not null default 0,
  expected_calls integer,
  expected_bookings integer,
  calls_pace_pct numeric(6,2),
  bookings_pace_pct numeric(6,2),
  below_threshold boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, week_since)
);

create index if not exists recruiter_performance_check_in_invites_week_idx
  on public.recruiter_performance_check_in_invites (week_since desc);

create index if not exists recruiter_performance_check_in_invites_token_idx
  on public.recruiter_performance_check_in_invites (invite_token);

create table if not exists public.recruiter_performance_check_ins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  invite_id uuid references public.recruiter_performance_check_in_invites(id) on delete set null,
  submitter_email text not null,
  submitter_name text,
  week_since date not null,
  week_until date not null,
  submitted_at timestamptz not null default now(),
  daily_call_target integer,
  daily_booking_target integer,
  elapsed_days integer not null default 0,
  actual_calls integer not null default 0,
  actual_booked integer not null default 0,
  expected_calls integer,
  expected_bookings integer,
  calls_pace_pct numeric(6,2),
  bookings_pace_pct numeric(6,2),
  blocker_category text,
  trouble_areas text[] not null default '{}',
  help_needed text,
  comments text,
  needs_coaching boolean not null default false,
  status text not null default 'submitted'
    check (status in ('submitted', 'reviewed')),
  reviewed_by_user_id uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  reviewer_notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, week_since)
);

create index if not exists recruiter_performance_check_ins_week_idx
  on public.recruiter_performance_check_ins (week_since desc, submitted_at desc);

alter table public.recruiter_performance_check_in_invites enable row level security;
alter table public.recruiter_performance_check_ins enable row level security;

create or replace function public.performance_check_in_admin_emails()
returns text[]
language sql
stable
as $$
  select array[
    'ali@globelife-paz.com',
    'alex@globelife-paz.com',
    'reginald_bentajado@globelife-paz.com'
  ]::text[];
$$;

create or replace function public.is_performance_check_in_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_profiles up
    where up.user_id = auth.uid()
      and (
        up.role in ('admin', 'leadership')
        or lower(coalesce(up.email, '')) = any(public.performance_check_in_admin_emails())
      )
  );
$$;

create or replace function public.is_performance_check_in_participant()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_profiles up
    where up.user_id = auth.uid()
      and up.role in ('recruiter', 'leadership', 'webinar')
  );
$$;

drop policy if exists recruiter_performance_check_in_invites_select on public.recruiter_performance_check_in_invites;
create policy recruiter_performance_check_in_invites_select
on public.recruiter_performance_check_in_invites
for select to authenticated
using (
  user_id = auth.uid()
  or public.is_performance_check_in_admin()
);

drop policy if exists recruiter_performance_check_in_invites_insert on public.recruiter_performance_check_in_invites;
create policy recruiter_performance_check_in_invites_insert
on public.recruiter_performance_check_in_invites
for insert to authenticated
with check (public.is_performance_check_in_admin());

drop policy if exists recruiter_performance_check_ins_select on public.recruiter_performance_check_ins;
create policy recruiter_performance_check_ins_select
on public.recruiter_performance_check_ins
for select to authenticated
using (
  user_id = auth.uid()
  or public.is_performance_check_in_admin()
);

drop policy if exists recruiter_performance_check_ins_insert on public.recruiter_performance_check_ins;
create policy recruiter_performance_check_ins_insert
on public.recruiter_performance_check_ins
for insert to authenticated
with check (
  user_id = auth.uid()
  and public.is_performance_check_in_participant()
);

drop policy if exists recruiter_performance_check_ins_update on public.recruiter_performance_check_ins;
create policy recruiter_performance_check_ins_update_admin
on public.recruiter_performance_check_ins
for update to authenticated
using (public.is_performance_check_in_admin())
with check (public.is_performance_check_in_admin());

drop policy if exists recruiter_performance_check_ins_update_own on public.recruiter_performance_check_ins;
create policy recruiter_performance_check_ins_update_own
on public.recruiter_performance_check_ins
for update to authenticated
using (user_id = auth.uid() and public.is_performance_check_in_participant())
with check (user_id = auth.uid() and public.is_performance_check_in_participant());

drop policy if exists recruiter_performance_check_ins_delete on public.recruiter_performance_check_ins;
create policy recruiter_performance_check_ins_delete
on public.recruiter_performance_check_ins
for delete to authenticated
using (public.is_performance_check_in_admin());

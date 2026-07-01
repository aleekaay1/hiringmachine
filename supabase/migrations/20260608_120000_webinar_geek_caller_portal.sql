-- Recruiter WebinarGeek caller portal: per-user registration tag + booking audit trail.

alter table if exists public.pipeline_user_call_settings
  add column if not exists webinar_geek_custom_field text;

alter table if exists public.pipeline_user_call_settings
  add column if not exists webinar_geek_default_broadcast_id text;

comment on column public.pipeline_user_call_settings.webinar_geek_custom_field is
  'Recruiter WebinarGeek registration tag (e.g. cooper_jane_smith) — written to custom_field on API bookings.';

create table if not exists public.webinar_geek_portal_bookings (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  booked_by_user_id uuid references auth.users (id) on delete set null,
  booked_by_label text,
  candidate_email text not null,
  candidate_first_name text,
  candidate_last_name text,
  candidate_id uuid references public.pipeline_candidates (id) on delete set null,
  broadcast_id text,
  webinar_id text,
  custom_field text,
  wg_subscription_id text,
  email_verified boolean,
  status text not null default 'booked' check (status in ('booked', 'failed')),
  error_message text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists webinar_geek_portal_bookings_created_at_idx
  on public.webinar_geek_portal_bookings (created_at desc);
create index if not exists webinar_geek_portal_bookings_candidate_email_idx
  on public.webinar_geek_portal_bookings (lower(trim(candidate_email)));
create index if not exists webinar_geek_portal_bookings_booked_by_idx
  on public.webinar_geek_portal_bookings (booked_by_user_id, created_at desc);

alter table public.webinar_geek_portal_bookings enable row level security;

drop policy if exists webinar_geek_portal_bookings_select on public.webinar_geek_portal_bookings;
create policy webinar_geek_portal_bookings_select
on public.webinar_geek_portal_bookings
for select
to authenticated
using (
  booked_by_user_id = auth.uid()
  or exists (
    select 1 from public.user_profiles up
    where up.user_id = auth.uid()
      and up.role in ('admin', 'leadership', 'hr', 'webinar')
  )
);

drop policy if exists webinar_geek_portal_bookings_insert on public.webinar_geek_portal_bookings;
create policy webinar_geek_portal_bookings_insert
on public.webinar_geek_portal_bookings
for insert
to authenticated
with check (booked_by_user_id = auth.uid());

grant select, insert on public.webinar_geek_portal_bookings to authenticated;

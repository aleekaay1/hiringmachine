-- Paste in Supabase SQL Editor (same as migration 20260517_120000_live_session_registry.sql)

create table if not exists public.live_session_occurrences (
  session_date date primary key,
  session_start_at timestamptz not null,
  status text not null check (status in ('upcoming', 'past')),
  calendly_event_uri text,
  calendly_event_name text,
  calendly_start_at timestamptz,
  zoom_meeting_uuid text,
  zoom_topic text,
  zoom_start_at timestamptz,
  zoom_duration_minutes int,
  scheduled_count int not null default 0,
  attended_count int not null default 0,
  attendance_rate_pct int,
  zoom_participant_count int not null default 0,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists live_session_occurrences_status_start_idx
  on public.live_session_occurrences (status, session_start_at desc);

create table if not exists public.live_session_registrants (
  id uuid primary key default gen_random_uuid(),
  session_date date not null references public.live_session_occurrences(session_date) on delete cascade,
  email text not null,
  name text,
  phone text,
  calendly_status text,
  calendly_invitee_uri text,
  calendly_no_show boolean not null default false,
  attended_zoom boolean not null default false,
  zoom_join_at timestamptz,
  zoom_leave_at timestamptz,
  match_method text,
  calendly_synced_at timestamptz,
  zoom_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_date, email)
);

create index if not exists live_session_registrants_session_date_idx
  on public.live_session_registrants (session_date);

alter table public.live_session_occurrences enable row level security;
alter table public.live_session_registrants enable row level security;

drop policy if exists live_session_occurrences_auth_rw on public.live_session_occurrences;
create policy live_session_occurrences_auth_rw on public.live_session_occurrences
  for all to authenticated using (true) with check (true);

drop policy if exists live_session_registrants_auth_rw on public.live_session_registrants;
create policy live_session_registrants_auth_rw on public.live_session_registrants
  for all to authenticated using (true) with check (true);

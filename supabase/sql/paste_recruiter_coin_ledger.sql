-- Paste in Supabase SQL Editor (required for Paz Coins wallet).
-- Same as migration 20260603_120000_recruiter_coin_ledger.sql

create table if not exists public.recruiter_coin_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null check (source_type in ('webinar_show', 'live_session_show')),
  source_key text not null,
  points integer not null default 10 check (points > 0),
  label text,
  earned_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, source_key)
);

create index if not exists recruiter_coin_ledger_user_earned_idx
  on public.recruiter_coin_ledger(user_id, earned_at desc);

alter table public.recruiter_coin_ledger enable row level security;

drop policy if exists recruiter_coin_ledger_select_own on public.recruiter_coin_ledger;
create policy recruiter_coin_ledger_select_own
on public.recruiter_coin_ledger
for select
to authenticated
using (
  user_id = auth.uid()
  or public.current_user_app_role() in ('admin', 'leadership')
);

comment on table public.recruiter_coin_ledger is
  'Paz Coins earn events (10 per webinar/live show). Balance cached on user_profiles.points.';

-- Optional: legacy day note table (removes 404 on dashboard if you still use sticky-note import)
create table if not exists public.user_dashboard_day_notes (
  user_id uuid not null references auth.users(id) on delete cascade,
  note_date date not null,
  content text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, note_date)
);

alter table public.user_dashboard_day_notes enable row level security;

drop policy if exists "users read own dashboard notes" on public.user_dashboard_day_notes;
drop policy if exists "users write own dashboard notes" on public.user_dashboard_day_notes;

create policy "users read own dashboard notes"
  on public.user_dashboard_day_notes for select to authenticated using (auth.uid() = user_id);

create policy "users write own dashboard notes"
  on public.user_dashboard_day_notes for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

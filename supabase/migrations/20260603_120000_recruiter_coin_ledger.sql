-- Paz Coins: ledger for recruiter show credits (webinar + live session).

create table if not exists public.recruiter_coin_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null check (source_type in ('webinar_show', 'live_session_show', 'candidate_hired')),
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
  'Paz Coins earn events: 10 per webinar/live show, 50 when a booked candidate is hired. Balance cached on user_profiles.points.';

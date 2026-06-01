-- Paste in Supabase SQL Editor: cached leadership leaderboard per period (manual refresh only).

create table if not exists public.pipeline_leaderboard_snapshots (
  period text primary key,
  payload jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.pipeline_leaderboard_snapshots is
  'Cached leadership leaderboard rows by period key (last7, last30, thisMonth, or custom:YYYY-MM-DD_YYYY-MM-DD); updated only when a user clicks Refresh.';

alter table public.pipeline_leaderboard_snapshots enable row level security;

drop policy if exists "authenticated read pipeline leaderboard snapshots" on public.pipeline_leaderboard_snapshots;
drop policy if exists "authenticated upsert pipeline leaderboard snapshots" on public.pipeline_leaderboard_snapshots;

create policy "authenticated read pipeline leaderboard snapshots"
  on public.pipeline_leaderboard_snapshots
  for select
  to authenticated
  using (true);

create policy "authenticated upsert pipeline leaderboard snapshots"
  on public.pipeline_leaderboard_snapshots
  for all
  to authenticated
  using (true)
  with check (true);

-- Per-user home dashboard snapshot (/home) — load cached metrics; refresh on demand only.

create table if not exists public.user_home_dashboard_snapshots (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null,
  payload jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_home_dashboard_snapshots_fetched_at_idx
  on public.user_home_dashboard_snapshots (fetched_at desc);

comment on table public.user_home_dashboard_snapshots is
  'Cached /home dashboard metrics per staff user; refreshed only when user clicks refresh.';

alter table public.user_home_dashboard_snapshots enable row level security;

drop policy if exists user_home_dashboard_snapshots_select on public.user_home_dashboard_snapshots;
create policy user_home_dashboard_snapshots_select
  on public.user_home_dashboard_snapshots
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists user_home_dashboard_snapshots_upsert on public.user_home_dashboard_snapshots;
create policy user_home_dashboard_snapshots_upsert
  on public.user_home_dashboard_snapshots
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists user_home_dashboard_snapshots_update on public.user_home_dashboard_snapshots;
create policy user_home_dashboard_snapshots_update
  on public.user_home_dashboard_snapshots
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Snapshot of WebinarGeek subscriptions (+ optional broadcasts) for offline dashboards.

create table if not exists public.webinar_geek_dashboard_snapshots (
  id text primary key default 'latest',
  subscriptions jsonb not null default '[]'::jsonb,
  broadcasts jsonb not null default '[]'::jsonb,
  fetch_since text,
  fetch_until text,
  fetch_label text,
  subscription_count integer not null default 0,
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.webinar_geek_dashboard_snapshots is
  'Latest WebinarGeek API pull for /webinar-geek and /calls-analytics; upserted on each successful Fetch data.';

alter table public.webinar_geek_dashboard_snapshots enable row level security;

drop policy if exists "authenticated read webinar geek dashboard cache" on public.webinar_geek_dashboard_snapshots;
drop policy if exists "authenticated upsert webinar geek dashboard cache" on public.webinar_geek_dashboard_snapshots;

create policy "authenticated read webinar geek dashboard cache"
  on public.webinar_geek_dashboard_snapshots
  for select
  to authenticated
  using (true);

create policy "authenticated upsert webinar geek dashboard cache"
  on public.webinar_geek_dashboard_snapshots
  for insert
  to authenticated
  with check (true);

create policy "authenticated update webinar geek dashboard cache"
  on public.webinar_geek_dashboard_snapshots
  for update
  to authenticated
  using (true)
  with check (true);

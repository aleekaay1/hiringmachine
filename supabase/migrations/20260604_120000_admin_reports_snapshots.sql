-- Saved admin Reports snapshots (team cards + per-user detail payloads).

create table if not exists public.admin_reports_snapshots (
  id text primary key,
  payload jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.admin_reports_snapshots is
  'Admin Reports: team directory cards and per-user report payloads keyed by id (team:… / user:… / meta:global).';

alter table public.admin_reports_snapshots enable row level security;

drop policy if exists admin_reports_snapshots_select on public.admin_reports_snapshots;
drop policy if exists admin_reports_snapshots_upsert on public.admin_reports_snapshots;

create policy admin_reports_snapshots_select
  on public.admin_reports_snapshots
  for select
  to authenticated
  using (public.current_user_app_role() = 'admin');

create policy admin_reports_snapshots_upsert
  on public.admin_reports_snapshots
  for insert
  to authenticated
  with check (public.current_user_app_role() = 'admin');

create policy admin_reports_snapshots_update
  on public.admin_reports_snapshots
  for update
  to authenticated
  using (public.current_user_app_role() = 'admin')
  with check (public.current_user_app_role() = 'admin');

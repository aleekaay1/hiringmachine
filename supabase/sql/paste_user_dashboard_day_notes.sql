-- Daily sticky notes on role home dashboards (one note per user per calendar day, Toronto date in app).

create table if not exists public.user_dashboard_day_notes (
  user_id uuid not null references auth.users(id) on delete cascade,
  note_date date not null,
  content text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, note_date)
);

comment on table public.user_dashboard_day_notes is
  'Per-user daily notes shown on the role home dashboard.';

alter table public.user_dashboard_day_notes enable row level security;

drop policy if exists "users read own dashboard notes" on public.user_dashboard_day_notes;
drop policy if exists "users write own dashboard notes" on public.user_dashboard_day_notes;

create policy "users read own dashboard notes"
  on public.user_dashboard_day_notes
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "users write own dashboard notes"
  on public.user_dashboard_day_notes
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

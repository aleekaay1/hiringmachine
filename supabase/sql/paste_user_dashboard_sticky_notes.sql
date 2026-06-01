-- Paste in Supabase SQL Editor (same as 20260602_170000_user_dashboard_sticky_notes.sql)

create table if not exists public.user_dashboard_sticky_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '',
  body text not null default '',
  color_key text not null default 'amber',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_dashboard_sticky_notes_user_sort_idx
  on public.user_dashboard_sticky_notes (user_id, sort_order, created_at);

alter table public.user_dashboard_sticky_notes enable row level security;

drop policy if exists user_dashboard_sticky_notes_select on public.user_dashboard_sticky_notes;
drop policy if exists user_dashboard_sticky_notes_insert on public.user_dashboard_sticky_notes;
drop policy if exists user_dashboard_sticky_notes_update on public.user_dashboard_sticky_notes;
drop policy if exists user_dashboard_sticky_notes_delete on public.user_dashboard_sticky_notes;

create policy user_dashboard_sticky_notes_select
  on public.user_dashboard_sticky_notes for select to authenticated using (auth.uid() = user_id);
create policy user_dashboard_sticky_notes_insert
  on public.user_dashboard_sticky_notes for insert to authenticated with check (auth.uid() = user_id);
create policy user_dashboard_sticky_notes_update
  on public.user_dashboard_sticky_notes for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy user_dashboard_sticky_notes_delete
  on public.user_dashboard_sticky_notes for delete to authenticated using (auth.uid() = user_id);

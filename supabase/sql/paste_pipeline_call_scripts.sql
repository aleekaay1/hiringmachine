-- Paste in Supabase SQL Editor (same as migration 20260616_120000_pipeline_call_scripts.sql)

create table if not exists public.pipeline_call_scripts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'My script',
  body text not null default '',
  sort_order int not null default 0,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pipeline_call_scripts_user_sort_idx
  on public.pipeline_call_scripts (user_id, sort_order asc, updated_at desc);

comment on table public.pipeline_call_scripts is
  'Personal call scripts for pipeline call workspace — one row per script per user.';

alter table public.pipeline_call_scripts enable row level security;

drop policy if exists pipeline_call_scripts_own_rw on public.pipeline_call_scripts;
create policy pipeline_call_scripts_own_rw on public.pipeline_call_scripts
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

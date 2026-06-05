-- Run in Supabase SQL Editor for cached Book-as registration links.

create table if not exists public.webinar_geek_registration_link_catalog (
  id text primary key default 'default',
  tags jsonb not null default '[]'::jsonb,
  synced_at timestamptz not null default now()
);

create table if not exists public.webinar_geek_user_booking_identities (
  user_id uuid primary key references auth.users (id) on delete cascade,
  identities jsonb not null default '[]'::jsonb,
  synced_at timestamptz not null default now()
);

create index if not exists webinar_geek_user_booking_identities_synced_at_idx
  on public.webinar_geek_user_booking_identities (synced_at desc);

alter table public.webinar_geek_registration_link_catalog enable row level security;
alter table public.webinar_geek_user_booking_identities enable row level security;

drop policy if exists webinar_geek_registration_link_catalog_read on public.webinar_geek_registration_link_catalog;
create policy webinar_geek_registration_link_catalog_read
  on public.webinar_geek_registration_link_catalog
  for select
  to authenticated
  using (true);

drop policy if exists webinar_geek_user_booking_identities_read on public.webinar_geek_user_booking_identities;
create policy webinar_geek_user_booking_identities_read
  on public.webinar_geek_user_booking_identities
  for select
  to authenticated
  using (user_id = auth.uid());

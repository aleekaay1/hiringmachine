-- HR notes for WebinarGeek subscription rows (keyed by WG subscription id as text).

create table if not exists public.webinar_geek_hr_note_entries (
  id uuid primary key default gen_random_uuid(),
  subscription_id text not null,
  body text not null,
  author_label text,
  created_at timestamptz not null default now()
);

create index if not exists webinar_geek_hr_note_entries_sub_created_idx
  on public.webinar_geek_hr_note_entries (subscription_id, created_at desc);

comment on table public.webinar_geek_hr_note_entries is 'Append-only HR notes for WebinarGeek subscribers; subscription_id matches WebinarGeek API subscription id.';

alter table public.webinar_geek_hr_note_entries enable row level security;

drop policy if exists "authenticated read webinar geek hr notes" on public.webinar_geek_hr_note_entries;
drop policy if exists "authenticated insert webinar geek hr notes" on public.webinar_geek_hr_note_entries;

create policy "authenticated read webinar geek hr notes"
  on public.webinar_geek_hr_note_entries
  for select
  to authenticated
  using (true);

create policy "authenticated insert webinar geek hr notes"
  on public.webinar_geek_hr_note_entries
  for insert
  to authenticated
  with check (true);

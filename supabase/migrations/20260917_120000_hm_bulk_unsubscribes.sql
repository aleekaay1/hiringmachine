-- Bulk email unsubscribe list (skip these addresses on send).
create table if not exists public.hm_bulk_unsubscribes (
  email text primary key,
  unsubscribed_at timestamptz not null default now(),
  source text,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists hm_bulk_unsubscribes_unsubscribed_at_idx
  on public.hm_bulk_unsubscribes (unsubscribed_at desc);

alter table public.hm_bulk_unsubscribes enable row level security;

drop policy if exists hm_bulk_unsubscribes_auth_select on public.hm_bulk_unsubscribes;
create policy hm_bulk_unsubscribes_auth_select on public.hm_bulk_unsubscribes
  for select to authenticated using (true);

comment on table public.hm_bulk_unsubscribes is 'Emails that opted out of bulk outreach; edge function writes via service role.';

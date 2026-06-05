-- Support ticketing + ops health snapshots (paste full script in Supabase SQL Editor)

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  submitter_email text not null,
  submitter_name text,
  category text not null check (category in (
    'bug', 'access', 'pipeline', 'leaderboard', 'email', 'feature', 'other'
  )),
  subject text not null,
  body text not null,
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_tickets_user_id_idx on public.support_tickets (user_id, created_at desc);
create index if not exists support_tickets_status_idx on public.support_tickets (status, updated_at desc);

create table if not exists public.support_ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_email text,
  event_type text not null check (event_type in ('created', 'status_change', 'staff_reply', 'resolution')),
  message text,
  new_status text,
  visible_to_user boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists support_ticket_events_ticket_idx on public.support_ticket_events (ticket_id, created_at asc);

create table if not exists public.ops_health_snapshots (
  id uuid primary key default gen_random_uuid(),
  captured_by_user_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ops_health_snapshots_created_idx on public.ops_health_snapshots (created_at desc);

alter table public.support_tickets enable row level security;
alter table public.support_ticket_events enable row level security;
alter table public.ops_health_snapshots enable row level security;

drop policy if exists "users read own support tickets" on public.support_tickets;
drop policy if exists "users insert own support tickets" on public.support_tickets;

create policy "users read own support tickets"
  on public.support_tickets for select to authenticated
  using (auth.uid() = user_id);

create policy "users insert own support tickets"
  on public.support_tickets for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "users read own ticket events" on public.support_ticket_events;

create policy "users read own ticket events"
  on public.support_ticket_events for select to authenticated
  using (
    exists (
      select 1 from public.support_tickets t
      where t.id = ticket_id and t.user_id = auth.uid()
    )
    and visible_to_user = true
  );

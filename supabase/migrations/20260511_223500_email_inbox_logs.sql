-- Inbound mailbox sync logs (e.g., replies to sent emails)
create table if not exists public.email_inbox_logs (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'imap',
  message_id text not null unique,
  thread_id text,
  from_email text not null,
  to_email text,
  cc_email text,
  subject text,
  snippet text,
  received_at timestamptz not null,
  candidate_id uuid references public.pipeline_candidates(id) on delete set null,
  raw_headers jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists email_inbox_logs_received_at_idx
  on public.email_inbox_logs (received_at desc);
create index if not exists email_inbox_logs_candidate_id_idx
  on public.email_inbox_logs (candidate_id);
create index if not exists email_inbox_logs_from_email_idx
  on public.email_inbox_logs (from_email);

alter table public.email_inbox_logs enable row level security;

drop policy if exists "authenticated users can read email inbox logs"
  on public.email_inbox_logs;
create policy "authenticated users can read email inbox logs"
on public.email_inbox_logs
for select
to authenticated
using (true);


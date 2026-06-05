-- Global audit log for outbound SMTP (Edge Functions + CRM send-email).

create table if not exists public.email_send_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  source text not null,
  trigger_label text,
  from_email text not null,
  to_email text not null,
  cc_email text,
  subject text not null,
  candidate_id text,
  sent_by_user_id uuid references auth.users (id) on delete set null,
  status text not null default 'sent' check (status in ('sent', 'failed')),
  error_message text,
  metadata jsonb
);

create index if not exists email_send_logs_created_at_idx on public.email_send_logs (created_at desc);
create index if not exists email_send_logs_candidate_id_idx on public.email_send_logs (candidate_id);
create index if not exists email_send_logs_trigger_idx on public.email_send_logs (trigger_label);

comment on table public.email_send_logs is 'Audit trail for outbound email; written by Edge Functions (service role).';

alter table public.email_send_logs enable row level security;

-- Inserts only from backend (service role bypasses RLS).

-- Any signed-in user can read (tighten later with user_profiles roles when that table exists).
create policy "authenticated users can read email send logs"
on public.email_send_logs
for select
to authenticated
using (true);

-- Run in Supabase → SQL Editor (once public.candidates exists for the FK on candidate_id).
-- If you see 404 on user_profiles, run the repo migration first:
--   supabase/migrations/20260429_181500_user_roles_base.sql
-- (Or paste that whole file before this one.)

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

drop policy if exists "staff roles can read email send logs" on public.email_send_logs;
drop policy if exists "authenticated users can read email send logs" on public.email_send_logs;

create policy "authenticated users can read email send logs"
on public.email_send_logs
for select
to authenticated
using (true);

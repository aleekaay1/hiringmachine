-- Mandatory call disposition records for /pipeline 3CX dialing.

create table if not exists public.pipeline_call_records (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.pipeline_candidates(id) on delete cascade,
  resume_id uuid references public.pipeline_resumes(id) on delete set null,
  dial_log_id uuid references public.pipeline_call_logs(id) on delete set null,
  recruiter_user_id uuid references auth.users(id) on delete set null,
  recruiter_label text,
  disposition text not null,
  comment text,
  dialed_number text not null,
  dial_started_at timestamptz not null,
  disposed_at timestamptz not null default now(),
  threecx_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint pipeline_call_records_disposition_check check (
    disposition in (
      'No answer',
      'Voicemail left',
      'Busy / line busy',
      'Callback requested',
      'Wrong number',
      'Not interested',
      'Connected',
      'Interested – next step',
      'Scheduled interview',
      'Do not call',
      'Booked'
    )
  )
);

create index if not exists pipeline_call_records_candidate_created_idx
  on public.pipeline_call_records(candidate_id, created_at desc);

create index if not exists pipeline_call_records_recruiter_created_idx
  on public.pipeline_call_records(recruiter_user_id, created_at desc);

create index if not exists pipeline_call_records_disposition_idx
  on public.pipeline_call_records(disposition, created_at desc);

alter table public.pipeline_call_records enable row level security;

drop policy if exists pipeline_call_records_auth_rw on public.pipeline_call_records;
create policy pipeline_call_records_auth_rw on public.pipeline_call_records
for all to authenticated using (true) with check (true);

comment on table public.pipeline_call_records is 'Dispositioned pipeline calls (mandatory after each dial from /pipeline).';

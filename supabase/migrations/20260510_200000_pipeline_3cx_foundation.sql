-- Pipeline + 3CX foundation tables.
-- Direct-link page: /pipeline

create table if not exists public.pipeline_candidates (
  id uuid primary key default gen_random_uuid(),
  full_name text not null default '',
  phone text,
  email text,
  source text not null default 'bulk_upload',
  journey_stage text not null default 'new',
  status text not null default 'open',
  uploader_user_id uuid references auth.users(id) on delete set null,
  uploader_label text,
  scheduled_for timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pipeline_resumes (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.pipeline_candidates(id) on delete cascade,
  storage_bucket text not null default 'pipeline-resumes',
  storage_path text not null,
  public_url text,
  original_filename text not null,
  mime_type text,
  size_bytes bigint,
  converted_pdf_path text,
  converted_pdf_url text,
  conversion_status text not null default 'pending' check (conversion_status in ('pending', 'processing', 'ready', 'failed', 'not_required')),
  conversion_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pipeline_notes (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.pipeline_candidates(id) on delete cascade,
  body text not null,
  author_user_id uuid references auth.users(id) on delete set null,
  author_label text,
  created_at timestamptz not null default now()
);

create table if not exists public.pipeline_evaluations (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.pipeline_candidates(id) on delete cascade,
  fit_score int check (fit_score between 1 and 10),
  disposition text,
  next_action text,
  journey_stage text,
  comments text,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_by_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pipeline_call_logs (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.pipeline_candidates(id) on delete cascade,
  resume_id uuid references public.pipeline_resumes(id) on delete set null,
  threecx_call_id text,
  action text not null,
  outcome text,
  duration_seconds int,
  agent_extension text,
  request_payload jsonb,
  response_payload jsonb,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_by_label text,
  created_at timestamptz not null default now()
);

create index if not exists pipeline_candidates_created_at_idx on public.pipeline_candidates(created_at desc);
create index if not exists pipeline_candidates_status_idx on public.pipeline_candidates(status, journey_stage);
create index if not exists pipeline_candidates_email_phone_idx on public.pipeline_candidates(email, phone);
create index if not exists pipeline_candidates_scheduled_for_idx on public.pipeline_candidates(scheduled_for);
create index if not exists pipeline_resumes_candidate_created_idx on public.pipeline_resumes(candidate_id, created_at desc);
create index if not exists pipeline_notes_candidate_created_idx on public.pipeline_notes(candidate_id, created_at desc);
create index if not exists pipeline_eval_candidate_created_idx on public.pipeline_evaluations(candidate_id, created_at desc);
create index if not exists pipeline_calls_candidate_created_idx on public.pipeline_call_logs(candidate_id, created_at desc);
create index if not exists pipeline_calls_call_id_idx on public.pipeline_call_logs(threecx_call_id);

create or replace function public.pipeline_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_pipeline_candidates_updated_at on public.pipeline_candidates;
create trigger trg_pipeline_candidates_updated_at
before update on public.pipeline_candidates
for each row execute function public.pipeline_set_updated_at();

drop trigger if exists trg_pipeline_resumes_updated_at on public.pipeline_resumes;
create trigger trg_pipeline_resumes_updated_at
before update on public.pipeline_resumes
for each row execute function public.pipeline_set_updated_at();

drop trigger if exists trg_pipeline_evaluations_updated_at on public.pipeline_evaluations;
create trigger trg_pipeline_evaluations_updated_at
before update on public.pipeline_evaluations
for each row execute function public.pipeline_set_updated_at();

alter table public.pipeline_candidates enable row level security;
alter table public.pipeline_resumes enable row level security;
alter table public.pipeline_notes enable row level security;
alter table public.pipeline_evaluations enable row level security;
alter table public.pipeline_call_logs enable row level security;

drop policy if exists pipeline_candidates_auth_rw on public.pipeline_candidates;
create policy pipeline_candidates_auth_rw on public.pipeline_candidates
for all to authenticated using (true) with check (true);

drop policy if exists pipeline_resumes_auth_rw on public.pipeline_resumes;
create policy pipeline_resumes_auth_rw on public.pipeline_resumes
for all to authenticated using (true) with check (true);

drop policy if exists pipeline_notes_auth_rw on public.pipeline_notes;
create policy pipeline_notes_auth_rw on public.pipeline_notes
for all to authenticated using (true) with check (true);

drop policy if exists pipeline_evaluations_auth_rw on public.pipeline_evaluations;
create policy pipeline_evaluations_auth_rw on public.pipeline_evaluations
for all to authenticated using (true) with check (true);

drop policy if exists pipeline_call_logs_auth_rw on public.pipeline_call_logs;
create policy pipeline_call_logs_auth_rw on public.pipeline_call_logs
for all to authenticated using (true) with check (true);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'pipeline-resumes',
  'pipeline-resumes',
  true,
  31457280,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/rtf',
    'text/plain'
  ]
)
on conflict (id) do nothing;

drop policy if exists pipeline_resumes_auth_insert on storage.objects;
create policy pipeline_resumes_auth_insert on storage.objects
for insert to authenticated
with check (bucket_id = 'pipeline-resumes');

drop policy if exists pipeline_resumes_auth_select on storage.objects;
create policy pipeline_resumes_auth_select on storage.objects
for select to authenticated
using (bucket_id = 'pipeline-resumes');

drop policy if exists pipeline_resumes_auth_update on storage.objects;
create policy pipeline_resumes_auth_update on storage.objects
for update to authenticated
using (bucket_id = 'pipeline-resumes')
with check (bucket_id = 'pipeline-resumes');

comment on table public.pipeline_candidates is '3CX pipeline candidate records imported from resume bulk uploads.';
comment on table public.pipeline_resumes is 'Uploaded resume assets with conversion status for inline viewing.';
comment on table public.pipeline_notes is 'Append-only HR notes/comments for pipeline candidates.';
comment on table public.pipeline_evaluations is 'Short-form evaluation snapshots and next-step decisions.';
comment on table public.pipeline_call_logs is 'Audit trail of 3CX call-control actions and outcomes.';

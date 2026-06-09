-- HR weekly CSV lead import, assignment pool, and recruiter self-add leads.

create table if not exists public.pipeline_lead_batches (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by_user_id uuid references auth.users (id) on delete set null,
  created_by_label text,
  label text not null,
  source_filename text,
  lead_team text,
  total_rows integer not null default 0,
  imported_count integer not null default 0,
  skipped_duplicate_count integer not null default 0,
  failed_count integer not null default 0,
  assigned_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists pipeline_lead_batches_created_at_idx
  on public.pipeline_lead_batches (created_at desc);

comment on table public.pipeline_lead_batches is
  'HR CSV import batches for weekly lead distribution to recruiters.';

alter table public.pipeline_candidates
  add column if not exists lead_batch_id uuid references public.pipeline_lead_batches (id) on delete set null;

alter table public.pipeline_candidates
  add column if not exists assigned_to_user_id uuid references auth.users (id) on delete set null;

alter table public.pipeline_candidates
  add column if not exists assigned_to_label text;

alter table public.pipeline_candidates
  add column if not exists assigned_at timestamptz;

alter table public.pipeline_candidates
  add column if not exists assigned_by_user_id uuid references auth.users (id) on delete set null;

create index if not exists pipeline_candidates_lead_batch_id_idx
  on public.pipeline_candidates (lead_batch_id);

create index if not exists pipeline_candidates_assigned_to_user_id_idx
  on public.pipeline_candidates (assigned_to_user_id, created_at desc);

create index if not exists pipeline_candidates_hr_pool_idx
  on public.pipeline_candidates (lead_batch_id, created_at desc)
  where source = 'hr_csv_batch' and assigned_to_user_id is null;

-- Prevent duplicate open leads with the same email across assignees.
create unique index if not exists pipeline_candidates_unique_open_email_idx
  on public.pipeline_candidates (lower(trim(email)))
  where email is not null
    and trim(email) <> ''
    and status in ('open', 'in_progress')
    and assigned_to_user_id is not null;

create or replace function public.pipeline_hr_lead_distributor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    lower(trim(auth.jwt() ->> 'email')) = any (array[
      'ali@globelife-paz.com',
      'hr.licensing@globelife-paz.com'
    ]),
    false
  )
  or exists (
    select 1
    from public.user_profiles up
    where up.user_id = auth.uid()
      and up.role = 'hr'
  );
$$;

grant execute on function public.pipeline_hr_lead_distributor() to authenticated;

create or replace function public.pipeline_can_access_candidate(p_candidate_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.pipeline_candidates c
    where c.id = p_candidate_id
      and (
        public.pipeline_has_full_visibility()
        or c.uploader_user_id = auth.uid()
        or (
          public.pipeline_hr_lead_distributor()
          and c.source = 'hr_csv_batch'
        )
      )
  );
$$;

drop policy if exists pipeline_candidates_select on public.pipeline_candidates;
create policy pipeline_candidates_select
on public.pipeline_candidates
for select
to authenticated
using (
  public.pipeline_has_full_visibility()
  or uploader_user_id = auth.uid()
  or (
    public.pipeline_hr_lead_distributor()
    and source = 'hr_csv_batch'
  )
);

drop policy if exists pipeline_candidates_insert on public.pipeline_candidates;
create policy pipeline_candidates_insert
on public.pipeline_candidates
for insert
to authenticated
with check (
  public.pipeline_has_full_visibility()
  or (source = 'self_lead' and uploader_user_id = auth.uid())
  or (
    source = 'bulk_upload'
    and uploader_user_id = auth.uid()
    and public.pipeline_hr_lead_distributor()
  )
);

drop policy if exists pipeline_candidates_update on public.pipeline_candidates;
create policy pipeline_candidates_update
on public.pipeline_candidates
for update
to authenticated
using (
  public.pipeline_has_full_visibility()
  or uploader_user_id = auth.uid()
  or (
    public.pipeline_hr_lead_distributor()
    and source = 'hr_csv_batch'
  )
)
with check (
  public.pipeline_has_full_visibility()
  or uploader_user_id = auth.uid()
  or (
    public.pipeline_hr_lead_distributor()
    and source = 'hr_csv_batch'
  )
);

alter table public.pipeline_lead_batches enable row level security;

drop policy if exists pipeline_lead_batches_hr_read on public.pipeline_lead_batches;
create policy pipeline_lead_batches_hr_read
on public.pipeline_lead_batches
for select
to authenticated
using (public.pipeline_hr_lead_distributor());

drop policy if exists pipeline_lead_batches_hr_write on public.pipeline_lead_batches;
create policy pipeline_lead_batches_hr_write
on public.pipeline_lead_batches
for all
to authenticated
using (public.pipeline_hr_lead_distributor())
with check (public.pipeline_hr_lead_distributor());

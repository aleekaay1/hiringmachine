-- Paste this in Supabase SQL Editor
-- Same as migration 20260518_183000_pipeline_user_call_settings_and_journey_resumes.sql

create table if not exists public.pipeline_user_call_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  extension text,
  dialing_locale text default 'ca',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.pipeline_user_call_settings
  drop column if exists caller_id;

create index if not exists pipeline_user_call_settings_updated_idx
  on public.pipeline_user_call_settings(updated_at desc);

create or replace function public.pipeline_user_call_settings_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_pipeline_user_call_settings_updated_at on public.pipeline_user_call_settings;
create trigger trg_pipeline_user_call_settings_updated_at
before update on public.pipeline_user_call_settings
for each row
execute function public.pipeline_user_call_settings_set_updated_at();

alter table public.pipeline_user_call_settings enable row level security;

drop policy if exists pipeline_user_call_settings_select on public.pipeline_user_call_settings;
create policy pipeline_user_call_settings_select
on public.pipeline_user_call_settings
for select
to authenticated
using (
  auth.uid() = user_id
  or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
);

drop policy if exists pipeline_user_call_settings_insert on public.pipeline_user_call_settings;
create policy pipeline_user_call_settings_insert
on public.pipeline_user_call_settings
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists pipeline_user_call_settings_update on public.pipeline_user_call_settings;
create policy pipeline_user_call_settings_update
on public.pipeline_user_call_settings
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists pipeline_user_call_settings_delete on public.pipeline_user_call_settings;
create policy pipeline_user_call_settings_delete
on public.pipeline_user_call_settings
for delete
to authenticated
using (auth.uid() = user_id);

alter table public.pipeline_resumes
  add column if not exists resume_source text not null default 'bulk_upload',
  add column if not exists source_candidate_id text,
  add column if not exists source_resume_url text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'pipeline_resumes_resume_source_check'
  ) then
    alter table public.pipeline_resumes
      add constraint pipeline_resumes_resume_source_check
      check (resume_source in ('bulk_upload', 'journey_upload'));
  end if;
end$$;

create index if not exists pipeline_resumes_resume_source_idx
  on public.pipeline_resumes(resume_source, candidate_id, created_at desc);

create index if not exists pipeline_resumes_source_resume_url_idx
  on public.pipeline_resumes(source_resume_url);

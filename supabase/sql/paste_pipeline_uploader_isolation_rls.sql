-- Per-recruiter isolation for pipeline resume uploads (candidates + resumes + storage).
-- Recruiters: only rows where pipeline_candidates.uploader_user_id = auth.uid().
-- Admin / leadership: full access via user_profiles.role.

create or replace function public.pipeline_has_full_visibility()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select false;
$$;

grant execute on function public.pipeline_has_full_visibility() to authenticated;

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
      )
  );
$$;

grant execute on function public.pipeline_can_access_candidate(uuid) to authenticated;

create or replace function public.pipeline_storage_candidate_id(object_name text)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  first_segment text;
begin
  first_segment := (storage.foldername(object_name))[1];
  if first_segment is null or first_segment = '' then
    return null;
  end if;
  if first_segment !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return null;
  end if;
  return first_segment::uuid;
exception
  when others then
    return null;
end;
$$;

grant execute on function public.pipeline_storage_candidate_id(text) to authenticated;

create index if not exists pipeline_candidates_uploader_user_id_idx
  on public.pipeline_candidates (uploader_user_id, created_at desc);

-- pipeline_candidates
drop policy if exists pipeline_candidates_auth_rw on public.pipeline_candidates;

drop policy if exists pipeline_candidates_select on public.pipeline_candidates;
create policy pipeline_candidates_select
on public.pipeline_candidates
for select
to authenticated
using (
  public.pipeline_has_full_visibility()
  or uploader_user_id = auth.uid()
);

drop policy if exists pipeline_candidates_insert on public.pipeline_candidates;
create policy pipeline_candidates_insert
on public.pipeline_candidates
for insert
to authenticated
with check (
  public.pipeline_has_full_visibility()
  or (source = 'bulk_upload' and uploader_user_id = auth.uid())
);

drop policy if exists pipeline_candidates_update on public.pipeline_candidates;
create policy pipeline_candidates_update
on public.pipeline_candidates
for update
to authenticated
using (
  public.pipeline_has_full_visibility()
  or uploader_user_id = auth.uid()
)
with check (
  public.pipeline_has_full_visibility()
  or uploader_user_id = auth.uid()
);

drop policy if exists pipeline_candidates_delete on public.pipeline_candidates;
create policy pipeline_candidates_delete
on public.pipeline_candidates
for delete
to authenticated
using (
  public.pipeline_has_full_visibility()
  or uploader_user_id = auth.uid()
);

-- pipeline_resumes (scoped via parent candidate)
drop policy if exists pipeline_resumes_auth_rw on public.pipeline_resumes;

drop policy if exists pipeline_resumes_select on public.pipeline_resumes;
create policy pipeline_resumes_select
on public.pipeline_resumes
for select
to authenticated
using (public.pipeline_can_access_candidate(candidate_id));

drop policy if exists pipeline_resumes_insert on public.pipeline_resumes;
create policy pipeline_resumes_insert
on public.pipeline_resumes
for insert
to authenticated
with check (public.pipeline_can_access_candidate(candidate_id));

drop policy if exists pipeline_resumes_update on public.pipeline_resumes;
create policy pipeline_resumes_update
on public.pipeline_resumes
for update
to authenticated
using (public.pipeline_can_access_candidate(candidate_id))
with check (public.pipeline_can_access_candidate(candidate_id));

drop policy if exists pipeline_resumes_delete on public.pipeline_resumes;
create policy pipeline_resumes_delete
on public.pipeline_resumes
for delete
to authenticated
using (public.pipeline_can_access_candidate(candidate_id));

-- Child tables: notes, evaluations, call logs, call records
drop policy if exists pipeline_notes_auth_rw on public.pipeline_notes;

drop policy if exists pipeline_notes_select on public.pipeline_notes;
create policy pipeline_notes_select
on public.pipeline_notes
for select
to authenticated
using (public.pipeline_can_access_candidate(candidate_id));

drop policy if exists pipeline_notes_insert on public.pipeline_notes;
create policy pipeline_notes_insert
on public.pipeline_notes
for insert
to authenticated
with check (public.pipeline_can_access_candidate(candidate_id));

drop policy if exists pipeline_notes_update on public.pipeline_notes;
create policy pipeline_notes_update
on public.pipeline_notes
for update
to authenticated
using (public.pipeline_can_access_candidate(candidate_id))
with check (public.pipeline_can_access_candidate(candidate_id));

drop policy if exists pipeline_notes_delete on public.pipeline_notes;
create policy pipeline_notes_delete
on public.pipeline_notes
for delete
to authenticated
using (public.pipeline_can_access_candidate(candidate_id));

drop policy if exists pipeline_evaluations_auth_rw on public.pipeline_evaluations;

drop policy if exists pipeline_evaluations_select on public.pipeline_evaluations;
create policy pipeline_evaluations_select
on public.pipeline_evaluations
for select
to authenticated
using (public.pipeline_can_access_candidate(candidate_id));

drop policy if exists pipeline_evaluations_insert on public.pipeline_evaluations;
create policy pipeline_evaluations_insert
on public.pipeline_evaluations
for insert
to authenticated
with check (public.pipeline_can_access_candidate(candidate_id));

drop policy if exists pipeline_evaluations_update on public.pipeline_evaluations;
create policy pipeline_evaluations_update
on public.pipeline_evaluations
for update
to authenticated
using (public.pipeline_can_access_candidate(candidate_id))
with check (public.pipeline_can_access_candidate(candidate_id));

drop policy if exists pipeline_evaluations_delete on public.pipeline_evaluations;
create policy pipeline_evaluations_delete
on public.pipeline_evaluations
for delete
to authenticated
using (public.pipeline_can_access_candidate(candidate_id));

drop policy if exists pipeline_call_logs_auth_rw on public.pipeline_call_logs;

drop policy if exists pipeline_call_logs_select on public.pipeline_call_logs;
create policy pipeline_call_logs_select
on public.pipeline_call_logs
for select
to authenticated
using (public.pipeline_can_access_candidate(candidate_id));

drop policy if exists pipeline_call_logs_insert on public.pipeline_call_logs;
create policy pipeline_call_logs_insert
on public.pipeline_call_logs
for insert
to authenticated
with check (public.pipeline_can_access_candidate(candidate_id));

drop policy if exists pipeline_call_logs_update on public.pipeline_call_logs;
create policy pipeline_call_logs_update
on public.pipeline_call_logs
for update
to authenticated
using (public.pipeline_can_access_candidate(candidate_id))
with check (public.pipeline_can_access_candidate(candidate_id));

drop policy if exists pipeline_call_logs_delete on public.pipeline_call_logs;
create policy pipeline_call_logs_delete
on public.pipeline_call_logs
for delete
to authenticated
using (public.pipeline_can_access_candidate(candidate_id));

do $$
begin
  if to_regclass('public.pipeline_call_records') is not null then
    execute 'drop policy if exists pipeline_call_records_auth_rw on public.pipeline_call_records';
    execute 'drop policy if exists pipeline_call_records_select on public.pipeline_call_records';
    execute $p$
      create policy pipeline_call_records_select
      on public.pipeline_call_records
      for select
      to authenticated
      using (public.pipeline_can_access_candidate(candidate_id))
    $p$;
    execute 'drop policy if exists pipeline_call_records_insert on public.pipeline_call_records';
    execute $p$
      create policy pipeline_call_records_insert
      on public.pipeline_call_records
      for insert
      to authenticated
      with check (public.pipeline_can_access_candidate(candidate_id))
    $p$;
    execute 'drop policy if exists pipeline_call_records_update on public.pipeline_call_records';
    execute $p$
      create policy pipeline_call_records_update
      on public.pipeline_call_records
      for update
      to authenticated
      using (public.pipeline_can_access_candidate(candidate_id))
      with check (public.pipeline_can_access_candidate(candidate_id))
    $p$;
    execute 'drop policy if exists pipeline_call_records_delete on public.pipeline_call_records';
    execute $p$
      create policy pipeline_call_records_delete
      on public.pipeline_call_records
      for delete
      to authenticated
      using (public.pipeline_can_access_candidate(candidate_id))
    $p$;
  end if;
end
$$;

-- Storage: pipeline-resumes bucket (path = {candidate_id}/filename)
drop policy if exists pipeline_resumes_auth_insert on storage.objects;
drop policy if exists pipeline_resumes_auth_select on storage.objects;
drop policy if exists pipeline_resumes_auth_update on storage.objects;
drop policy if exists pipeline_resumes_auth_delete on storage.objects;

create policy pipeline_resumes_storage_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'pipeline-resumes'
  and public.pipeline_can_access_candidate(public.pipeline_storage_candidate_id(name))
);

create policy pipeline_resumes_storage_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'pipeline-resumes'
  and public.pipeline_can_access_candidate(public.pipeline_storage_candidate_id(name))
);

create policy pipeline_resumes_storage_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'pipeline-resumes'
  and public.pipeline_can_access_candidate(public.pipeline_storage_candidate_id(name))
)
with check (
  bucket_id = 'pipeline-resumes'
  and public.pipeline_can_access_candidate(public.pipeline_storage_candidate_id(name))
);

create policy pipeline_resumes_storage_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'pipeline-resumes'
  and public.pipeline_can_access_candidate(public.pipeline_storage_candidate_id(name))
);

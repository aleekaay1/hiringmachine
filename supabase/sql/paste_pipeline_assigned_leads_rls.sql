-- Paste in Supabase SQL Editor
-- Lets recruiters see leads assigned to them (assigned_to_user_id), not only uploader_user_id.

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
        or c.assigned_to_user_id = auth.uid()
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
  or assigned_to_user_id = auth.uid()
);

drop policy if exists pipeline_candidates_update on public.pipeline_candidates;
create policy pipeline_candidates_update
on public.pipeline_candidates
for update
to authenticated
using (
  public.pipeline_has_full_visibility()
  or uploader_user_id = auth.uid()
  or assigned_to_user_id = auth.uid()
)
with check (
  public.pipeline_has_full_visibility()
  or uploader_user_id = auth.uid()
  or assigned_to_user_id = auth.uid()
);

create index if not exists pipeline_candidates_assigned_to_user_id_idx
  on public.pipeline_candidates (assigned_to_user_id, created_at desc);

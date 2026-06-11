-- Call log viewers: resolve candidate names without per-row RLS gaps.

create or replace function public.list_pipeline_candidates_for_call_log(p_ids uuid[])
returns table (
  id uuid,
  full_name text,
  email text,
  phone text
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.full_name, c.email, c.phone
  from public.pipeline_candidates c
  where c.id = any(p_ids)
    and public.pipeline_can_read_all_call_telemetry();
$$;

grant execute on function public.list_pipeline_candidates_for_call_log(uuid[]) to authenticated;

-- Snapshot names on existing rows so call log works even if the RPC is unavailable.
update public.pipeline_call_records cr
set threecx_metadata = coalesce(cr.threecx_metadata, '{}'::jsonb) || jsonb_build_object(
  'candidate_name', c.full_name,
  'candidate_email', c.email
)
from public.pipeline_candidates c
where cr.candidate_id = c.id
  and coalesce(cr.threecx_metadata->>'candidate_name', '') = '';

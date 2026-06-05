-- Leaderboard: pipeline candidate id → email RPC + leadership call telemetry read.

create or replace function public.get_pipeline_candidate_emails(p_ids uuid[])
returns table(id uuid, email text)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, lower(trim(c.email)) as email
  from public.pipeline_candidates c
  where c.id = any(p_ids)
    and trim(coalesce(c.email, '')) <> ''
    and (
      public.current_user_app_role() in ('admin', 'leadership')
      or c.uploader_user_id = auth.uid()
    );
$$;

grant execute on function public.get_pipeline_candidate_emails(uuid[]) to authenticated;

create or replace function public.pipeline_can_read_all_call_telemetry()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_app_role() in ('admin', 'leadership');
$$;

grant execute on function public.pipeline_can_read_all_call_telemetry() to authenticated;

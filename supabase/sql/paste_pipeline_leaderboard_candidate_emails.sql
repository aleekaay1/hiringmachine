-- Leaderboard refresh: map pipeline_call_records.candidate_id → email (pipeline_candidates, not CRM candidates).
-- Also lets admin/leadership read all team call rows for refresh.

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

comment on function public.get_pipeline_candidate_emails(uuid[]) is
  'Leaderboard live-session matching: pipeline candidate id → email. Admin/leadership see team rows.';

-- Leadership should read all call dispositions for team leaderboard (admin already could).
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

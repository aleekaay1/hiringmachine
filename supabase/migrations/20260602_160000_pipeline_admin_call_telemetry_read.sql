-- Admins: read all recruiters' call dispositions/logs for analytics (not resume/candidate uploads).

create or replace function public.pipeline_can_read_all_call_telemetry()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_app_role() = 'admin'::public.app_role;
$$;

grant execute on function public.pipeline_can_read_all_call_telemetry() to authenticated;

do $$
begin
  if to_regclass('public.pipeline_call_records') is not null then
    execute 'drop policy if exists pipeline_call_records_select on public.pipeline_call_records';
    execute $p$
      create policy pipeline_call_records_select
      on public.pipeline_call_records
      for select
      to authenticated
      using (
        public.pipeline_can_read_all_call_telemetry()
        or public.pipeline_can_access_candidate(candidate_id)
      )
    $p$;
  end if;
end
$$;

drop policy if exists pipeline_call_logs_select on public.pipeline_call_logs;
create policy pipeline_call_logs_select
on public.pipeline_call_logs
for select
to authenticated
using (
  public.pipeline_can_read_all_call_telemetry()
  or public.pipeline_can_access_candidate(candidate_id)
);

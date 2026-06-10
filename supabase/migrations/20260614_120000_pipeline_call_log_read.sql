-- Call log viewers (admin + ali + hr.licensing) can read all call telemetry and candidate names for joins.

create or replace function public.pipeline_can_read_all_call_telemetry()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_app_role() = 'admin'::public.app_role
    or public.pipeline_hr_lead_distributor();
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
  or (
    public.pipeline_hr_lead_distributor()
    and source = 'hr_csv_batch'
  )
  or public.pipeline_can_read_all_call_telemetry()
);

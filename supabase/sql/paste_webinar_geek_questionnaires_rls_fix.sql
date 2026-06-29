-- Run if questionnaire table exists but recruiters see nothing / import failed with PGRST205.

create or replace function public.wg_recruiter_can_view_questionnaire_row(
  p_recruiter_custom_field text,
  p_booked_by_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_booked_by_user_id = auth.uid()
    or (
      p_recruiter_custom_field is not null
      and trim(p_recruiter_custom_field) <> ''
      and exists (
        select 1
        from public.user_profiles up
        left join public.pipeline_user_call_settings pcs on pcs.user_id = up.user_id
        where up.user_id = auth.uid()
          and up.role = 'recruiter'
          and (
            lower(trim(coalesce(pcs.webinar_geek_custom_field, ''))) = lower(trim(p_recruiter_custom_field))
            or (
              coalesce(nullif(trim(split_part(coalesce(up.full_name, ''), ' ', 1)), ''), nullif(trim(split_part(split_part(coalesce(up.email, ''), '@', 1), '.', 1)), '')) is not null
              and lower(p_recruiter_custom_field) like '%' || lower(coalesce(
                nullif(trim(split_part(coalesce(up.full_name, ''), ' ', 1)), ''),
                nullif(trim(split_part(split_part(coalesce(up.email, ''), '@', 1), '.', 1)), '')
              )) || '%'
            )
          )
      )
    );
$$;

drop policy if exists webinar_geek_questionnaire_submissions_select on public.webinar_geek_questionnaire_submissions;
create policy webinar_geek_questionnaire_submissions_select
on public.webinar_geek_questionnaire_submissions
for select
to authenticated
using (
  exists (
    select 1 from public.user_profiles up
    where up.user_id = auth.uid()
      and up.role in ('admin', 'leadership', 'hr', 'webinar')
  )
  or public.wg_recruiter_can_view_questionnaire_row(recruiter_custom_field, booked_by_user_id)
);

notify pgrst, 'reload schema';

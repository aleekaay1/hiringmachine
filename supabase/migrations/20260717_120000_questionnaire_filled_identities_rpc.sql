-- Name-aware filled questionnaire lookup for follow-up board (go-live forward only).

create or replace function public.questionnaire_filled_identities_for_viewer()
returns table(
  email text,
  name_key text,
  submission_id uuid,
  pipeline_candidate_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (coalesce(lower(trim(s.email)), ''), lower(trim(concat(s.first_name, ' ', s.last_name))))
    lower(trim(s.email)) as email,
    nullif(lower(trim(concat(s.first_name, ' ', s.last_name))), '') as name_key,
    s.id as submission_id,
    s.pipeline_candidate_id
  from public.webinar_geek_questionnaire_submissions s
  where s.source_type = 'google_form'
    and s.hiring_stage in ('questionnaire_submitted', 'ready_for_followup')
    and s.submitted_at >= '2026-06-16T00:00:00+00'::timestamptz
    and (
      exists (
        select 1 from public.user_profiles up
        where up.user_id = auth.uid()
          and up.role in ('admin', 'hr', 'webinar')
      )
      or (
        exists (
          select 1 from public.user_profiles up
          where up.user_id = auth.uid()
            and up.role = 'leadership'
        )
        and public.wg_leadership_can_view_questionnaire_row(s.booked_by_user_id, s.recruiter_custom_field)
      )
      or (
        exists (
          select 1 from public.user_profiles up
          where up.user_id = auth.uid()
            and up.role = 'recruiter'
        )
        and public.wg_recruiter_can_view_questionnaire_row(s.recruiter_custom_field, s.booked_by_user_id)
      )
    )
  order by coalesce(lower(trim(s.email)), ''), lower(trim(concat(s.first_name, ' ', s.last_name))), s.submitted_at desc;
$$;

grant execute on function public.questionnaire_filled_identities_for_viewer() to authenticated;

notify pgrst, 'reload schema';

-- Run if questionnaire table exists but recruiters see nothing / import failed with PGRST205.
-- Recruiters: awaiting-only (no submission rows); leadership: team hierarchy scope.

create or replace function public.wg_recruiter_tag_belongs_to_user(
  p_recruiter_custom_field text,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_recruiter_custom_field is not null
    and trim(p_recruiter_custom_field) <> ''
    and exists (
      select 1
      from public.user_profiles up
      left join public.pipeline_user_call_settings pcs on pcs.user_id = up.user_id
      where up.user_id = p_user_id
        and (
          lower(trim(coalesce(pcs.webinar_geek_custom_field, ''))) = lower(trim(p_recruiter_custom_field))
          or (
            coalesce(
              nullif(trim(split_part(coalesce(up.full_name, ''), ' ', 1)), ''),
              nullif(trim(split_part(split_part(coalesce(up.email, ''), '@', 1), '.', 1)), '')
            ) is not null
            and lower(p_recruiter_custom_field) like '%' || lower(coalesce(
              nullif(trim(split_part(coalesce(up.full_name, ''), ' ', 1)), ''),
              nullif(trim(split_part(split_part(coalesce(up.email, ''), '@', 1), '.', 1)), '')
            )) || '%'
          )
        )
    );
$$;

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
    or public.wg_recruiter_tag_belongs_to_user(p_recruiter_custom_field, auth.uid());
$$;

create or replace function public.wg_leadership_can_view_questionnaire_row(
  p_booked_by_user_id uuid,
  p_recruiter_custom_field text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_booked_by_user_id = auth.uid()
    or p_booked_by_user_id in (
      select h.member_user_id
      from public.user_profile_hierarchy h
      where h.leader_user_id = auth.uid()
    )
    or public.wg_recruiter_tag_belongs_to_user(p_recruiter_custom_field, auth.uid())
    or exists (
      select 1
      from public.user_profile_hierarchy h
      where h.leader_user_id = auth.uid()
        and public.wg_recruiter_tag_belongs_to_user(p_recruiter_custom_field, h.member_user_id)
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
      and up.role in ('admin', 'hr', 'webinar')
  )
  or (
    exists (
      select 1 from public.user_profiles up
      where up.user_id = auth.uid()
        and up.role = 'leadership'
    )
    and public.wg_leadership_can_view_questionnaire_row(booked_by_user_id, recruiter_custom_field)
  )
);

create or replace function public.questionnaire_filled_emails_for_viewer()
returns table(email text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct lower(trim(s.email)) as email
  from public.webinar_geek_questionnaire_submissions s
  where s.source_type = 'google_form'
    and s.hiring_stage in ('questionnaire_submitted', 'ready_for_followup')
    and s.email is not null
    and trim(s.email) <> ''
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
    );
$$;

grant execute on function public.questionnaire_filled_emails_for_viewer() to authenticated;

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

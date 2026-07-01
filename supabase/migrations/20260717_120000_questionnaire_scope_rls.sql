-- Role + hierarchy scope for Webinar Questionnaire and call workspace.

drop policy if exists webinar_geek_portal_bookings_select on public.webinar_geek_portal_bookings;
create policy webinar_geek_portal_bookings_select
on public.webinar_geek_portal_bookings
for select
to authenticated
using (
  booked_by_user_id = auth.uid()
  or exists (
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
    and (
      booked_by_user_id = auth.uid()
      or booked_by_user_id in (
        select h.member_user_id
        from public.user_profile_hierarchy h
        where h.leader_user_id = auth.uid()
      )
      or public.wg_recruiter_tag_belongs_to_user(custom_field, auth.uid())
      or exists (
        select 1
        from public.user_profile_hierarchy h
        where h.leader_user_id = auth.uid()
          and public.wg_recruiter_tag_belongs_to_user(custom_field, h.member_user_id)
      )
    )
  )
);

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
  or (
    exists (
      select 1 from public.user_profiles up
      where up.user_id = auth.uid()
        and up.role = 'recruiter'
    )
    and public.wg_recruiter_can_view_questionnaire_row(recruiter_custom_field, booked_by_user_id)
  )
);

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
        exists (
          select 1 from public.user_profiles up
          where up.user_id = auth.uid()
            and up.role in ('admin', 'hr', 'webinar')
        )
        or c.uploader_user_id = auth.uid()
        or c.assigned_to_user_id = auth.uid()
        or c.uploader_user_id in (
          select h.member_user_id
          from public.user_profile_hierarchy h
          where h.leader_user_id = auth.uid()
        )
        or c.assigned_to_user_id in (
          select h.member_user_id
          from public.user_profile_hierarchy h
          where h.leader_user_id = auth.uid()
        )
      )
  );
$$;

grant execute on function public.pipeline_can_access_candidate(uuid) to authenticated;

drop policy if exists pipeline_candidates_select on public.pipeline_candidates;
create policy pipeline_candidates_select
on public.pipeline_candidates
for select
to authenticated
using (
  exists (
    select 1 from public.user_profiles up
    where up.user_id = auth.uid()
      and up.role in ('admin', 'hr', 'webinar')
  )
  or uploader_user_id = auth.uid()
  or assigned_to_user_id = auth.uid()
  or uploader_user_id in (
    select h.member_user_id
    from public.user_profile_hierarchy h
    where h.leader_user_id = auth.uid()
  )
  or assigned_to_user_id in (
    select h.member_user_id
    from public.user_profile_hierarchy h
    where h.leader_user_id = auth.uid()
  )
);

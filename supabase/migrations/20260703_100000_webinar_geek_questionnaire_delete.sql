-- Allow staff (not recruiters) to delete questionnaire rows from the portal UI.

drop policy if exists webinar_geek_questionnaire_submissions_delete on public.webinar_geek_questionnaire_submissions;
create policy webinar_geek_questionnaire_submissions_delete
on public.webinar_geek_questionnaire_submissions
for delete
to authenticated
using (
  exists (
    select 1 from public.user_profiles up
    where up.user_id = auth.uid()
      and up.role in ('admin', 'leadership', 'hr', 'webinar')
  )
);

notify pgrst, 'reload schema';

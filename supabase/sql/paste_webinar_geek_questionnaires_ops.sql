-- Paste in Supabase SQL editor (after paste_webinar_geek_questionnaires.sql).
-- Delete policy for staff UI + optional one-time cleanup of pre-Google-Form rows.

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

-- One-time: remove old WebinarGeek import/cache rows (keep Google Form only).
-- delete from public.webinar_geek_questionnaire_submissions where source_type is distinct from 'google_form';

notify pgrst, 'reload schema';

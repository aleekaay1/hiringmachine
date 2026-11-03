-- Form signups page can remove a signup row. People and WebinarGeek subscriptions stay.

drop policy if exists hm_public_webinar_signups_delete on public.hm_public_webinar_signups;
create policy hm_public_webinar_signups_delete
on public.hm_public_webinar_signups
for delete
to authenticated
using (true);

grant delete on public.hm_public_webinar_signups to authenticated;

notify pgrst, 'reload schema';

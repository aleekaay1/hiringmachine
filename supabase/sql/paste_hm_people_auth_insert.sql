-- Allow staff to promote public webinar signups into the call queue.
drop policy if exists hm_people_auth_insert on public.hm_people;
create policy hm_people_auth_insert on public.hm_people
for insert
to authenticated
with check (true);

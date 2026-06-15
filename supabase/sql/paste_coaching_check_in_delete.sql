-- Paste after paste_recruiter_performance_check_in.sql if tables already exist.
-- Adds admin delete policy for coaching form submissions.

drop policy if exists recruiter_performance_check_ins_delete on public.recruiter_performance_check_ins;
create policy recruiter_performance_check_ins_delete
on public.recruiter_performance_check_ins
for delete to authenticated
using (public.is_performance_check_in_admin());

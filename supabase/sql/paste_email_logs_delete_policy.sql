-- Run in Supabase SQL editor if inbox/outbox delete/update fails with RLS/permission errors.

drop policy if exists "authenticated users can update email inbox logs"
  on public.email_inbox_logs;
create policy "authenticated users can update email inbox logs"
on public.email_inbox_logs
for update
to authenticated
using (true)
with check (true);

drop policy if exists "authenticated users can delete email inbox logs"
  on public.email_inbox_logs;
create policy "authenticated users can delete email inbox logs"
on public.email_inbox_logs
for delete
to authenticated
using (true);

drop policy if exists "authenticated users can delete email send logs"
  on public.email_send_logs;
create policy "authenticated users can delete email send logs"
on public.email_send_logs
for delete
to authenticated
using (true);

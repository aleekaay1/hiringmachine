-- Fix projects that created email_send_logs with a policy referencing user_profiles (missing table).
-- Safe to run when public.email_send_logs already exists.

do $$
begin
  if to_regclass('public.email_send_logs') is null then
    return;
  end if;
  execute 'drop policy if exists "staff roles can read email send logs" on public.email_send_logs';
  execute 'drop policy if exists "authenticated users can read email send logs" on public.email_send_logs';
  execute $p$
    create policy "authenticated users can read email send logs"
    on public.email_send_logs
    for select
    to authenticated
    using (true)
  $p$;
end$$;

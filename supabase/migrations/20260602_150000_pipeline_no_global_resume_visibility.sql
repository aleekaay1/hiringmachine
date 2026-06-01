-- Recruiters and leadership each see only their own uploads (uploader_user_id = auth.uid()).
-- Admins use dashboards only; they do not get a shared pipeline resume/call queue.

create or replace function public.pipeline_has_full_visibility()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select false;
$$;

-- Paste in Supabase SQL Editor (same as 20260602_150000_pipeline_no_global_resume_visibility.sql)
create or replace function public.pipeline_has_full_visibility()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select false;
$$;

-- Step 1 (run first only once if needed)
-- Fixes: ERROR 55P04 unsafe use of new enum value "leadership"
do $$
begin
  if exists (
    select 1
    from pg_type t
    where t.typnamespace = 'public'::regnamespace
      and t.typname = 'app_role'
  ) and not exists (
    select 1
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    where t.typnamespace = 'public'::regnamespace
      and t.typname = 'app_role'
      and e.enumlabel = 'leadership'
  ) then
    alter type public.app_role add value 'leadership';
  end if;
end
$$;

-- Step 2:
-- After this succeeds, run:
-- supabase/sql/paste_multi_user_roles_phase1.sql

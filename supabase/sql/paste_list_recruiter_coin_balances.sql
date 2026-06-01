-- Paste ONLY this block in Supabase SQL Editor (leaderboard team coin totals).
-- Do not include "..." — run the full script below.

create or replace function public.list_recruiter_coin_balances()
returns table (user_id uuid, balance integer)
language sql
stable
security definer
set search_path = public
as $$
  select up.user_id, coalesce(up.points, 0)::integer as balance
  from public.user_profiles up
  where up.role in ('recruiter', 'webinar', 'leadership');
$$;

grant execute on function public.list_recruiter_coin_balances() to authenticated;

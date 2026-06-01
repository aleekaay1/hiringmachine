-- Paste ONLY this block in Supabase SQL Editor (leaderboard team coin totals).
-- Do not include "..." — run the full script below.

create or replace function public.list_recruiter_coin_balances()
returns table (user_id uuid, balance integer)
language sql
stable
security definer
set search_path = public
as $$
  select
    up.user_id,
    coalesce(ledger.total_points, up.points, 0)::integer as balance
  from public.user_profiles up
  left join (
    select user_id, sum(points)::bigint as total_points
    from public.recruiter_coin_ledger
    group by user_id
  ) ledger on ledger.user_id = up.user_id
  where up.role in ('recruiter', 'webinar', 'leadership');
$$;

grant execute on function public.list_recruiter_coin_balances() to authenticated;

-- Paz Coins: 50-coin bonus when a recruiter's booked candidate is hired.

alter table public.recruiter_coin_ledger
  drop constraint if exists recruiter_coin_ledger_source_type_check;

alter table public.recruiter_coin_ledger
  add constraint recruiter_coin_ledger_source_type_check
  check (source_type in ('webinar_show', 'live_session_show', 'candidate_hired'));

comment on table public.recruiter_coin_ledger is
  'Paz Coins earn events: 10 per webinar/live show, 50 when a booked candidate is hired. Balance cached on user_profiles.points.';

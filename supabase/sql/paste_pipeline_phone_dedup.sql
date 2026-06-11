-- Run in Supabase SQL editor: phone dedup for HR lead import & assignment.
-- See supabase/migrations/20260612_140000_pipeline_phone_dedup.sql

alter table public.pipeline_candidates
  add column if not exists phone_last10 text generated always as (
    case
      when length(regexp_replace(coalesce(phone, ''), '\D', '', 'g')) >= 10 then
        right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10)
      else null
    end
  ) stored;

create index if not exists pipeline_candidates_phone_last10_open_idx
  on public.pipeline_candidates (phone_last10)
  where phone_last10 is not null
    and status in ('open', 'in_progress');

create unique index if not exists pipeline_candidates_unique_assigned_phone_last10_idx
  on public.pipeline_candidates (phone_last10)
  where phone_last10 is not null
    and trim(phone_last10) <> ''
    and status in ('open', 'in_progress')
    and assigned_to_user_id is not null;

drop index if exists public.pipeline_candidates_unique_open_email_idx;

create unique index if not exists pipeline_candidates_unique_assigned_email_idx
  on public.pipeline_candidates (lower(trim(email)))
  where email is not null
    and trim(email) <> ''
    and status in ('open', 'in_progress')
    and assigned_to_user_id is not null;

create unique index if not exists pipeline_candidates_unique_pool_email_idx
  on public.pipeline_candidates (lower(trim(email)))
  where email is not null
    and trim(email) <> ''
    and status in ('open', 'in_progress')
    and assigned_to_user_id is null
    and source = 'hr_csv_batch';

create unique index if not exists pipeline_candidates_unique_pool_phone_last10_idx
  on public.pipeline_candidates (phone_last10)
  where phone_last10 is not null
    and trim(phone_last10) <> ''
    and status in ('open', 'in_progress')
    and assigned_to_user_id is null
    and source = 'hr_csv_batch';

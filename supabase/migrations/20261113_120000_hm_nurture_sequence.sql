-- Webinar nurture: 6 emails for people who watched and have not submitted the questionnaire.
-- Auto-enroll (only when the sequence is enabled) starts 24 hours after the watch.
-- Manual enroll from /webinar-nurture starts email 1 immediately.
-- Emails 2–6 send delay_days after the previous email (default 2, so every other day).
-- A questionnaire submission stops the sequence. A step that already sent is not sent again.
--
-- Watch signal: webinar_geek_dashboard_snapshots id 'latest' (same showed rule as
-- wg_questionnaire_showed_index: watched = true OR watch_duration >= 1410 seconds)
-- plus webinar_geek_questionnaire_submissions rows with hiring_stage = 'attended_only'.
-- Questionnaire signal: hiring_stage questionnaire_submitted / ready_for_followup,
-- or a non-empty answers array (Google Form + WebinarGeek both land in that table).
--
-- Auto-enroll only includes watches from the last 14 days, so turning the sequence on
-- does not email the whole historical snapshot. Older watchers can be started by hand.
--
-- Run supabase/sql/paste_hm_nurture_sequence.sql in the Supabase SQL editor (this file
-- plus the pg_cron block). Deploy edge function hm-nurture-sequence.

create or replace function public.hm_nurture_parse_ts(value text)
returns timestamptz
language plpgsql
immutable
as $fn$
declare
  trimmed text := nullif(btrim(coalesce(value, '')), '');
  n numeric;
begin
  if trimmed is null then
    return null;
  end if;
  begin
    return trimmed::timestamptz;
  exception when others then
    null;
  end;
  begin
    n := trimmed::numeric;
  exception when others then
    return null;
  end;
  if n > 100000000000 then
    return to_timestamp(n / 1000.0);
  elsif n > 1000000000 then
    return to_timestamp(n);
  end if;
  return null;
end;
$fn$;

create or replace function public.hm_nurture_parse_num(value text)
returns numeric
language plpgsql
immutable
as $fn$
declare
  trimmed text := nullif(btrim(coalesce(value, '')), '');
begin
  if trimmed is null then
    return 0;
  end if;
  return trimmed::numeric;
exception when others then
  return 0;
end;
$fn$;

create table if not exists public.hm_nurture_sequences (
  id text primary key,
  name text not null,
  enabled boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.hm_nurture_steps (
  id uuid primary key default gen_random_uuid(),
  sequence_id text not null references public.hm_nurture_sequences(id) on delete cascade,
  step_number integer not null check (step_number between 1 and 6),
  subject text not null default '',
  body_html text not null default '',
  vimeo_url text not null default '',
  delay_days integer not null default 2 check (delay_days >= 0 and delay_days <= 30),
  updated_at timestamptz not null default now(),
  unique (sequence_id, step_number)
);

create table if not exists public.hm_nurture_enrollments (
  id uuid primary key default gen_random_uuid(),
  sequence_id text not null references public.hm_nurture_sequences(id) on delete cascade,
  email text not null,
  first_name text,
  last_name text,
  source text not null check (source in ('auto', 'manual')),
  status text not null default 'active' check (status in ('active', 'completed', 'stopped')),
  stop_reason text check (stop_reason is null or stop_reason in (
    'questionnaire_submitted', 'manual', 'unsubscribed'
  )),
  watched_at timestamptz,
  subscription_id text,
  current_step integer not null default 0 check (current_step between 0 and 6),
  next_step integer not null default 1 check (next_step between 1 and 6),
  next_send_at timestamptz,
  enrolled_at timestamptz not null default now(),
  stopped_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists hm_nurture_enrollments_email_uidx
  on public.hm_nurture_enrollments (sequence_id, email);

create index if not exists hm_nurture_enrollments_due_idx
  on public.hm_nurture_enrollments (status, next_send_at);

create table if not exists public.hm_nurture_sends (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.hm_nurture_enrollments(id) on delete cascade,
  sequence_id text not null,
  step_number integer not null check (step_number between 1 and 6),
  email text not null,
  subject text,
  status text not null check (status in ('claimed', 'sent', 'failed')),
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists hm_nurture_sends_one_open
  on public.hm_nurture_sends (enrollment_id, step_number)
  where status in ('sent', 'claimed');

create index if not exists hm_nurture_sends_enrollment_idx
  on public.hm_nurture_sends (enrollment_id, created_at desc);

comment on table public.hm_nurture_sequences is
  'Candidate nurture sequences. enabled turns on the automatic 24h-after-watch enrollment.';
comment on table public.hm_nurture_steps is
  'Six editable emails. delay_days is the gap after the previous email (email 1 uses the enrollment start time).';
comment on table public.hm_nurture_enrollments is
  'One row per person per sequence. status active until email 6 sends, staff stop, unsubscribe, or questionnaire.';
comment on table public.hm_nurture_sends is
  'One successful or in-flight send per enrollment step. Failed attempts stay as history and can be retried.';

insert into public.hm_nurture_sequences (id, name, enabled)
values ('webinar-no-questionnaire', 'Webinar watchers without a questionnaire', false)
on conflict (id) do nothing;

insert into public.hm_nurture_steps (sequence_id, step_number, subject, body_html, vimeo_url, delay_days)
select 'webinar-no-questionnaire', n, '', '', '', case when n = 1 then 0 else 2 end
from generate_series(1, 6) as n
on conflict (sequence_id, step_number) do nothing;

alter table public.hm_nurture_sequences enable row level security;
alter table public.hm_nurture_steps enable row level security;
alter table public.hm_nurture_enrollments enable row level security;
alter table public.hm_nurture_sends enable row level security;

drop policy if exists hm_nurture_sequences_auth_all on public.hm_nurture_sequences;
create policy hm_nurture_sequences_auth_all on public.hm_nurture_sequences
for all to authenticated using (true) with check (true);

drop policy if exists hm_nurture_steps_auth_all on public.hm_nurture_steps;
create policy hm_nurture_steps_auth_all on public.hm_nurture_steps
for all to authenticated using (true) with check (true);

drop policy if exists hm_nurture_enrollments_auth_all on public.hm_nurture_enrollments;
create policy hm_nurture_enrollments_auth_all on public.hm_nurture_enrollments
for all to authenticated using (true) with check (true);

drop policy if exists hm_nurture_sends_auth_select on public.hm_nurture_sends;
create policy hm_nurture_sends_auth_select on public.hm_nurture_sends
for select to authenticated using (true);

grant select, insert, update, delete on public.hm_nurture_sequences to authenticated, service_role;
grant select, insert, update, delete on public.hm_nurture_steps to authenticated, service_role;
grant select, insert, update, delete on public.hm_nurture_enrollments to authenticated, service_role;
grant select on public.hm_nurture_sends to authenticated;
grant select, insert, update, delete on public.hm_nurture_sends to service_role;

create or replace function public.hm_nurture_questionnaire_submitted(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1
    from public.webinar_geek_questionnaire_submissions q
    where lower(trim(coalesce(q.email, ''))) = lower(trim(coalesce(p_email, '')))
      and (
        q.hiring_stage in ('questionnaire_submitted', 'ready_for_followup')
        or (
          jsonb_typeof(q.answers) = 'array'
          and jsonb_array_length(q.answers) > 0
        )
      )
  );
$fn$;

create or replace function public.hm_nurture_watched_candidates()
returns table (
  email text,
  first_name text,
  last_name text,
  watched_at timestamptz,
  subscription_id text
)
language sql
stable
security definer
set search_path = public
as $fn$
  with snapshot_elems as (
    select elem
    from public.webinar_geek_dashboard_snapshots s
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(s.subscriptions) = 'array' then s.subscriptions
        when jsonb_typeof(s.subscriptions->'subscriptions') = 'array' then s.subscriptions->'subscriptions'
        else '[]'::jsonb
      end
    ) as elem
    where s.id = 'latest'
  ),
  from_snapshot as (
    select
      lower(trim(coalesce(elem->>'email', ''))) as email,
      coalesce(nullif(trim(elem->>'first_name'), ''), nullif(trim(elem->>'firstname'), '')) as first_name,
      coalesce(nullif(trim(elem->>'last_name'), ''), nullif(trim(elem->>'surname'), '')) as last_name,
      coalesce(
        public.hm_nurture_parse_ts(elem->>'watched_true_set_at'),
        public.hm_nurture_parse_ts(elem->>'watch_end'),
        public.hm_nurture_parse_ts(elem->>'updated_at'),
        public.hm_nurture_parse_ts(elem->>'created_at')
      ) as watched_at,
      nullif(trim(elem->>'id'), '') as subscription_id,
      lower(coalesce(elem->>'watched', '')) in ('true', 't', '1', 'yes') as watched_flag,
      greatest(
        public.hm_nurture_parse_num(elem->>'watch_duration'),
        public.hm_nurture_parse_num(elem->>'watch_duration_seconds')
      ) as watch_seconds
    from snapshot_elems
  ),
  snapshot_showed as (
    select email, first_name, last_name, watched_at, subscription_id
    from from_snapshot
    where email like '%@%'
      and watched_at is not null
      and (watched_flag or watch_seconds >= 1410)
  ),
  from_attended as (
    select
      lower(trim(coalesce(q.email, ''))) as email,
      nullif(trim(q.first_name), '') as first_name,
      nullif(trim(q.last_name), '') as last_name,
      coalesce(q.submitted_at, q.created_at) as watched_at,
      nullif(trim(q.subscription_id), '') as subscription_id
    from public.webinar_geek_questionnaire_submissions q
    where q.hiring_stage = 'attended_only'
      and coalesce(q.email, '') <> ''
      and coalesce(q.submitted_at, q.created_at) is not null
  ),
  unioned as (
    select * from snapshot_showed
    union all
    select * from from_attended where email like '%@%'
  )
  select
    u.email,
    (array_agg(u.first_name order by u.watched_at desc nulls last) filter (where u.first_name is not null))[1] as first_name,
    (array_agg(u.last_name order by u.watched_at desc nulls last) filter (where u.last_name is not null))[1] as last_name,
    min(u.watched_at) as watched_at,
    (array_agg(u.subscription_id order by u.watched_at asc nulls last) filter (where u.subscription_id is not null))[1] as subscription_id
  from unioned u
  group by u.email;
$fn$;

create or replace function public.hm_nurture_stop_submitted()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  stopped integer := 0;
begin
  update public.hm_nurture_enrollments e
  set status = 'stopped',
      stop_reason = 'questionnaire_submitted',
      next_send_at = null,
      stopped_at = now(),
      updated_at = now()
  where e.sequence_id = 'webinar-no-questionnaire'
    and e.status = 'active'
    and public.hm_nurture_questionnaire_submitted(e.email);
  get diagnostics stopped = row_count;
  return stopped;
end;
$fn$;

create or replace function public.hm_nurture_stop_for_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if public.hm_nurture_questionnaire_submitted(new.email) then
    perform public.hm_nurture_stop_submitted();
  end if;
  return new;
end;
$fn$;

drop trigger if exists hm_nurture_stop_on_questionnaire on public.webinar_geek_questionnaire_submissions;
create trigger hm_nurture_stop_on_questionnaire
after insert or update of email, hiring_stage, answers
on public.webinar_geek_questionnaire_submissions
for each row
execute function public.hm_nurture_stop_for_email();

create or replace function public.hm_nurture_auto_enroll()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  enrolled integer := 0;
  stopped integer := 0;
  is_enabled boolean := false;
begin
  select s.enabled into is_enabled
  from public.hm_nurture_sequences s
  where s.id = 'webinar-no-questionnaire';

  stopped := public.hm_nurture_stop_submitted();

  if coalesce(is_enabled, false) then
    with candidates as (
      select *
      from public.hm_nurture_watched_candidates() w
      where w.watched_at <= now() - interval '24 hours'
        and w.watched_at >= now() - interval '14 days'
        and not public.hm_nurture_questionnaire_submitted(w.email)
        and not exists (
          select 1
          from public.hm_nurture_enrollments e
          where e.sequence_id = 'webinar-no-questionnaire'
            and e.email = w.email
        )
    ),
    inserted as (
      insert into public.hm_nurture_enrollments (
        sequence_id, email, first_name, last_name, source, status,
        watched_at, subscription_id, current_step, next_step, next_send_at
      )
      select
        'webinar-no-questionnaire',
        c.email,
        c.first_name,
        c.last_name,
        'auto',
        'active',
        c.watched_at,
        c.subscription_id,
        0,
        1,
        greatest(c.watched_at + interval '24 hours', now())
      from candidates c
      on conflict (sequence_id, email) do nothing
      returning id
    )
    select count(*) into enrolled from inserted;
  end if;

  return jsonb_build_object(
    'ok', true,
    'enabled', coalesce(is_enabled, false),
    'enrolled', enrolled,
    'stopped', stopped
  );
end;
$fn$;

create or replace function public.hm_nurture_manual_enroll(
  p_email text,
  p_first_name text default null,
  p_last_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_row public.hm_nurture_enrollments;
  v_watched_at timestamptz;
  v_subscription_id text;
  v_first_name text;
  v_last_name text;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  if v_email = '' or position('@' in v_email) = 0 then
    raise exception 'Enter a valid email';
  end if;
  if public.hm_nurture_questionnaire_submitted(v_email) then
    return jsonb_build_object(
      'ok', false,
      'error', 'This person already submitted the questionnaire. The sequence was not started.'
    );
  end if;

  select w.watched_at, w.subscription_id, w.first_name, w.last_name
  into v_watched_at, v_subscription_id, v_first_name, v_last_name
  from public.hm_nurture_watched_candidates() w
  where w.email = v_email
  limit 1;

  select * into v_row
  from public.hm_nurture_enrollments
  where sequence_id = 'webinar-no-questionnaire'
    and email = v_email;

  if found then
    if v_row.status = 'active' then
      return jsonb_build_object('ok', true, 'already', true, 'enrollment_id', v_row.id, 'status', v_row.status);
    end if;
    if v_row.status = 'completed' then
      return jsonb_build_object('ok', false, 'error', 'This person already finished all 6 emails.');
    end if;
    if v_row.stop_reason = 'questionnaire_submitted' then
      return jsonb_build_object('ok', false, 'error', 'This person already submitted the questionnaire.');
    end if;
    if v_row.stop_reason = 'unsubscribed' then
      return jsonb_build_object('ok', false, 'error', 'This person unsubscribed. The sequence was not restarted.');
    end if;

    update public.hm_nurture_enrollments
    set status = 'active',
        stop_reason = null,
        stopped_at = null,
        source = 'manual',
        first_name = coalesce(nullif(trim(p_first_name), ''), first_name, v_first_name),
        last_name = coalesce(nullif(trim(p_last_name), ''), last_name, v_last_name),
        watched_at = coalesce(watched_at, v_watched_at),
        subscription_id = coalesce(subscription_id, v_subscription_id),
        next_step = least(greatest(current_step + 1, 1), 6),
        next_send_at = now(),
        last_error = null,
        updated_at = now()
    where id = v_row.id
      and current_step < 6
    returning * into v_row;

    if not found then
      return jsonb_build_object('ok', false, 'error', 'This person already finished all 6 emails.');
    end if;
    return jsonb_build_object('ok', true, 'resumed', true, 'enrollment_id', v_row.id);
  end if;

  insert into public.hm_nurture_enrollments (
    sequence_id, email, first_name, last_name, source, status,
    watched_at, subscription_id, current_step, next_step, next_send_at, created_by
  ) values (
    'webinar-no-questionnaire',
    v_email,
    coalesce(nullif(trim(coalesce(p_first_name, '')), ''), v_first_name),
    coalesce(nullif(trim(coalesce(p_last_name, '')), ''), v_last_name),
    'manual',
    'active',
    v_watched_at,
    v_subscription_id,
    0,
    1,
    now(),
    auth.uid()
  )
  returning * into v_row;

  return jsonb_build_object('ok', true, 'created', true, 'enrollment_id', v_row.id);
exception
  when unique_violation then
    return jsonb_build_object('ok', true, 'already', true);
end;
$fn$;

create or replace function public.hm_nurture_search_watchers(
  p_query text default '',
  p_limit integer default 20
)
returns table (
  email text,
  first_name text,
  last_name text,
  watched_at timestamptz,
  questionnaire_submitted boolean,
  enrollment_status text,
  enrollment_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  q text := lower(btrim(coalesce(p_query, '')));
  lim integer := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  return query
  select
    w.email,
    w.first_name,
    w.last_name,
    w.watched_at,
    public.hm_nurture_questionnaire_submitted(w.email) as questionnaire_submitted,
    e.status as enrollment_status,
    e.id as enrollment_id
  from public.hm_nurture_watched_candidates() w
  left join public.hm_nurture_enrollments e
    on e.sequence_id = 'webinar-no-questionnaire'
   and e.email = w.email
  where w.watched_at >= now() - interval '120 days'
    and (
      q = ''
      or w.email like '%' || q || '%'
      or lower(coalesce(w.first_name, '')) like '%' || q || '%'
      or lower(coalesce(w.last_name, '')) like '%' || q || '%'
      or lower(trim(coalesce(w.first_name, '') || ' ' || coalesce(w.last_name, ''))) like '%' || q || '%'
    )
  order by w.watched_at desc
  limit lim;
end;
$fn$;

revoke all on function public.hm_nurture_parse_ts(text) from public, anon;
revoke all on function public.hm_nurture_parse_num(text) from public, anon;
revoke all on function public.hm_nurture_questionnaire_submitted(text) from public, anon, authenticated;
revoke all on function public.hm_nurture_watched_candidates() from public, anon, authenticated;
revoke all on function public.hm_nurture_stop_submitted() from public, anon, authenticated;
revoke all on function public.hm_nurture_stop_for_email() from public, anon;
revoke all on function public.hm_nurture_auto_enroll() from public, anon, authenticated;
revoke all on function public.hm_nurture_manual_enroll(text, text, text) from public, anon;
revoke all on function public.hm_nurture_search_watchers(text, integer) from public, anon;

grant execute on function public.hm_nurture_questionnaire_submitted(text) to service_role;
grant execute on function public.hm_nurture_auto_enroll() to service_role;
grant execute on function public.hm_nurture_stop_submitted() to service_role;
grant execute on function public.hm_nurture_stop_for_email() to service_role, authenticated;
grant execute on function public.hm_nurture_manual_enroll(text, text, text) to authenticated;
grant execute on function public.hm_nurture_search_watchers(text, integer) to authenticated;

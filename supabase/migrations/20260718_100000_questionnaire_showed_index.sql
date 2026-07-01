-- Lightweight showed-attendee index for questionnaire awaiting board (no full snapshot download).

create or replace function public.wg_questionnaire_showed_index(p_since timestamptz default null)
returns setof jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'email', lower(trim(coalesce(elem->>'email', ''))),
    'first_name', elem->>'first_name',
    'last_name', elem->>'last_name',
    'webinar_title', coalesce(
      nullif(trim(elem->>'webinar_title'), ''),
      nullif(trim(elem->>'webinar_name'), ''),
      nullif(trim(elem->>'title'), '')
    ),
    'watched', elem->>'watched',
    'watch_duration', coalesce(elem->>'watch_duration', elem->>'watch_duration_seconds'),
    'watched_true_set_at', elem->>'watched_true_set_at',
    'watch_end', elem->>'watch_end',
    'created_at', elem->>'created_at'
  )
  from public.webinar_geek_dashboard_snapshots s
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(s.subscriptions) = 'array' then s.subscriptions
      when jsonb_typeof(s.subscriptions->'subscriptions') = 'array' then s.subscriptions->'subscriptions'
      else '[]'::jsonb
    end
  ) as elem
  where s.id = 'latest'
    and coalesce(nullif(trim(elem->>'email'), ''), '') <> ''
    and (
      coalesce((elem->>'watched')::boolean, false) = true
      or coalesce(
        nullif(elem->>'watch_duration', '')::numeric,
        nullif(elem->>'watch_duration_seconds', '')::numeric,
        0
      ) >= 1410
    )
    and (
      p_since is null
      or coalesce(
        nullif(elem->>'watched_true_set_at', '')::timestamptz,
        nullif(elem->>'watch_end', '')::timestamptz,
        nullif(elem->>'created_at', '')::timestamptz
      ) >= p_since
    );
$$;

grant execute on function public.wg_questionnaire_showed_index(timestamptz) to authenticated;

create index if not exists webinar_geek_questionnaire_submissions_source_submitted_idx
  on public.webinar_geek_questionnaire_submissions (source_type, submitted_at desc nulls last);

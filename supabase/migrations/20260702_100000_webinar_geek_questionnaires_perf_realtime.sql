-- Faster summary counts + Supabase Realtime for questionnaire submissions.

create index if not exists webinar_geek_questionnaire_submissions_stage_submitted_idx
  on public.webinar_geek_questionnaire_submissions (hiring_stage, submitted_at desc nulls last);

create or replace function public.wg_questionnaire_summary_counts(
  p_date_from timestamptz default null,
  p_date_to timestamptz default null
)
returns json
language sql
stable
security invoker
set search_path = public
as $$
  select json_build_object(
    'total', count(*)::int,
    'withAnswers', count(*) filter (where hiring_stage = 'questionnaire_submitted')::int,
    'attendedOnly', count(*) filter (where hiring_stage = 'attended_only')::int,
    'matchedPipeline', count(*) filter (where pipeline_candidate_id is not null)::int
  )
  from public.webinar_geek_questionnaire_submissions
  where (p_date_from is null or submitted_at >= p_date_from)
    and (p_date_to is null or submitted_at <= p_date_to);
$$;

grant execute on function public.wg_questionnaire_summary_counts(timestamptz, timestamptz) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'webinar_geek_questionnaire_submissions'
  ) then
    alter publication supabase_realtime add table public.webinar_geek_questionnaire_submissions;
  end if;
end $$;

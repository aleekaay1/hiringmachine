-- Run after paste_pipeline_leaderboard_snapshots.sql to allow custom date-range cache keys (e.g. custom:2026-06-01_2026-06-15).

alter table public.pipeline_leaderboard_snapshots
  drop constraint if exists pipeline_leaderboard_snapshots_period_check;

comment on column public.pipeline_leaderboard_snapshots.period is
  'Preset last7 | last30 | thisMonth, or custom:YYYY-MM-DD_YYYY-MM-DD for custom ranges.';

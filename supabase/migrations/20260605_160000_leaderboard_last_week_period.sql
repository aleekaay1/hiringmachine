-- Allow leaderboard snapshot period key `lastWeek` (prior Fri–Thu week).

alter table public.pipeline_leaderboard_snapshots
  drop constraint if exists pipeline_leaderboard_snapshots_period_check;

comment on column public.pipeline_leaderboard_snapshots.period is
  'Preset last7 | lastWeek | last30 | thisMonth, or custom:YYYY-MM-DD_YYYY-MM-DD.';

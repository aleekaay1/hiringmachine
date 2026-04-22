create table if not exists hr_analytics.hr_metrics_cache (
  metric_key text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table hr_analytics.hr_metrics_cache enable row level security;

drop policy if exists hr_metrics_cache_auth_rw on hr_analytics.hr_metrics_cache;
create policy hr_metrics_cache_auth_rw on hr_analytics.hr_metrics_cache
for all to authenticated using (true) with check (true);


# HR Dashboard Beta

Hidden beta route:

- `/hr-dashboard`

No nav/menu link is added intentionally.

## SQL required

Run migration:

- `supabase/migrations/20260422_183900_hr_analytics_foundation.sql`

This creates the `hr_analytics` schema and core objects:

- `hr_candidate_signals`
- `hr_readiness_scores`
- `hr_risk_flags`
- `hr_stage_sla`
- `hr_tasks`, `hr_task_events`
- `hr_stage_events`
- `hr_broadcast_cohorts`
- `hr_funnel_daily` (materialized view)
- operational views (`v_hr_latest_readiness`, `v_hr_open_tasks`)

## Edge functions

Deploy:

```bash
npx supabase functions deploy hr-dashboard-data
npx supabase functions deploy hr-rollup-jobs
npx supabase functions deploy hr-automation-runner
```

Function behavior:

- `hr-dashboard-data` (GET): aggregated dashboard payload
- `hr-rollup-jobs` (POST): compute/write candidate signals, scores, risks, tasks
- `hr-automation-runner` (POST): recommendation engine (dry-run by default)

## Secrets / flags

- `HR_AUTOMATION_ENABLED=true` to allow non-dry-run writes from `hr-automation-runner`.
- Keep dry-run in beta unless explicitly approved.

## Safety guardrails

- Existing admin/candidate pages are untouched.
- New data layer isolated under `hr_analytics`.
- Automation writes are behind runtime flag + dry-run control.


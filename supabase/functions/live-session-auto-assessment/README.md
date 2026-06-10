# live-session-auto-assessment

Runs **~60 minutes after** the Wednesday 11:30 AM ET live session (target **12:30 PM ET**):

1. Re-fetches Zoom participants and re-matches Calendly registrations
2. Updates pipeline stages (invited / attended)
3. Sends the **existing** leadership assessment email (`stage3_assessment_link` template) to eligible portal candidates who showed

## Secrets

- `LIVE_SESSION_AUTO_CRON_SECRET` — required; pass as header `x-cron-secret`
- `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`
- `ZOOM_*` (same as `integrations-zoom-calendly`)
- `ZOOM_LIVE_SESSION_MEETING_ID` — PMI digits
- `SMTP_*` (same as other send functions)

## Deploy

```bash
npx supabase functions deploy live-session-auto-assessment --project-ref YOUR_REF
```

## Schedule (example)

**Supabase Dashboard → Edge Functions → Schedules**, or external cron:

```
POST https://YOUR_REF.supabase.co/functions/v1/live-session-auto-assessment
Header: x-cron-secret: YOUR_SECRET
```

Suggested cron (Eastern): `30 12 * * 3` (12:30 PM every Wednesday).

Dry run:

```
POST .../live-session-auto-assessment?dry_run=true
```

Force a specific session:

```
POST .../live-session-auto-assessment?session_date=2026-06-10
```

## SQL migration

Run `supabase/sql/paste_live_session_assessment_tracking.sql` in the SQL editor before first use.

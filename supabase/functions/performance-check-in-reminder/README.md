# performance-check-in-reminder

Sends mid-week (Monday/Tuesday Toronto) coaching emails to recruiters & leadership below **50% pace** on call and/or booking targets for the current Fri–Thu week.

## Status

**Disabled by default.** Set Edge secret `PERFORMANCE_CHECKIN_AUTOMATION_ENABLED=true` when ready to send live emails.

## Invoke

```bash
curl -X POST "$SUPABASE_URL/functions/v1/performance-check-in-reminder?dry_run=true" \
  -H "x-cron-secret: $PERFORMANCE_CHECKIN_CRON_SECRET"
```

- `dry_run=true` — compute candidates + upsert invites, no SMTP
- `force=true` — run on any weekday (testing)
- Without `dry_run`, emails send only when `PERFORMANCE_CHECKIN_AUTOMATION_ENABLED=true`

## Schedule (when enabled)

Supabase Dashboard → Edge Functions → **performance-check-in-reminder** → Schedules (e.g. Mon & Tue 10:00 America/Toronto).

## Secrets

- `PERFORMANCE_CHECKIN_CRON_SECRET`
- `PERFORMANCE_CHECKIN_AUTOMATION_ENABLED` (`false` until approved)
- `SMTP_*` (same as other staff emails)
- `OPS_APP_URL` (portal base URL for form links)

Form: `/performance-check-in?token=<invite_token>`

Admin review: `/performance-check-ins`

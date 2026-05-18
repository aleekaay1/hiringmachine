# send-leadership-assessment-reminders

Sends **one** email to candidates who:

- Completed reception **check-in** (`applicant_questionnaire.occupation` set, not questionnaire-disqualified),
- Have **not** submitted the Leadership Assessment (`assessment` is null, status not `assessment_complete`),
- Checked in at least **24 hours** ago (`admin_data.checkedInAt`, or `candidates.timestamp` if missing),
- Have not already received this reminder (`admin_data.leadershipAssessmentReminder24hSentAt` unset).

## Security

`POST` requires header:

`x-cron-secret: <LEADERSHIP_REMINDER_CRON_SECRET>`

Set the secret in Supabase **Edge Functions → Secrets**. Without it, the function returns 503.

## Schedule

In Supabase Dashboard: **Edge Functions → send-leadership-assessment-reminders → Schedules** (e.g. every hour).

Or call manually:

```bash
curl -X POST "$SUPABASE_URL/functions/v1/send-leadership-assessment-reminders" \
  -H "x-cron-secret: YOUR_SECRET" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "apikey: $SUPABASE_ANON_KEY"
```

Dry run (no sends): append `?dry_run=true`.

## Other secrets

Same SMTP variables as `send-candidate-email` (`SMTP_HOSTNAME`, `SMTP_USERNAME`, `SMTP_PASSWORD`, etc.) and `PUBLIC_ASSESSMENT_LOOKUP_URL` if the default lookup URL should differ.

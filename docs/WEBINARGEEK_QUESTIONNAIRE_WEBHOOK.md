# WebinarGeek questionnaire webhook (real-time)

When a viewer submits a post-webinar **evaluation form**, WebinarGeek can POST to our portal immediately. We save answers, match the candidate/recruiter, and create **bell notifications**.

## 1) Deploy the function

```bash
supabase functions deploy webinar-geek-questionnaire-webhook --project-ref hlfufjrjztuknioydlut
```

## 2) Set Edge secrets

```bash
supabase secrets set WEBINARGEEK_WEBHOOK_SECRET="pick-a-long-random-string" --project-ref hlfufjrjztuknioydlut
```

Optional public URL override (if using a custom domain):

```bash
supabase secrets set WEBINARGEEK_WEBHOOK_PUBLIC_URL="https://hlfufjrjztuknioydlut.supabase.co/functions/v1/webinar-geek-questionnaire-webhook?secret=YOUR_SECRET"
```

## 3) Run SQL (if not done)

- `supabase/sql/paste_webinar_geek_questionnaires.sql`
- `supabase/sql/paste_webinar_geek_webhook_events.sql`

## 4) Register in WebinarGeek

1. WebinarGeek → **Integrations** → **Webhooks**
2. Add endpoint URL:

   `https://hlfufjrjztuknioydlut.supabase.co/functions/v1/webinar-geek-questionnaire-webhook?secret=YOUR_SECRET`

3. Trigger: **New evaluation form** (evaluation form submitted)

Test: open the URL in a browser (GET) — should return JSON with `ok: true` and setup hints.

## What happens on each webhook

1. Payload parsed → normalized questionnaire row
2. Upsert into `webinar_geek_questionnaire_submissions` (`source_type = wg_webhook`)
3. Match pipeline candidate + booking recruiter by email / custom field
4. Notifications:
   - Recruiter who booked the lead (if matched)
   - Broadcast to admin / leadership / hr / webinar roles

Manual **Sync questionnaires** remains for historical backfill only.

## Audit

Inbound payloads are logged in `webinar_geek_webhook_events` (admin/leadership can read).

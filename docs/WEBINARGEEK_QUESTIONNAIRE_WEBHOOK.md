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

## API vs webhook (important)

| What | Where it lives | What it does |
|------|----------------|--------------|
| `WEBINARGEEK_API_TOKEN` | Supabase Edge secrets | **Pull** subscriptions from WebinarGeek. Evaluation answers are on each subscription as `evaluation_form_answers` (not a separate bulk endpoint). |
| `WEBINARGEEK_WEBHOOK_SECRET` | Supabase Edge secrets | **Push** — validates incoming POSTs from WebinarGeek. Does nothing until you register the webhook URL inside WebinarGeek. |

Setting the API token in Supabase is **not enough** for live delivery. You must also register the webhook in WebinarGeek (steps below).

## WebinarGeek setup (required once)

1. Log in to **WebinarGeek** → **Account** (top right) → **Integrations** → **Webhooks**
2. **Add webhook** / connect Webhooks integration
3. **Endpoint URL** (replace `YOUR_SECRET` with the value of `WEBINARGEEK_WEBHOOK_SECRET` in Supabase):

   `https://hlfufjrjztuknioydlut.supabase.co/functions/v1/webinar-geek-questionnaire-webhook?secret=YOUR_SECRET`

4. **Trigger:** `New evaluation form` (fires when a viewer submits the post-webinar evaluation)
5. Scope: account-level (all webinars) or per webinar — your choice
6. Each webinar must have an **evaluation form** enabled (webinar settings → evaluation form)

The leader email (`noreply@globelife-paz.com`) is WebinarGeek's built-in notification — it does **not** automatically send data to Paz. Only the webhook (or API import) does.

## Backfill (last 15 days)

In Paz: **Webinar questionnaires** → **Import last 15 days**. This re-fetches subscriptions from the API and reads `evaluation_form_answers` on each row.

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

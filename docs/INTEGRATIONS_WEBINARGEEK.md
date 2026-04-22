# WebinarGeek Integration Setup

This project now includes a full admin dashboard page at:

- `/webinar-geek`

The page uses the Supabase Edge Function:

- `integrations-webinar-geek`

## 1) Set secrets in Supabase

Set these in **Supabase Dashboard → Edge Functions → Secrets** (or CLI):

- `WEBINARGEEK_API_TOKEN` (required)  
  - Your WebinarGeek API key.
- `WEBINARGEEK_API_BASE_URL` (optional)  
  - Default: `https://app.webinargeek.com/api/v2`

Supabase built-in values are also required (already present in normal projects):

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

### CLI example

```bash
supabase secrets set WEBINARGEEK_API_TOKEN="your-token-here"
supabase secrets set WEBINARGEEK_API_BASE_URL="https://app.webinargeek.com/api/v2"
```

## 2) Deploy the function

```bash
supabase functions deploy integrations-webinar-geek
```

## 3) Data fetched in dashboard mode

The dashboard fetches all major resources WebinarGeek exposes:

- Account (`/account`)
- Webinars (`/webinars`)
- Broadcasts (`/broadcasts`)
- Subscriptions / invitees / attendance (`/subscriptions`)
- Questions (`/questions`)
- Messages (`/messages`)
- Subscription payments (`/subscription_payments`)

Optional filters:

- `webinar_id`
- `broadcast_id`
- `watched_webinar`
- `watched_live`
- `watched_replay`

## 4) Management controls included

Supported actions:

- `create_broadcast` → `POST /episodes/broadcasts`
- `unsubscribe_subscription` → `POST /subscriptions/unsubscribe`
- `create_subscription` → `POST /broadcasts/subscriptions`

These are sent through the Edge Function so your API token stays server-side.

## 5) Security note

Do **not** place WebinarGeek API keys in frontend env vars.  
Only store keys in Supabase Edge Function secrets.

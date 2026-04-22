# Zoom + Calendly (live overview dashboard)

The **Live sessions** page (`/live-sessions`) loads data through the Edge Function `integrations-zoom-calendly`. Secrets stay in Supabase; the browser only sends the signed-in user’s JWT.

## What you need

1. **Zoom — Server-to-Server OAuth app** (Zoom Marketplace → Develop → Build App → Server-to-Server OAuth).
   - Activate the app and note **Account ID**, **Client ID**, and **Client Secret**.
   - Zoom uses **granular scopes** (names like `resource:action:object:admin`). In the app’s **Scopes** tab, use the search box and add these exact strings (they are the current names from Zoom’s [granular scopes reference](https://developers.zoom.us/docs/integrations/oauth-scopes-granular/)):

   | Scope to search / add | Used for |
   |------------------------|----------|
   | `user:read:user:admin` | Resolve the host user (`GET /users/{userId}`) |
   | `meeting:read:list_meetings:admin` | List past meetings for a user |
   | `meeting:read:list_upcoming_meetings:admin` | List upcoming meetings for a user |
   | `report:read:list_meeting_participants:admin` | Participant report (who joined) for past meetings |

   Optional if Zoom returns an error for a specific endpoint: `meeting:read:list_past_instances:admin` (past instances).

   **If the UI doesn’t show these:** ensure the app type is **Server-to-Server OAuth**, open **Scopes** → **Add** → search **granular** (or paste the full string). If your account still uses legacy “classic” scopes, the Zoom docs above map each API method to the required granular scope.

   After any **403** or “invalid scope” from the API, add the scope the error message names, or find the API method in the [granular scopes doc](https://developers.zoom.us/docs/integrations/oauth-scopes-granular/) and add the listed scope.

2. **Host user email** — the Zoom user whose meetings you list (same account as the OAuth app), e.g. `alex@yourdomain.com`. Set as `ZOOM_HOST_USER_EMAIL`.

3. **Calendly — Personal Access Token (optional)**
   - Omit this to run **Zoom-only**: past/upcoming meetings and Zoom participants still load; Calendly columns stay empty.
   - When you are ready: Calendly → Integrations → API & Webhooks → **Personal access tokens** → Generate.
   - Set as `CALENDLY_API_TOKEN` in Supabase secrets.

## Where each credential comes from

### Zoom (Marketplace → your Server-to-Server OAuth app)

| Supabase secret name | Where you copy it from in Zoom |
|---------------------|--------------------------------|
| `ZOOM_ACCOUNT_ID` | App **App Credentials** tab → **Account ID** |
| `ZOOM_CLIENT_ID` | Same tab → **Client ID** |
| `ZOOM_CLIENT_SECRET` | Same tab → **Client Secret** (click show / regenerate if needed) |
| `ZOOM_HOST_USER_EMAIL` | **Not** from the app — this is the **Zoom sign-in email** of the person whose meetings you want on the dashboard (must be a user in your Zoom account). Example: `alex@yourcompany.com` |

Do **not** put Zoom secrets in `.env` or `VITE_*` — only in Supabase Edge Function secrets below.

### Calendly (optional)

| Supabase secret name | Where you copy it from |
|---------------------|-------------------------|
| `CALENDLY_API_TOKEN` | Calendly → **Integrations** → **API & Webhooks** → **Personal access tokens** → **Generate new token** (copy once; Calendly may not show it again). If unset, the dashboard shows Zoom data only (`calendly_configured: false` in the API response). |

The token is tied to **your Calendly user**; scheduled events and invitees are loaded for that user’s calendar.

### Where meeting rows come from (past vs upcoming)

The dashboard does **not** invent meetings. Each row is built from **Zoom’s REST API**:

- **Past list:** `GET /users/{userId}/meetings?type=past` (scheduled meetings Zoom considers “past”).
- **Upcoming list:** `GET /users/{userId}/meetings?type=upcoming`.

Zoom sometimes returns a session in the **wrong** list (e.g. a future occurrence). The Edge Function **merges both lists**, parses each row’s `start_time` + `timezone`, and **re-buckets** by comparing the real start instant to the current time, so a future start (such as Dec 30, 2026) should appear under **Upcoming**, not **Past**. If `timezone` is missing or non-IANA, parsing falls back to **`America/Toronto`** (override with optional secret **`ZOOM_ASSUMED_TIMEZONE_IF_MISSING`**).

### Supabase (automatic — do not set manually)

Edge Functions already receive `SUPABASE_URL` and `SUPABASE_ANON_KEY` from the project. You do **not** add these as custom secrets for this integration.

---

## Supabase secrets (what to put in the dashboard)

**Dashboard path:** Supabase project → **Project Settings** (gear) → **Edge Functions** → **Secrets** → **Add new secret**.

**Adding a secret:** open **Secrets** → **Add new secret** → **Name** must match the table exactly (e.g. `ZOOM_LIVE_SESSION_STRICT_TIME_SLOTS`) → **Value** is usually `1` or `true` for flags (no wrapping quotes in the UI) → save. New values apply on the next request to `integrations-zoom-calendly`; redeploy is only needed after **code** changes.

Add the **required** Zoom secrets below. Optionally add Calendly and/or filters (recommended if the host runs many meetings).

| Name | Required? | Value |
|------|-----------|--------|
| `ZOOM_ACCOUNT_ID` | Yes | Zoom app **Account ID** |
| `ZOOM_CLIENT_ID` | Yes | Zoom app **Client ID** |
| `ZOOM_CLIENT_SECRET` | Yes | Zoom app **Client Secret** |
| `ZOOM_HOST_USER_EMAIL` | Yes | Host’s Zoom login email (plain text, no quotes) |
| `ZOOM_LIVE_SESSION_MEETING_ID` | No | Digits-only Zoom meeting id for live overview. If unset, no meeting-id filtering is applied. Set `*` or `any` to explicitly disable PMI / join-URL filtering. |
| `ZOOM_LIVE_SESSION_TOPIC_REQUIRES_MEETING_ID` | No | `1` or `true`: when PMI filter is on, Zoom **topic** must also contain that meeting id as text (embed the id in the topic if needed). |
| `ZOOM_LIVE_SESSION_STRICT_TIME_SLOTS` | No | Only rows whose start in **America/Toronto** is **Tuesday 18:00–19:00** or **Wednesday 11:30–12:30**. **Default OFF**; set `1` / `true` to enable strict time-slot filtering. |
| `ZOOM_LIVE_SESSION_TOPIC_FILTER` | No | Zoom **meeting topic** substring filter — see below |
| `CALENDLY_EVENT_NAME_FILTER` | No | Calendly **event name** substring filter (e.g. `career` for “Live Online Career Session”) — independent from Zoom |
| `INTEGRATION_MATCH_TOLERANCE_MINUTES` | No | Max start-time difference for Zoom↔Calendly pairing (default **120**; integer, max 1440) |
| `ZOOM_ASSUMED_TIMEZONE_IF_MISSING` | No | IANA zone for naive `start_time` when Zoom omits `timezone` (default **America/Toronto**) |
| `CALENDLY_API_TOKEN` | No | Calendly personal access token |

**CLI alternative** (from repo root, after `supabase link` — see deploy section):

```bash
supabase secrets set ZOOM_ACCOUNT_ID="paste_account_id" ZOOM_CLIENT_ID="paste_client_id" ZOOM_CLIENT_SECRET="paste_secret" ZOOM_HOST_USER_EMAIL="host@yourdomain.com" CALENDLY_API_TOKEN="paste_calendly_pat"
```

Add the topic filter in a second command if needed (see below).

(On Windows PowerShell you may need to set secrets one at a time if quoting is awkward; the Dashboard is often easier.)

### Filters: Zoom topic vs Calendly event name (independent)

These are **two separate** optional secrets:

1. **`ZOOM_LIVE_SESSION_TOPIC_FILTER`** — applies only to **Zoom** (`GET /users/.../meetings`). The Zoom **Topic** field must **contain** one of the pipe-separated substrings (case-insensitive). Example: `overview` if your Zoom title always includes that word.

2. **`CALENDLY_EVENT_NAME_FILTER`** — applies only to **Calendly** scheduled events. The Calendly **event type name** (what guests see, e.g. “Live Online Career Session”) must **contain** one of the substrings. Example: `career` or `Live Online Career`.

Use **`|`** for OR alternatives, e.g. `career|online session`.

**Why two filters:** Your Zoom meeting title and Calendly event name are often **worded differently**. Calendly loads **invitees** only from events that pass the Calendly filter; those are **matched to Zoom** by **UTC start time** within a tolerance window (default **120 minutes**, override with **`INTEGRATION_MATCH_TOLERANCE_MINUTES`** in Edge secrets). Calendly results are **paginated** (all pages), so bookings are not limited to the first 100 events. Zoom lists **participants** from meetings that pass the Zoom filter. Both filters should describe the **same real-world session** so invitee vs attendance rows line up.

If **`CALENDLY_EVENT_NAME_FILTER`** is unset (empty), all Calendly events in the date range are considered (can be noisy). If **`ZOOM_LIVE_SESSION_TOPIC_FILTER`** is unset, all Zoom meetings for the host are listed.

Redeploy the Edge Function after **code** changes; secret-only updates apply on the next request.

---

## Deploy the Edge Function

Deployment must be run on **your** machine (or CI) while logged into Supabase — the repo does not contain your project ref.

1. **Install CLI** (if needed): `npm i -g supabase` or use `npx supabase`.
2. **Log in:** `supabase login`
3. **Link this repo to your project** (project ref is in the Supabase Dashboard URL: **Project Settings → General → Reference ID**, or the subdomain of `https://YOUR_REF.supabase.co`):

   ```bash
   cd /path/to/POhiring
   supabase link --project-ref YOUR_PROJECT_REF
   ```

4. **Set secrets** (Dashboard or `supabase secrets set` above).
5. **Deploy:**

   ```bash
   supabase functions deploy integrations-zoom-calendly
   ```

   Or without a linked project:

   ```bash
   supabase functions deploy integrations-zoom-calendly --project-ref YOUR_PROJECT_REF
   ```

6. Confirm in Dashboard: **Edge Functions** → `integrations-zoom-calendly` appears and logs are empty or 200 on first test.

After deploy, open your **hosted** app (or local dev with valid `VITE_SUPABASE_*`) and go to **`/live-sessions`**, sign in with admin credentials, and tap **Refresh**.

## How matching works

- **Zoom topic filter:** If `ZOOM_LIVE_SESSION_TOPIC_FILTER` is set, only Zoom meetings whose **topic** contains one of the pipe-separated substrings are listed.
- **Calendly name filter:** If `CALENDLY_EVENT_NAME_FILTER` is set, only Calendly events whose **name** contains one of the substrings are loaded (invitees + matching to Zoom).
- **Past Zoom meetings** are listed for `ZOOM_HOST_USER_EMAIL`.
- **Participant emails** come from Zoom’s **report** API (past meetings).
- **Calendly** events are loaded for the token’s user over a date range (past ~120 days, future ~60 days).
- A Calendly event is **matched** to a Zoom meeting when **UTC start times** differ by no more than **`INTEGRATION_MATCH_TOLERANCE_MINUTES`** (default **120**). Zoom `start_time` is interpreted using the meeting **`timezone`** when the API omits `Z`/offset (avoids “same wall time” appearing hours apart from Calendly).
- **Invited** = Calendly invitees (excluding canceled). **Attended (matched)** = invitee email also appears in the Zoom participant report. **Absent** = invited but email not in Zoom participants. **Zoom-only** = joined Zoom but not on the Calendly invite list for that matched event.

If times differ by more than your tolerance or events use different hosts, you may see “No Calendly match”. Ensure Calendly and Zoom use the **same start instant**, or increase **`INTEGRATION_MATCH_TOLERANCE_MINUTES`** (still keep it tight to avoid wrong-pair matches).

## Frontend

- Route: `/live-sessions`
- Same Supabase Auth as Admin (use your admin email/password).
- Requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the web app (already used elsewhere).
- On **Admin** routes (Dashboard, Live sessions, QR), the header shows **Zoom / Calendly** status dots (green = API OK, red = error, gray Calendly dot = token not set). This calls `GET .../integrations-zoom-calendly?health=1` (lightweight, no meeting list).
- **Upcoming schedule:** each row expands to show **Calendly invitee names** (from the matched scheduled event). **Past meetings** still show invitees + Zoom attendance after the session.

## Troubleshooting

- **401** — Sign in again on `/live-sessions` or `/admin`.
- **Zoom OAuth failed** — Check Account ID, Client ID, Secret, and that the Server-to-Server app is activated.
- **Zoom user not found** — `ZOOM_HOST_USER_EMAIL` must exactly match a user in the Zoom account.
- **Empty past meetings** — Host may have no past meetings in Zoom’s API window; check Zoom web portal.
- **Empty participants** — Report API requires the meeting UUID; very old meetings or permissions may block reports.

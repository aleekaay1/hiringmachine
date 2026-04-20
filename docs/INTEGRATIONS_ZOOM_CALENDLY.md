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

3. **Calendly — Personal Access Token**
   - Calendly → Integrations → API & Webhooks → **Personal access tokens** → Generate.
   - The token is used as `CALENDLY_API_TOKEN`.

## Supabase secrets

In the Supabase Dashboard: **Project Settings → Edge Functions → Secrets**, add:

| Secret | Description |
|--------|-------------|
| `ZOOM_ACCOUNT_ID` | From the Server-to-Server OAuth app |
| `ZOOM_CLIENT_ID` | From the same app |
| `ZOOM_CLIENT_SECRET` | From the same app |
| `ZOOM_HOST_USER_EMAIL` | Zoom login email for the host whose meetings appear |
| `CALENDLY_API_TOKEN` | Calendly personal access token |

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are provided automatically to functions; you do not set them manually.

## Deploy the function

From the repo root (with Supabase CLI linked to your project):

```bash
supabase functions deploy integrations-zoom-calendly
```

## How matching works

- **Past Zoom meetings** are listed for `ZOOM_HOST_USER_EMAIL`.
- **Participant emails** come from Zoom’s **report** API (past meetings).
- **Calendly** events are loaded for the token’s user over a date range (past ~120 days, future ~60 days).
- A Calendly event is **matched** to a Zoom meeting when **start times** are within **10 minutes** (same session, minor clock / timezone differences).
- **Invited** = Calendly invitees (excluding canceled). **Attended (matched)** = invitee email also appears in the Zoom participant report. **Absent** = invited but email not in Zoom participants. **Zoom-only** = joined Zoom but not on the Calendly invite list for that matched event.

If times differ by more than 10 minutes or events use different hosts, you may see “No Calendly match” for a meeting; adjust your scheduling so Zoom and Calendly share the same start time, or narrow the window in `integrations-zoom-calendly/index.ts` (`10 * 60 * 1000`).

## Frontend

- Route: `/live-sessions`
- Same Supabase Auth as Admin (use your admin email/password).
- Requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the web app (already used elsewhere).

## Troubleshooting

- **401** — Sign in again on `/live-sessions` or `/admin`.
- **Zoom OAuth failed** — Check Account ID, Client ID, Secret, and that the Server-to-Server app is activated.
- **Zoom user not found** — `ZOOM_HOST_USER_EMAIL` must exactly match a user in the Zoom account.
- **Empty past meetings** — Host may have no past meetings in Zoom’s API window; check Zoom web portal.
- **Empty participants** — Report API requires the meeting UUID; very old meetings or permissions may block reports.

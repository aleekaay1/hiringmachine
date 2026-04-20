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

## Where each credential comes from

### Zoom (Marketplace → your Server-to-Server OAuth app)

| Supabase secret name | Where you copy it from in Zoom |
|---------------------|--------------------------------|
| `ZOOM_ACCOUNT_ID` | App **App Credentials** tab → **Account ID** |
| `ZOOM_CLIENT_ID` | Same tab → **Client ID** |
| `ZOOM_CLIENT_SECRET` | Same tab → **Client Secret** (click show / regenerate if needed) |
| `ZOOM_HOST_USER_EMAIL` | **Not** from the app — this is the **Zoom sign-in email** of the person whose meetings you want on the dashboard (must be a user in your Zoom account). Example: `alex@yourcompany.com` |

Do **not** put Zoom secrets in `.env` or `VITE_*` — only in Supabase Edge Function secrets below.

### Calendly

| Supabase secret name | Where you copy it from |
|---------------------|-------------------------|
| `CALENDLY_API_TOKEN` | Calendly → **Integrations** → **API & Webhooks** → **Personal access tokens** → **Generate new token** (copy once; Calendly may not show it again). |

The token is tied to **your Calendly user**; scheduled events and invitees are loaded for that user’s calendar.

### Supabase (automatic — do not set manually)

Edge Functions already receive `SUPABASE_URL` and `SUPABASE_ANON_KEY` from the project. You do **not** add these as custom secrets for this integration.

---

## Supabase secrets (what to put in the dashboard)

**Dashboard path:** Supabase project → **Project Settings** (gear) → **Edge Functions** → **Secrets** → **Add new secret**.

Add **five** secrets (names must match exactly):

| Name | Value |
|------|--------|
| `ZOOM_ACCOUNT_ID` | Zoom app **Account ID** |
| `ZOOM_CLIENT_ID` | Zoom app **Client ID** |
| `ZOOM_CLIENT_SECRET` | Zoom app **Client Secret** |
| `ZOOM_HOST_USER_EMAIL` | Host’s Zoom login email (plain text, no quotes) |
| `CALENDLY_API_TOKEN` | Calendly personal access token |

**CLI alternative** (from repo root, after `supabase link` — see deploy section):

```bash
supabase secrets set ZOOM_ACCOUNT_ID="paste_account_id" ZOOM_CLIENT_ID="paste_client_id" ZOOM_CLIENT_SECRET="paste_secret" ZOOM_HOST_USER_EMAIL="host@yourdomain.com" CALENDLY_API_TOKEN="paste_calendly_pat"
```

(On Windows PowerShell you may need to set secrets one at a time if quoting is awkward; the Dashboard is often easier.)

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

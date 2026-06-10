# Pipeline + 3CX Setup

This document covers the required setup to run `/pipeline` end-to-end.

## 1) Run database migration

Apply:

- `supabase/migrations/20260510_200000_pipeline_3cx_foundation.sql`

Or paste:

- `supabase/sql/paste_pipeline_3cx_foundation.sql`

This creates:

- `public.pipeline_candidates`
- `public.pipeline_resumes`
- `public.pipeline_notes`
- `public.pipeline_evaluations`
- `public.pipeline_call_logs`
- Storage bucket `pipeline-resumes` + authenticated storage policies

## 2) Deploy edge functions

Deploy:

- `supabase/functions/threecx-call-control`
- `supabase/functions/pipeline-convert-resume`

Commands:

```bash
npx supabase functions deploy threecx-call-control
npx supabase functions deploy pipeline-convert-resume
```

## 3) Configure Supabase function secrets

### Required for 3CX call control

- `THREECX_BASE_URL` (example: `https://pbx.example.com`)
- `THREECX_CLIENT_ID`
- `THREECX_CLIENT_SECRET`

### Optional 3CX overrides

- `THREECX_TOKEN_URL` (if not `${THREECX_BASE_URL}/connect/token`)

### Required for doc conversion (non-PDF/image)

- `PIPELINE_DOC_CONVERTER_URL` (HTTP endpoint that accepts `input_url`, `filename`, `output=pdf`)
- `PIPELINE_DOC_CONVERTER_API_KEY` (optional bearer key used by converter)

Set via:

```bash
npx supabase secrets set THREECX_BASE_URL=...
npx supabase secrets set THREECX_CLIENT_ID=...
npx supabase secrets set THREECX_CLIENT_SECRET=...
npx supabase secrets set PIPELINE_DOC_CONVERTER_URL=...
```

## 4) Frontend environment values

In `.env`:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_3CX_WEBCLIENT_URL` (optional fallback launch URL used by \"Open 3CX web client fallback\")

## 5) 3CX values needed from your PBX admin

Provide these to finalize production behavior:

1. 3CX API base URL and exact API version documentation link
2. OAuth client credentials (client id/secret)
3. HR extension mapping strategy (single shared extension vs per-user extension)
4. Allowed call-control surface (dial, transfer, hold/resume, mute, DTMF, active calls, agent state)
5. Any IP allowlist / network restrictions for Supabase egress to 3CX

## 6) Call recordings for `/call-log`

The Call Log page (`/call-log`, admins + ali + hr.licensing) shows disposition rows from
`pipeline_call_records`. Recording playback needs a URL per call — the Call Control API alone does
not reliably expose finished recording links.

### Recommended: 3CX CRM integration (ReportCall webhook)

1. In 3CX Management Console → **Integrations** → **CRM**, create a template with scenario
   **ReportCall** (fires when a call ends).
2. POST to your Supabase edge function URL, e.g.
   `https://<project>.supabase.co/functions/v1/threecx-call-webhook`
3. Include placeholders in the JSON body (names vary slightly by 3CX version; confirm in CRM editor):

   - `[RecordingUrl]` — direct HTTPS link to the WAV/MP3 (may be tokenized / time-limited)
   - `[CallHistoryId]` or equivalent unique call id
   - `[Duration]` — talk time in seconds
   - `[CallerNumber]` / `[CalledNumber]` — match to `dialed_number`
   - `[AgentExtension]` or `[Extension]` — match to recruiter via `pipeline_user_call_settings.extension`
   - `[Direction]` — inbound vs outbound
   - `[StartTime]` / `[EndTime]` — ISO timestamps for matching

4. Edge function matches the webhook to the nearest `pipeline_call_records` row (extension + number +
   time window) and sets `recording_url`, `threecx_call_id`, `duration_seconds`.

5. Run SQL: `supabase/sql/paste_pipeline_call_recordings.sql`

### What to request from your 3CX / IT team

| Item | Why |
|------|-----|
| Call recording **enabled** on recruiter extensions / outbound routes | No recording → no `[RecordingUrl]` |
| CRM **ReportCall** webhook URL allowlisted (3CX → Supabase) | Inbound POST from PBX |
| Sample `[RecordingUrl]` from a test call | Confirm format, auth (cookie/token/query), and browser playback |
| Whether URLs are **public HTTPS** or need **OAuth proxy** through your edge function | Affects `<audio>` in-browser vs download-only |
| Extension ↔ recruiter mapping | Each recruiter’s 3CX extension in Account → Call settings |
| Recording **retention** policy | Links may expire; note compliance requirements |
| Optional: xAPI **Call History** docs if CRM path unavailable | Fallback to poll history + recording API |

### Browser playback vs download

Prefer in-browser listen: store a URL that returns `audio/wav` or `audio/mpeg` with CORS allowing
your app origin (or serve via a signed proxy edge function). If 3CX only returns auth-gated links,
add `threecx-recording-proxy` that exchanges OAuth and streams audio to the browser.

## 7) Notes on current implementation

- `/pipeline` is routed in app but intentionally **not** added to sidebar menu.
- Bulk upload creates candidate shells and resume rows automatically.
- PDF + image are displayed inline directly.
- DOC/DOCX/RTF/TXT conversion is handled through `pipeline-convert-resume`; it requires converter secrets.
- 3CX controls call the edge function and every action is logged to `pipeline_call_logs`.
- Fallback button opens web client URL in a new tab if configured.
- `/call-log` reads dispositions now; recordings populate after CRM webhook + SQL migration above.

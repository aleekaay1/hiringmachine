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

## 6) Call recordings for `/call-log` (no Call Control changes)

Dialing stays as-is (3CX web client in a new tab). Recordings use **CRM ReportCall** only.

**Full checklist:** [`docs/threecx/RECORDING-SETUP.md`](threecx/RECORDING-SETUP.md)

**CRM template to upload in 3CX:** [`docs/threecx/paz-hiring-call-recording-crm.xml`](threecx/paz-hiring-call-recording-crm.xml)

Quick summary:

1. Run `supabase/sql/paste_pipeline_call_recordings.sql` (once).
2. Deploy `threecx-call-webhook` and set `THREECX_WEBHOOK_SECRET`.
3. In 3CX: **Settings → CRM Integration → Server side → + Add** → upload the XML template.
4. Enter Supabase anon key + webhook secret in the template settings.
5. Enable **Record calls** on each recruiter extension.
6. Each recruiter sets their **3CX extension** in Account → Call settings.

## 7) Notes on current implementation

- `/pipeline` is routed in app but intentionally **not** added to sidebar menu.
- Bulk upload creates candidate shells and resume rows automatically.
- PDF + image are displayed inline directly.
- DOC/DOCX/RTF/TXT conversion is handled through `pipeline-convert-resume`; it requires converter secrets.
- 3CX controls call the edge function and every action is logged to `pipeline_call_logs`.
- Fallback button opens web client URL in a new tab if configured.
- `/call-log` reads dispositions now; recordings populate after CRM webhook + SQL migration above.

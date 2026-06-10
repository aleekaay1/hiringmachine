# 3CX recordings → Call Log — simple setup

**You do NOT need PostgreSQL CRM, Bitrix, or any premade CRM template.**

Our file `paz-hiring-call-recording-crm.xml` only sends **finished call data + recording link** to the portal when a call ends. It does **not** look up contacts inside 3CX — that is intentional. Recruiters keep using the portal + 3CX web client in a new tab exactly as today.

---

## Important: “Contact not found” on 3CX TEST is normal

When you click **TEST** in 3CX CRM settings, 3CX tries **contact lookup by phone number**.

Our template **does not include contact lookup** — only **ReportCall** (after hangup).

So you may see:

- ✅ Test connection / template loads fine  
- ❌ “Contact number not found” on TEST  

**That is OK.** Ignore the TEST for phone lookup.

The real test: make a real call, hang up, save disposition in the portal, then check **Call log** for a recording link.

Also make sure the dropdown says **“PAZ Hiring Call Log”** — **not** “Database PostgreSQL”.

---

## Step 1 — Supabase (already done)

- Edge function **`threecx-call-webhook`** — deployed
- Secret **`THREECX_WEBHOOK_SECRET`** — set in Supabase
- Anon key + webhook URL + secret — baked into XML Version 3 (no typing in 3CX UI)

---

## Step 2 — 3CX Cloud: upload template (no form fields — that’s normal)

**3CX Cloud does not show “Server side / Client side” tabs.** One CRM page only.

1. **Settings** → **CRM**
2. **Delete** the old “PAZ Hiring Call Log” if already uploaded
3. **+ Add Template** → upload `docs/threecx/paz-hiring-call-recording-crm.xml` (**Version 3**)
4. Dropdown **Select a CRM Solution** → **PAZ Hiring Call Log**
5. You will only see:
   - Query CRM (leave **Always query** or **Only if no local match** — either is fine)
   - Optional phonebook checkbox (leave **unchecked**)
6. Click **Save**

**No Webhook URL / anon key / secret fields appear on 3CX Cloud — that is expected.**

Version 3 embeds everything inside the XML (URL, anon key, webhook secret). Nothing to type in the UI.

`THREECX_WEBHOOK_SECRET` is already set in Supabase.

You do **not** need OAuth, PostgreSQL, or SQL fields.

---

## Step 3 — 3CX: turn on call recording

For **each recruiter extension** (e.g. Hassaan’s):

1. **Users** → click the user → **Options** (or edit extension)
2. Enable **Record Calls** (inbound and/or outbound as you require)
3. **Save**

Also check: **Recordings** in left menu → confirm recordings are enabled system-wide and retention is long enough.

**No recording = empty `[RecordingUrl]` = no link in Call log.**

---

## Step 4 — 3CX: note each recruiter’s extension number

For Hassaan (example):

1. **Users** → Hassaan → note **Extension** (e.g. `104`, `802`, etc.)
2. In the portal: **Account** → **Call settings** → enter the **same extension number**

The webhook matches calls using: **extension + dialed phone number + time**.

| Where | What to copy |
|-------|----------------|
| 3CX → Users → recruiter → Extension | e.g. `104` |
| Portal → Account → Call settings → Extension | Same number |

---

## Step 5 — Real test (ignore CRM phone TEST)

1. Hassaan dials a lead from the portal (web client tab — same as now)
2. Talk briefly, hang up
3. Save disposition in Call workspace
4. Wait ~30 seconds
5. Open **Insights → Call log** → find the row → **Recording** column

Optional: Supabase → **Edge Functions** → `threecx-call-webhook` → **Logs** — you should see POSTs after each completed call.

### Call log connection panel

On **Insights → Call log**, the green/amber banner shows:

- **Webhook** — whether 3CX has sent events recently (ping or ReportCall)
- **Today** — webhook calls and recordings attached today
- **3CX API** — whether backfill can talk to 3CX (needs API secrets below)

Buttons:

| Button | What it does |
|--------|----------------|
| **Sync extensions** | Copies hardcoded recruiter extensions from `recruiter3cxExtensions.ts` into each user’s profile — recruiters do not need to set extensions in Settings |
| **Sync recordings** / **Refresh** | Replays stored 3CX webhooks and matches recording URLs to disposition rows (dispositions are usually saved a few seconds after hangup) |

---

## Hardcoded recruiter extensions

Edit `supabase/functions/_shared/recruiter3cxExtensions.ts` — one row per recruiter:

```ts
{ name: 'Hassaan Ali', email: 'hassaan@globelife-paz.com', extension: '104' },
```

Deploy `threecx-call-admin`, then click **Sync extensions** on Call log (or redeploy after editing the file).

---

## Backfill API secrets (optional, for today's recordings)

Set in Supabase → **Project Settings → Edge Functions → Secrets**:

| Secret | Example |
|--------|---------|
| `THREECX_BASE_URL` | `https://yourcompany.3cx.cloud` |
| `THREECX_CLIENT_ID` | From 3CX → Integrations → API |
| `THREECX_CLIENT_SECRET` | Same integration |

**Important:** For optional API history pull, the integration must use **Department: DEFAULT** and **Role: System Owner** (not System Administrator). After changing role, click **Generate API Key** and update Supabase secrets:

- `THREECX_CLIENT_ID` = your integration Client ID (e.g. `3cxapi`)
- `THREECX_CLIENT_SECRET` = the new API key
- `THREECX_BASE_URL` = `https://globelifepaz.3cx.ca` (your PBX URL, no trailing slash)

**Recordings do not need the API for normal use.** 3CX webhooks already deliver recording URLs; click **Refresh & sync recordings** on Call log to attach them after recruiters save dispositions.

---

## What you do NOT need from 3CX

| Item | Needed? |
|------|---------|
| PostgreSQL connection string | ❌ No |
| 3CX OAuth / API Client ID | ❌ No for webhook only · ✅ Yes for **Backfill today's recordings** |
| CRM contact lookup working | ❌ No |
| Call Control API | ❌ No |
| Premade Bitrix/Zoho/etc. template | ❌ No |

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Dropdown shows PostgreSQL fields | Select **PAZ Hiring Call Log** instead |
| TEST says contact not found | Expected — use Step 7 real call test |
| Call log row exists, no recording | Recording not enabled on extension, or call too short |
| Nothing in Supabase function logs | Wrong template selected, or ReportCall not enabled, or secret/anon key wrong |
| 401 in function logs | `THREECX_WEBHOOK_SECRET` ≠ 3CX Webhook secret |
| Recording link but won’t play in browser | Click “Open / download” — link may need 3CX login |

### Manual curl test (optional)

Replace `YOUR_ANON_KEY` and `your-secret`:

```bash
curl -X POST "https://hlfufjrjztuknioydlut.supabase.co/functions/v1/threecx-call-webhook" ^
  -H "Content-Type: application/json" ^
  -H "apikey: YOUR_ANON_KEY" ^
  -H "Authorization: Bearer YOUR_ANON_KEY" ^
  -H "X-Paz-Webhook-Secret: your-secret" ^
  -d "{\"phone_number\":\"4379868221\",\"agent_extension\":\"104\",\"recording_url\":\"https://example.com/test.wav\",\"call_id\":\"test-1\",\"duration_seconds\":30}"
```

Expected response: `{"ok":true,"matched":true,...}` if a matching disposition row exists.

---

## Why not use 3CX PostgreSQL template?

The built-in **Database PostgreSQL** template would connect 3CX directly to your database for **caller ID popup inside 3CX**. That would require:

- Exposing Supabase Postgres to your 3CX server IP
- SQL queries against `pipeline_candidates`
- Extra security and maintenance

We don’t need that — recruiters already work in the portal. Our XML only pushes **recording URLs after hangup**, which is simpler and safer.

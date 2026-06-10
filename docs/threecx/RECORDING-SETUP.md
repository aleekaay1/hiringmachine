# 3CX recordings → Call Log — API on-demand (no webhook flood)

**Recordings are NOT pushed for every 3CX call.** HR clicks **Load recording** on a disposition row; the portal queries **3CX XAPI** for that phone + recruiter extension + time only.

CRM template `paz-hiring-call-recording-crm.xml` (Version 4) is **ping-only** — it does not send pizza-delivery or other irrelevant calls to Supabase.

---

## Important: “Contact not found” on 3CX TEST is normal

When you click **TEST** in 3CX CRM settings, 3CX tries **contact lookup by phone number**.

Our template **does not include contact lookup** — only **ReportCall** (after hangup).

So you may see:

- ✅ Test connection / template loads fine  
- ❌ “Contact number not found” on TEST  

**That is OK.** Ignore the TEST for phone lookup.

The real test: make a real call, hang up, save disposition in the portal, then **Call log → Load recording** on that row.

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

1. Recruiter dials from 3CX web client, talks, hangs up
2. Save disposition in Call workspace
3. Open **Call log** → find the row → click **Load recording**

Recordings are fetched once per row and saved in the database.

---

## Hardcoded recruiter extensions

Edit `supabase/functions/_shared/recruiter3cxExtensions.ts` — one row per recruiter:

```ts
{ name: 'Hassaan Ali', email: 'hassaan@globelife-paz.com', extension: '104' },
```

Deploy `threecx-call-admin`, then click **Sync extensions** on Call log (or redeploy after editing the file).

---

## 3CX API secrets (required for Load recording)

Set in Supabase → **Project Settings → Edge Functions → Secrets**:

| Secret | Example |
|--------|---------|
| `THREECX_BASE_URL` | `https://globelifepaz.3cx.ca` (no trailing slash) |
| `THREECX_CLIENT_ID` | From 3CX → Integrations → API |
| `THREECX_CLIENT_SECRET` | API key from same integration |

**Required 3CX API setup** (Call History + recordings):

1. 3CX Admin → **Integrations → API → + Add**
2. **Department: DEFAULT**
3. **Role: System Owner** (System Administrator often returns **403** on CallHistoryView)
4. Save → **Generate API Key** → copy to `THREECX_CLIENT_SECRET`
5. Update all three Supabase secrets and redeploy is not needed (secrets are live)

**If you still get 403:** Admin → **Security** → check **Console Access / IP restrictions**. Requests from Supabase edge IPs blocked there can downgrade the token to “user” role and deny call history.

**Re-upload CRM template Version 4** (`paz-hiring-call-recording-crm.xml`) to stop ReportCall webhooks for every call.

---

## What you do NOT need from 3CX

| Item | Needed? |
|------|---------|
| PostgreSQL connection string | ❌ No |
| 3CX API (System Owner) | ✅ **Required** for Load recording |
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

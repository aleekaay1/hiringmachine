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

## Step 1 — Supabase: get two values

Open [Supabase Dashboard](https://supabase.com/dashboard/project/hlfufjrjztuknioydlut) → **Project Settings** → **API**

| Copy this | Where it lives | Used for |
|-----------|----------------|----------|
| **Project URL** | `https://hlfufjrjztuknioydlut.supabase.co` | Already in XML |
| **anon public key** | API → Project API keys → `anon` `public` | 3CX template field “Supabase anon key” |

You do **not** need the service role key in 3CX.

---

## Step 2 — Supabase: set webhook secret

1. Pick a long random password (example: `paz-3cx-rec-` + 20 random characters). Save it in your password manager.

2. In terminal (repo folder) or Supabase Dashboard → **Edge Functions** → **Secrets**:

```bash
npx supabase secrets set THREECX_WEBHOOK_SECRET=paste-your-secret-here --project-ref hlfufjrjztuknioydlut
```

| Secret name | Value | Who uses it |
|-------------|-------|-------------|
| `THREECX_WEBHOOK_SECRET` | Your random string | Supabase edge function + 3CX template (same string both places) |

**Edge function `threecx-call-webhook` is already deployed** on this project. No action needed unless you change the code.

---

## Step 3 — 3CX: upload OUR template (not PostgreSQL)

1. **3CX Management Console** → **Settings** → **CRM**
2. Open tab **Server side** (top of the CRM page — **not** Client side)
3. Click **+ Add Template** (right side, not the main CRM dropdown)
4. Upload: `docs/threecx/paz-hiring-call-recording-crm.xml`
5. **Important:** In the main dropdown **“Select a CRM Solution”**, choose **PAZ Hiring Call Log**  
   (If you pick **Database PostgreSQL**, you will see SQL fields instead — wrong template.)

### If you don’t see any form fields

The fields only appear **after** you select **PAZ Hiring Call Log** in the dropdown. They show **below** the dropdown, grouped as:

- **Settings** — Webhook URL, Supabase anon key, Webhook secret  
- **Call Reporting** — Enable call journaling checkbox  

If still blank:

1. Delete the old template → re-upload the XML (Version 2 in repo)
2. Confirm you are on **Server side** tab
3. Click **Save** after selecting the CRM from the dropdown
4. Try **Show Template** — you should see our `WebhookUrl` / `WebhookAnonKey` parameters in the XML

---

## Step 4 — 3CX: fill in template fields

| 3CX field (under **Settings**) | What to paste |
|-------------------------------|----------------|
| **Webhook URL** | `https://hlfufjrjztuknioydlut.supabase.co/functions/v1/threecx-call-webhook` |
| **Supabase anon key** | anon key from Step 1 (Supabase → Settings → API) |
| **Webhook secret** | Same value as `THREECX_WEBHOOK_SECRET` in Supabase (see Step 2) |
| **Enable call journaling…** (under **Call Reporting**) | ✅ Checked |

Click **Save**.

You do **not** need OAuth, Client ID, PostgreSQL username/password, or SQL statements.

---

## Step 5 — 3CX: turn on call recording

For **each recruiter extension** (e.g. Hassaan’s):

1. **Users** → click the user → **Options** (or edit extension)
2. Enable **Record Calls** (inbound and/or outbound as you require)
3. **Save**

Also check: **Recordings** in left menu → confirm recordings are enabled system-wide and retention is long enough.

**No recording = empty `[RecordingUrl]` = no link in Call log.**

---

## Step 6 — 3CX: note each recruiter’s extension number

For Hassaan (example):

1. **Users** → Hassaan → note **Extension** (e.g. `104`, `802`, etc.)
2. In the portal: **Account** → **Call settings** → enter the **same extension number**

The webhook matches calls using: **extension + dialed phone number + time**.

| Where | What to copy |
|-------|----------------|
| 3CX → Users → recruiter → Extension | e.g. `104` |
| Portal → Account → Call settings → Extension | Same number |

---

## Step 7 — Real test (ignore CRM phone TEST)

1. Hassaan dials a lead from the portal (web client tab — same as now)
2. Talk briefly, hang up
3. Save disposition in Call workspace
4. Wait ~30 seconds
5. Open **Insights → Call log** → find the row → **Recording** column

Optional: Supabase → **Edge Functions** → `threecx-call-webhook` → **Logs** — you should see POSTs after each completed call.

---

## What you do NOT need from 3CX

| Item | Needed? |
|------|---------|
| PostgreSQL connection string | ❌ No |
| 3CX OAuth / API Client ID | ❌ No (Call Control not used) |
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

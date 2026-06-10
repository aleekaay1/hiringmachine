# 3CX call recordings → PAZ Hiring Call Log

Recruiters keep dialing the **same way** (3CX web client opens in a new tab). This setup only adds **call journaling** so completed calls send metadata + a recording link into `/call-log`.

No Call Control API changes are required.

---

## Part A — One-time in Supabase

1. **Recording columns** (if not already applied): run `supabase/sql/paste_pipeline_call_recordings.sql` in the Supabase SQL editor.

2. **Deploy the webhook** (from repo root):

   ```bash
   npx supabase functions deploy threecx-call-webhook --no-verify-jwt --project-ref hlfufjrjztuknioydlut
   ```

3. **Set the webhook secret** (pick a long random string; reuse it in 3CX below):

   ```bash
   npx supabase secrets set THREECX_WEBHOOK_SECRET=your-long-random-secret-here
   ```

4. Note your **Supabase anon key** (Project Settings → API → `anon` `public`). The 3CX template needs it as `apikey`.

---

## Part B — Upload CRM template in 3CX

1. Open **3CX Management Console** → **Settings** → **CRM Integration**.
2. Tab **Server side** → **+ Add**.
3. Upload:

   `docs/threecx/paz-hiring-call-recording-crm.xml`

4. Fill in the template parameters:

   | Field | Value |
   |-------|--------|
   | Webhook URL | `https://hlfufjrjztuknioydlut.supabase.co/functions/v1/threecx-call-webhook` (pre-filled) |
   | Supabase anon key | Your project anon key |
   | Webhook secret | Same string as `THREECX_WEBHOOK_SECRET` |
   | Send completed calls… | **Enabled** |

5. **Save** the integration.

---

## Part C — Enable call recording on extensions

Recording URLs are empty unless the call was actually recorded.

For **each recruiter extension** (or the outbound route they use):

1. **Users** → select the extension → **Options**.
2. Enable **Record calls** (inbound and/or outbound as required).
3. Confirm your 3CX **recording policy** retains files long enough for review (retention is set under recording/storage settings).

Optional: under **Advanced → Recordings**, confirm where files are stored and that HTTPS download links are generated for completed calls.

---

## Part D — Map extensions in PAZ Hiring

So the webhook can match a 3CX call to the right disposition row:

1. Each recruiter opens **Account** → **Call settings** (or admin sets it).
2. Enter their **3CX extension** (same value 3CX sends as `[Agent]`, e.g. `104`).

Matching uses extension + dialed number + time window (~45 minutes).

---

## Part E — Test

1. Place a short **outbound** test call from a recruiter extension to a known lead number.
2. Save disposition in **Call workspace** as usual.
3. Wait for the call to end (3CX fires **ReportCall** when the call completes).
4. Open **Insights → Call log** — the row should show an inline **Recording** player when `[RecordingUrl]` was present.

### If recording column stays `—`

| Check | Action |
|-------|--------|
| Call not recorded | Enable recording on extension / route |
| Webhook not firing | 3CX → Dashboard → Activity Logs → enable verbose; inspect `3cxSystemService.log` after a test call |
| Secret mismatch | `THREECX_WEBHOOK_SECRET` must equal 3CX **Webhook secret** |
| Wrong extension | Recruiter extension in Account must match 3CX `[Agent]` |
| No disposition row | Save disposition in app before or shortly after the call |
| Empty `[RecordingUrl]` | Recording may still be processing; retry after a few seconds or check 3CX recording storage |

### Manual webhook test (optional)

```bash
curl -X POST "https://hlfufjrjztuknioydlut.supabase.co/functions/v1/threecx-call-webhook" \
  -H "Content-Type: application/json" \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "X-Paz-Webhook-Secret: your-secret" \
  -d "{\"phone_number\":\"5551234567\",\"agent_extension\":\"104\",\"recording_url\":\"https://example.com/test.wav\",\"call_id\":\"test-1\",\"duration_seconds\":12}"
```

---

## What the template sends

On every completed call, 3CX POSTs JSON including:

- `phone_number`, `agent_extension`, `agent_email`
- `call_type`, `call_direction`, `duration`, `duration_seconds`
- `call_start_utc`, `call_end_utc`
- **`recording_url`** — direct link from 3CX (`[RecordingUrl]`)
- `call_id` — composite id for dedupe

The webhook updates the nearest matching `pipeline_call_records` row.

---

## Browser playback

If the recording link requires 3CX login, in-browser `<audio>` may fail. In that case use **Open / download** on the call log row, or ask IT whether recording URLs can be issued as signed public HTTPS links. A proxy edge function can be added later if needed.

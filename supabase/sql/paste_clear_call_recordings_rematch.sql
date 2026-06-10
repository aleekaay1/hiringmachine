-- One-time: strip ALL call recording attachments and reset 3CX webhook match flags.
-- Run in Supabase SQL editor, then use Call log → Refresh & sync (full rematch).

-- 1) Remove recording_url column data and strip cached recording fields from metadata
update public.pipeline_call_records
set
  recording_url = null,
  duration_seconds = null,
  threecx_call_id = null,
  threecx_metadata = (
    coalesce(threecx_metadata, '{}'::jsonb)
    - 'recording_url'
    - 'duration_seconds'
    - 'threecx_call_id'
    - 'match_phone'
    - 'match_anchor'
    - 'match_extension'
    - 'match_recruiter_ids'
    - 'threecx_report'
  )
where
  recording_url is not null
  or coalesce(threecx_metadata->>'recording_url', '') <> '';

-- 2) Reset webhook rows so sync replays strict phone + extension + time matching
update public.threecx_webhook_events
set
  matched = false,
  recording_attached = false,
  call_record_id = null,
  detail = 'pending_rematch'
where event_type = 'report_call';

-- Verify (optional)
-- select count(*) as rows_with_recording from pipeline_call_records where recording_url is not null;
-- select count(*) as webhooks_pending from threecx_webhook_events where event_type = 'report_call' and matched = false;

-- Call log recording fields + 3CX webhook storage (run in Supabase SQL editor)
-- Matches pipeline_call_records rows when 3CX CRM ReportCall webhook fires.

alter table public.pipeline_call_records
  add column if not exists recording_url text,
  add column if not exists threecx_call_id text,
  add column if not exists duration_seconds integer;

create index if not exists pipeline_call_records_threecx_call_id_idx
  on public.pipeline_call_records (threecx_call_id)
  where threecx_call_id is not null;

comment on column public.pipeline_call_records.recording_url is
  'HTTPS URL to call recording (from 3CX CRM ReportCall [RecordingUrl] or xAPI).';
comment on column public.pipeline_call_records.threecx_call_id is
  '3CX call history id for dedupe and recording lookup.';
comment on column public.pipeline_call_records.duration_seconds is
  'Talk time in seconds from 3CX when available.';

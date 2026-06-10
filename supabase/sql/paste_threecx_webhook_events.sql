create table if not exists public.threecx_webhook_events (
  id uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  event_type text not null,
  matched boolean,
  recording_attached boolean,
  agent_extension text,
  phone_number text,
  call_record_id uuid,
  detail text,
  payload jsonb
);

create index if not exists threecx_webhook_events_received_at_idx
  on public.threecx_webhook_events (received_at desc);

alter table public.threecx_webhook_events enable row level security;

drop policy if exists threecx_webhook_events_call_log_read on public.threecx_webhook_events;
create policy threecx_webhook_events_call_log_read
on public.threecx_webhook_events
for select
to authenticated
using (public.pipeline_can_read_all_call_telemetry());

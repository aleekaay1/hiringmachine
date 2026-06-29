-- Audit log for inbound WebinarGeek questionnaire webhooks.

create table if not exists public.webinar_geek_webhook_events (
  id uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  event_type text not null,
  ok boolean,
  detail text,
  wg_submission_key text,
  payload jsonb
);

create index if not exists webinar_geek_webhook_events_received_idx
  on public.webinar_geek_webhook_events (received_at desc);

comment on table public.webinar_geek_webhook_events is
  'Inbound WebinarGeek webhook payloads for questionnaire / evaluation form events.';

alter table public.webinar_geek_webhook_events enable row level security;

drop policy if exists webinar_geek_webhook_events_select on public.webinar_geek_webhook_events;
create policy webinar_geek_webhook_events_select
on public.webinar_geek_webhook_events
for select
to authenticated
using (
  exists (
    select 1 from public.user_profiles up
    where up.user_id = auth.uid()
      and up.role in ('admin', 'leadership')
  )
);

drop policy if exists webinar_geek_webhook_events_service_write on public.webinar_geek_webhook_events;
create policy webinar_geek_webhook_events_service_write
on public.webinar_geek_webhook_events
for all
to service_role
using (true)
with check (true);

-- Which 3CX extensions are actually sending ReportCall webhooks?
select
  coalesce(nullif(trim(agent_extension), ''), '(blank)') as agent_extension,
  count(*) as webhook_count,
  count(*) filter (where recording_attached = true) as recordings_attached,
  max(received_at) as last_received
from public.threecx_webhook_events
where event_type = 'report_call'
group by 1
order by webhook_count desc;

-- Expected portal extensions (from recruiter3cxExtensions.ts)
-- 5522 Nicolas, 5835 Nita, 5943 Hassaan, 5933 Gamar, etc.
-- If an extension is missing here, 3CX is not reporting calls for that recruiter.

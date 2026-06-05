-- Pipeline email workspace logs pipeline_candidates.id in email_send_logs.candidate_id.
-- The original FK to public.candidates caused silent insert failures (send succeeds, no outbox row).

alter table public.email_send_logs
  drop constraint if exists email_send_logs_candidate_id_fkey;

comment on column public.email_send_logs.candidate_id is
  'Optional link: CRM candidates.id (text) or pipeline_candidates.id (uuid as text). No FK — both tables use this audit column.';

create index if not exists email_send_logs_to_email_idx
  on public.email_send_logs (lower(trim(to_email)));

-- Backfill outbox rows that were stored without candidate_id (failed FK) using recipient email.
update public.email_send_logs esl
set candidate_id = pc.id::text
from public.pipeline_candidates pc
where esl.candidate_id is null
  and pc.email is not null
  and lower(trim(esl.to_email)) = lower(trim(pc.email));

-- Map inbox rows that synced before candidate email was known.
update public.email_inbox_logs eil
set candidate_id = pc.id,
    updated_at = now()
from public.pipeline_candidates pc
where eil.candidate_id is null
  and pc.email is not null
  and lower(trim(eil.from_email)) = lower(trim(pc.email));

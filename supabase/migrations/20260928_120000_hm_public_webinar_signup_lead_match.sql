-- Match public form signups to bulk-email campaign leads (cold email vs elsewhere).

alter table public.hm_public_webinar_signups
  add column if not exists lead_source text,
  add column if not exists matched_campaign_id uuid,
  add column if not exists matched_campaign_name text,
  add column if not exists matched_recipient_id uuid,
  add column if not exists matched_recipient_status text,
  add column if not exists matched_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'hm_public_webinar_signups_lead_source_chk'
  ) then
    alter table public.hm_public_webinar_signups
      add constraint hm_public_webinar_signups_lead_source_chk
      check (lead_source is null or lead_source in ('cold_email', 'elsewhere'));
  end if;
end $$;

create index if not exists hm_public_webinar_signups_lead_source_idx
  on public.hm_public_webinar_signups (lead_source);

comment on column public.hm_public_webinar_signups.lead_source is
  'cold_email = matched a bulk campaign/draft lead; elsewhere = not found in email marketing lists.';
comment on column public.hm_public_webinar_signups.matched_campaign_id is
  'Campaign whose recipient list matched this signup email.';

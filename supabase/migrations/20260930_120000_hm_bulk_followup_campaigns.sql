-- Follow-up campaigns: second send to people who got the first email but never registered.

alter table public.hm_bulk_campaigns
  add column if not exists parent_campaign_id uuid references public.hm_bulk_campaigns(id) on delete set null,
  add column if not exists kind text not null default 'initial';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'hm_bulk_campaigns_kind_chk'
  ) then
    alter table public.hm_bulk_campaigns
      add constraint hm_bulk_campaigns_kind_chk
      check (kind in ('initial', 'followup'));
  end if;
end $$;

create index if not exists hm_bulk_campaigns_parent_idx
  on public.hm_bulk_campaigns (parent_campaign_id);

comment on column public.hm_bulk_campaigns.parent_campaign_id is
  'First campaign this follow-up was built from.';
comment on column public.hm_bulk_campaigns.kind is
  'initial = first outreach; followup = second email to non-registrants.';

alter table public.hm_public_webinar_signups
  add column if not exists reference text;

comment on column public.hm_public_webinar_signups.reference is
  'Optional source/referrer entered on /schedule-webinar.';

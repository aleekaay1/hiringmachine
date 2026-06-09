-- Optional contact fields for staff profile page.

alter table public.user_profiles
  add column if not exists phone text,
  add column if not exists extension text;

comment on column public.user_profiles.phone is
  'Staff contact phone number (optional, self-edited on account page).';

comment on column public.user_profiles.extension is
  'Phone extension or direct line suffix (optional).';

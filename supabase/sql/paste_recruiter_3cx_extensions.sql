-- Map 3CX extensions → portal user_profiles (only users that exist in Supabase).
-- Safe to re-run.

with mapped(name, email, extension) as (
  values
    ('Ali Shah', 'ali@globelife-paz.com', '9991'),
    ('Alex Paz', 'alex@globelife-paz.com', '5201'),
    ('Reg Bentajado', 'reginald_bentajado@globelife-paz.com', '5208'),
    ('HR & Licensing', 'hr.licensing@globelife-paz.com', '5846'),
    ('Akram Mirahmadi', 'akram@globelife-paz.com', '5303'),
    ('Walid Elshahed', 'walid@globelife-paz.com', '5789'),
    ('Nicolas Demers', 'nicolas_demers@globelife-paz.com', '5522'),
    ('Nita Nath', 'nita_nath@globelife-paz.com', '5835'),
    ('Nita Nath', 'nita@globelife-paz.com', '5835'),
    ('Raman Kumar', 'raman@globelife-paz.com', '5908'),
    ('Devanshi Bodiwala', 'devanshi@globelife-paz.com', '5912'),
    ('Emilio Reyes', 'emilio@globelife-paz.com', '5925'),
    ('Gamar Baghirli', 'gamar_baghirli@globelife-paz.com', '5933'),
    ('Hassaan Khalid', 'hasaan_khalid@globelife-paz.com', '5943'),
    ('Jonalyn Manuel', 'jonalyn_manuel@globelife-paz.com', '5942')
),
hits as (
  select up.user_id, m.extension
  from mapped m
  join public.user_profiles up on lower(up.email) = lower(m.email)
)
update public.user_profiles up
set extension = h.extension, updated_at = now()
from hits h
where up.user_id = h.user_id;

insert into public.pipeline_user_call_settings (user_id, extension, dialing_locale, updated_at)
select h.user_id, h.extension, 'ca', now()
from (
  select up.user_id, m.extension
  from (
    values
      ('ali@globelife-paz.com', '9991'),
      ('alex@globelife-paz.com', '5201'),
      ('reginald_bentajado@globelife-paz.com', '5208'),
      ('hr.licensing@globelife-paz.com', '5846'),
      ('akram@globelife-paz.com', '5303'),
      ('walid@globelife-paz.com', '5789'),
      ('nicolas_demers@globelife-paz.com', '5522'),
      ('nita_nath@globelife-paz.com', '5835'),
      ('nita@globelife-paz.com', '5835'),
      ('raman@globelife-paz.com', '5908'),
      ('devanshi@globelife-paz.com', '5912'),
      ('emilio@globelife-paz.com', '5925'),
      ('gamar_baghirli@globelife-paz.com', '5933'),
      ('hasaan_khalid@globelife-paz.com', '5943'),
      ('jonalyn_manuel@globelife-paz.com', '5942')
  ) as m(email, extension)
  join public.user_profiles up on lower(up.email) = lower(m.email)
) h
on conflict (user_id) do update
set extension = excluded.extension, updated_at = now();

select up.email, up.full_name, up.extension
from public.user_profiles up
where up.extension is not null
order by up.email;

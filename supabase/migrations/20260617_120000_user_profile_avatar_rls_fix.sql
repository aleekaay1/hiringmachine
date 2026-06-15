-- Fix profile photo upload: storage owner policies + self-update on user_profiles.

alter table public.user_profiles
  add column if not exists avatar_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-avatars',
  'profile-avatars',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Authenticated users can update their own profile row (avatar, name, contact fields).
drop policy if exists "users can update their profile basics" on public.user_profiles;
drop policy if exists user_profiles_self_update on public.user_profiles;
create policy user_profiles_self_update
on public.user_profiles
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists profile_avatars_public_read on storage.objects;
create policy profile_avatars_public_read
on storage.objects
for select
to public
using (bucket_id = 'profile-avatars');

drop policy if exists profile_avatars_owner_upload on storage.objects;
create policy profile_avatars_owner_upload
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'profile-avatars'
  and name like auth.uid()::text || '/%'
);

drop policy if exists profile_avatars_owner_update on storage.objects;
create policy profile_avatars_owner_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'profile-avatars'
  and name like auth.uid()::text || '/%'
)
with check (
  bucket_id = 'profile-avatars'
  and name like auth.uid()::text || '/%'
);

drop policy if exists profile_avatars_owner_delete on storage.objects;
create policy profile_avatars_owner_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'profile-avatars'
  and name like auth.uid()::text || '/%'
);

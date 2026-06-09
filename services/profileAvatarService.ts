import { notifyProfileUpdated } from './profileService';
import { resolveStaffSession } from './staffSessionCache';
import { supabase } from './supabaseClient';

const AVATAR_BUCKET = 'profile-avatars';

export async function uploadProfileAvatar(file: File): Promise<string> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error('Sign in required.');

  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const path = `${userId}/avatar-${Date.now()}.${ext}`;

  const { error: upErr } = await supabase.storage.from(AVATAR_BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: true,
    contentType: file.type || 'image/jpeg',
  });
  if (upErr) throw upErr;

  const { data: pub } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
  const avatarUrl = pub.publicUrl;

  const { error: profileErr } = await supabase
    .from('user_profiles')
    .update({ avatar_url: avatarUrl })
    .eq('user_id', userId);
  if (profileErr) throw profileErr;

  await supabase.auth.refreshSession();
  await resolveStaffSession(true);
  notifyProfileUpdated();
  return avatarUrl;
}

export async function removeProfileAvatar(): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error('Sign in required.');

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('avatar_url')
    .eq('user_id', userId)
    .maybeSingle();

  const url = String(profile?.avatar_url || '');
  if (url.includes(`/${AVATAR_BUCKET}/`)) {
    const marker = `/storage/v1/object/public/${AVATAR_BUCKET}/`;
    const idx = url.indexOf(marker);
    if (idx >= 0) {
      const storagePath = decodeURIComponent(url.slice(idx + marker.length));
      if (storagePath) {
        await supabase.storage.from(AVATAR_BUCKET).remove([storagePath]);
      }
    }
  }

  const { error } = await supabase
    .from('user_profiles')
    .update({ avatar_url: null })
    .eq('user_id', userId);
  if (error) throw error;

  await supabase.auth.refreshSession();
  await resolveStaffSession(true);
  notifyProfileUpdated();
}

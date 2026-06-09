import { supabase } from './supabaseClient';

export type ProfileDetailsUpdate = {
  full_name?: string | null;
  phone?: string | null;
  extension?: string | null;
};

export function notifyProfileUpdated(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('pohiring:profile-updated'));
  }
}

export async function updateUserProfileDetails(update: ProfileDetailsUpdate): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error('Sign in required.');

  const payload: Record<string, string | null> = {};
  if (update.full_name !== undefined) payload.full_name = update.full_name?.trim() || null;
  if (update.phone !== undefined) payload.phone = update.phone?.trim() || null;
  if (update.extension !== undefined) payload.extension = update.extension?.trim() || null;

  if (Object.keys(payload).length === 0) return;

  const { error } = await supabase.from('user_profiles').update(payload).eq('user_id', userId);
  if (error) throw error;

  await supabase.auth.refreshSession();
  notifyProfileUpdated();
}

import { supabase } from './supabaseClient';

export type AppRole = 'admin' | 'recruiter' | 'webinar' | 'hr' | 'viewer';

export interface UserProfile {
  user_id: string;
  full_name: string | null;
  role: AppRole;
}

export async function getCurrentUserProfile(): Promise<UserProfile | null> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return null;
  const { data, error } = await supabase
    .from('user_profiles')
    .select('user_id, full_name, role')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return data as UserProfile;
}

export function canAccessSection(role: AppRole | null, section: 'overview' | 'candidates' | 'qr' | 'live-sessions' | 'webinar-geek' | 'analytics' | 'settings' | 'hr-dashboard'): boolean {
  if (!role || role === 'admin') return true;
  if (role === 'recruiter') return section === 'overview' || section === 'candidates' || section === 'live-sessions';
  if (role === 'webinar') return section === 'overview' || section === 'webinar-geek' || section === 'analytics';
  if (role === 'hr') return section === 'overview' || section === 'candidates' || section === 'hr-dashboard' || section === 'live-sessions';
  return section === 'overview';
}

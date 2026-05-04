import type { User } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';

export type AppRole = 'admin' | 'recruiter' | 'webinar' | 'hr' | 'viewer';

export interface UserProfile {
  user_id: string;
  full_name: string | null;
  role: AppRole;
}

/** When `public.user_profiles` is not in PostgREST (404 / PGRST205), avoid hammering a missing table every layout mount. */
let userProfilesTableMissing: boolean | null = null;

function isMissingUserProfilesRelation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === 'PGRST205') return true;
  const m = error.message || '';
  return (
    /Could not find the table\s+['"]?public\.user_profiles['"]?\s+in the schema cache/i.test(m) ||
    (/relation\s+["']?public\.user_profiles["']?\s+does not exist/i.test(m))
  );
}

function coerceAppRole(value: unknown): AppRole | null {
  if (value === 'admin' || value === 'recruiter' || value === 'webinar' || value === 'hr' || value === 'viewer') {
    return value;
  }
  return null;
}

/** Used when `user_profiles` is not deployed; prefers JWT metadata if you set `user_metadata.role` / `app_metadata.role`. */
function staffProfileFromAuthUser(user: User): UserProfile {
  const meta = (user.user_metadata || {}) as Record<string, unknown>;
  const app = (user.app_metadata || {}) as Record<string, unknown>;
  const fromJwt = coerceAppRole(meta.role) ?? coerceAppRole(app.role);
  const fullName =
    (typeof meta.full_name === 'string' && meta.full_name.trim()) ||
    (typeof meta.name === 'string' && meta.name.trim()) ||
    user.email ||
    null;
  return {
    user_id: user.id,
    full_name: fullName,
    role: fromJwt ?? 'admin',
  };
}

export async function getCurrentUserProfile(): Promise<UserProfile | null> {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  const userId = user?.id;
  if (!userId || !user) return null;

  if (userProfilesTableMissing === true) {
    return staffProfileFromAuthUser(user);
  }

  const { data, error } = await supabase
    .from('user_profiles')
    .select('user_id, full_name, role')
    .eq('user_id', userId)
    .maybeSingle();

  if (!error && data) {
    userProfilesTableMissing = false;
    return data as UserProfile;
  }

  if (error?.code === 'PGRST116') {
    return null;
  }

  if (error && isMissingUserProfilesRelation(error)) {
    userProfilesTableMissing = true;
    return staffProfileFromAuthUser(user);
  }

  return null;
}

export function canAccessSection(role: AppRole | null, section: 'overview' | 'candidates' | 'qr' | 'live-sessions' | 'webinar-geek' | 'analytics' | 'settings' | 'hr-dashboard' | 'email-log'): boolean {
  if (!role || role === 'admin') return true;
  if (role === 'recruiter') return section === 'overview' || section === 'candidates' || section === 'live-sessions' || section === 'email-log';
  if (role === 'webinar') return section === 'overview' || section === 'webinar-geek' || section === 'analytics';
  if (role === 'hr') return section === 'overview' || section === 'candidates' || section === 'hr-dashboard' || section === 'live-sessions' || section === 'email-log';
  return section === 'overview';
}

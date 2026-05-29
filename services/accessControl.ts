import type { User } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';

export type AppRole = 'admin' | 'leadership' | 'recruiter' | 'webinar' | 'hr' | 'viewer';
export type AppSection =
  | 'overview'
  | 'candidates'
  | 'qr'
  | 'live-sessions'
  | 'webinar-geek'
  | 'calls-analytics'
  | 'analytics'
  | 'settings'
  | 'pipeline'
  | 'pipeline-settings'
  | 'hr-dashboard'
  | 'email-log'
  | 'superdashboard';

export interface UserProfile {
  user_id: string;
  email?: string | null;
  full_name: string | null;
  role: AppRole;
  points?: number | null;
  points_updated_at?: string | null;
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
  if (
    value === 'admin' ||
    value === 'leadership' ||
    value === 'recruiter' ||
    value === 'webinar' ||
    value === 'hr' ||
    value === 'viewer'
  ) {
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
    email: user.email ?? null,
    full_name: fullName,
    role: fromJwt ?? 'viewer',
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
    .select('user_id, email, full_name, role, points, points_updated_at')
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

export function canAccessSection(role: AppRole | null, section: AppSection): boolean {
  if (!role) return section === 'overview';
  if (role === 'admin' || role === 'leadership') return true;
  if (role === 'recruiter') {
    return (
      section === 'overview' ||
      section === 'settings' ||
      section === 'pipeline' ||
      section === 'pipeline-settings' ||
      section === 'calls-analytics' ||
      section === 'webinar-geek'
    );
  }
  if (role === 'webinar') return section === 'overview' || section === 'webinar-geek' || section === 'calls-analytics';
  if (role === 'hr') {
    return (
      section === 'overview' ||
      section === 'candidates' ||
      section === 'hr-dashboard' ||
      section === 'live-sessions' ||
      section === 'email-log'
    );
  }
  return section === 'overview';
}

export function defaultRouteForRole(role: AppRole | null): string {
  if (role === 'recruiter') return '/pipeline';
  if (role === 'webinar') return '/webinar-geek';
  if (role === 'hr') return '/hr-dashboard';
  return '/dashboard?view=overview';
}

export async function listAllUserProfiles(): Promise<UserProfile[]> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('user_id, email, full_name, role, points, points_updated_at')
    .order('full_name', { ascending: true, nullsFirst: false })
    .order('email', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data || []) as UserProfile[];
}

function normalizeIdentityToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function buildRecruiterScopeTokens(email: string | null | undefined, fullName: string | null | undefined): Set<string> {
  const tokens = new Set<string>();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const localPart = normalizedEmail.split('@')[0] || '';
  const name = String(fullName || '').trim().toLowerCase();

  const add = (raw: string) => {
    const token = normalizeIdentityToken(raw);
    if (token) tokens.add(token);
  };

  add(normalizedEmail);
  add(localPart);
  add(localPart.replace(/[._-]+/g, ' '));
  add(localPart.replace(/[._-]+/g, ''));
  add(name);
  add(name.replace(/\s+/g, ''));

  return tokens;
}

export function recruiterOwnsNameKey(nameKey: string | null, tokens: Set<string>): boolean {
  if (!nameKey || tokens.size === 0) return false;
  const normalized = normalizeIdentityToken(nameKey);
  return tokens.has(normalized);
}

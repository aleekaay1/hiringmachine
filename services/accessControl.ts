import type { User } from '@supabase/supabase-js';
import { fetchDashboardTeamMetricsViaFunction } from './dashboardTeamMetricsService';
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
  | 'pipeline-call'
  | 'pipeline-performance'
  | 'pipeline-email'
  | 'pipeline-webinar-verify'
  | 'pipeline-uploads'
  | 'pipeline-settings'
  | 'leaderboard'
  | 'home'
  | 'hr-dashboard'
  | 'email-log'
  | 'reports'
  | 'support'
  | 'ops-console'
  | 'superdashboard'
  | 'pipeline-hr-leads';

export interface UserProfile {
  user_id: string;
  email?: string | null;
  full_name: string | null;
  role: AppRole;
  points?: number | null;
  points_updated_at?: string | null;
}

/** Training / sandbox accounts (demo-*@globelife-paz.com) — hidden from leaderboard, reports, and staff lists. */
export function isDemoStaffEmail(email: string | null | undefined): boolean {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized.endsWith('@globelife-paz.com')) return false;
  const local = normalized.split('@')[0] || '';
  return local.startsWith('demo-') || local.startsWith('demo_');
}

export function isDemoStaffProfile(profile: Pick<UserProfile, 'email' | 'full_name'>): boolean {
  if (isDemoStaffEmail(profile.email)) return true;
  const name = String(profile.full_name || '').trim().toLowerCase();
  return name === 'demo leadership' || name === 'demo admin' || name.startsWith('demo ');
}

export function filterProductionStaffProfiles<T extends Pick<UserProfile, 'email' | 'full_name'>>(profiles: T[]): T[] {
  return profiles.filter((p) => !isDemoStaffProfile(p));
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

const ADMIN_DATA_SECTIONS: AppSection[] = [
  'home',
  'overview',
  'candidates',
  'qr',
  'live-sessions',
  'webinar-geek',
  'calls-analytics',
  'leaderboard',
  'analytics',
  'settings',
  'email-log',
  'reports',
  'hr-dashboard',
  'pipeline-performance',
  'pipeline-settings',
];

/** Recruiter-style pipeline: own uploads + dialer. Leadership included; most admins excluded. */
const PIPELINE_OPERATIONAL_SECTIONS: AppSection[] = [
  'pipeline',
  'pipeline-call',
  'pipeline-uploads',
  'pipeline-email',
  'pipeline-webinar-verify',
  'pipeline-performance',
  'pipeline-settings',
];

/** Hidden ops console — ali@globelife-paz.com only (auth email, not role-based). */
export const OPS_CONSOLE_EMAIL = 'ali@globelife-paz.com';

/** HR weekly CSV import + lead assignment to recruiters. */
export const HR_LEAD_DISTRIBUTION_EMAILS = new Set([
  OPS_CONSOLE_EMAIL,
  'hr.licensing@globelife-paz.com',
]);

export function isHrLeadDistributorEmail(email: string | null | undefined): boolean {
  const normalized = String(email || '').trim().toLowerCase();
  return normalized.length > 0 && HR_LEAD_DISTRIBUTION_EMAILS.has(normalized);
}

export function canAccessHrLeadDistribution(
  role: AppRole | null,
  email: string | null | undefined,
): boolean {
  if (isHrLeadDistributorEmail(email)) return true;
  return role === 'hr';
}

export function isOpsConsoleEmail(email: string | null | undefined): boolean {
  const normalized = String(email || '').trim().toLowerCase();
  return normalized === OPS_CONSOLE_EMAIL;
}

export async function resolveOpsConsoleAccessEmail(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.email ?? null;
}

export async function canAccessOpsConsole(): Promise<boolean> {
  const email = await resolveOpsConsoleAccessEmail();
  return isOpsConsoleEmail(email);
}

/** Admins who also need call + email workspace (same nav as leadership recruiters). */
const ADMIN_PIPELINE_OPERATIONAL_EMAILS = new Set(['hr.licensing@globelife-paz.com']);

export function adminHasPipelineOperationalAccess(
  role: AppRole | null,
  email: string | null | undefined,
): boolean {
  if (role !== 'admin') return false;
  const normalized = String(email || '').trim().toLowerCase();
  return normalized.length > 0 && ADMIN_PIPELINE_OPERATIONAL_EMAILS.has(normalized);
}

export function canAccessSection(
  role: AppRole | null,
  section: AppSection,
  email?: string | null,
): boolean {
  if (section === 'ops-console') return isOpsConsoleEmail(email);
  if (section === 'pipeline-hr-leads') return canAccessHrLeadDistribution(role, email);
  if (section === 'support') return Boolean(role);
  if (!role) return section === 'overview' || section === 'home';
  if (role === 'admin') {
    if (ADMIN_DATA_SECTIONS.includes(section)) return true;
    if (canAccessHrLeadDistribution(role, email) && section === 'pipeline-hr-leads') return true;
    if (adminHasPipelineOperationalAccess(role, email) && PIPELINE_OPERATIONAL_SECTIONS.includes(section)) {
      return true;
    }
    return false;
  }
  if (role === 'leadership') {
    return (
      ADMIN_DATA_SECTIONS.includes(section) ||
      PIPELINE_OPERATIONAL_SECTIONS.includes(section) ||
      (canAccessHrLeadDistribution(role, email) && section === 'pipeline-hr-leads') ||
      section === 'support'
    );
  }
  if (role === 'recruiter') {
    return (
      section === 'home' ||
      section === 'overview' ||
      section === 'settings' ||
      section === 'support' ||
      PIPELINE_OPERATIONAL_SECTIONS.includes(section) ||
      section === 'calls-analytics' ||
      section === 'webinar-geek' ||
      section === 'leaderboard'
    );
  }
  if (role === 'webinar') {
    return section === 'home' || section === 'overview' || section === 'webinar-geek' || section === 'pipeline-webinar-verify' || section === 'calls-analytics' || section === 'leaderboard' || section === 'support';
  }
  if (role === 'hr') {
    return (
      section === 'home' ||
      section === 'overview' ||
      section === 'support' ||
      section === 'candidates' ||
      section === 'hr-dashboard' ||
      section === 'pipeline-hr-leads' ||
      section === 'live-sessions' ||
      section === 'email-log' ||
      section === 'leaderboard'
    );
  }
  return section === 'overview' || section === 'leaderboard' || section === 'home' || section === 'support';
}

/** Post-login landing: role-based workspace at /home (not legacy CRM overview). */
export function defaultRouteForRole(_role: AppRole | null): string {
  return '/home';
}

export async function listAllUserProfiles(): Promise<UserProfile[]> {
  const full = await supabase
    .from('user_profiles')
    .select('user_id, email, full_name, role, points, points_updated_at')
    .order('full_name', { ascending: true })
    .order('email', { ascending: true });
  if (!full.error) return filterProductionStaffProfiles((full.data || []) as UserProfile[]);

  const withoutPoints = await supabase
    .from('user_profiles')
    .select('user_id, email, full_name, role')
    .order('email', { ascending: true });
  if (!withoutPoints.error) return filterProductionStaffProfiles((withoutPoints.data || []) as UserProfile[]);

  const viaFn = await fetchDashboardTeamMetricsViaFunction('last7');
  if (viaFn.ok && viaFn.profiles.length > 0) return filterProductionStaffProfiles(viaFn.profiles);

  throw new Error(full.error.message || withoutPoints.error?.message || 'Could not load user profiles');
}

function normalizeIdentityToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function splitIdentityWords(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2);
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
  for (const word of splitIdentityWords(localPart)) add(word);
  for (const word of splitIdentityWords(name)) add(word);

  return tokens;
}

export function recruiterOwnsNameKey(nameKey: string | null, tokens: Set<string>): boolean {
  if (!nameKey || tokens.size === 0) return false;
  const normalized = normalizeIdentityToken(nameKey);
  if (!normalized) return false;
  if (tokens.has(normalized)) return true;

  const words = splitIdentityWords(nameKey);
  if (words.length > 0) {
    const matchedWords = words.reduce((count, word) => (tokens.has(word) ? count + 1 : count), 0);
    if (matchedWords >= 2) return true;
    if (matchedWords >= 1 && words.length === 1 && words[0].length >= 5) return true;
  }

  for (const token of tokens) {
    if (token.length < 6) continue;
    if (normalized.includes(token) || token.includes(normalized)) return true;
  }
  return false;
}

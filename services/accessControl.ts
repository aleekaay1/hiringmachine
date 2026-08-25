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
  | 'webinar-questionnaires'
  | 'calls-analytics'
  | 'analytics'
  | 'settings'
  | 'pipeline'
  | 'pipeline-call'
  | 'pipeline-performance'
  | 'pipeline-email'
  | 'pipeline-webinar-verify'
  | 'pipeline-uploads'
  | 'pipeline-lead-manager'
  | 'pipeline-settings'
  | 'leaderboard'
  | 'home'
  | 'hr-dashboard'
  | 'email-log'
  | 'call-log'
  | 'reports'
  | 'support'
  | 'performance-check-in'
  | 'performance-check-ins'
  | 'ops-console'
  | 'superdashboard'
  | 'pipeline-hr-leads'
  | 'account'
  | 'staff-directory'
  | 'sent-ahead'
  | 'check-ins'
  | 'replies';

export interface UserProfile {
  user_id: string;
  email?: string | null;
  full_name: string | null;
  role: AppRole;
  points?: number | null;
  points_updated_at?: string | null;
  avatar_url?: string | null;
  phone?: string | null;
  extension?: string | null;
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

const PROFILE_CACHE_TTL_MS = 60_000;
const ALL_PROFILES_CACHE_TTL_MS = 120_000;

let cachedCurrentProfile: { userId: string; profile: UserProfile; at: number } | null = null;
let currentProfileInflight: Promise<UserProfile | null> | null = null;
let cachedAllProfiles: { data: UserProfile[]; at: number } | null = null;
let allProfilesInflight: Promise<UserProfile[]> | null = null;

export function invalidateStaffDataCaches(): void {
  cachedCurrentProfile = null;
  currentProfileInflight = null;
  cachedAllProfiles = null;
  allProfilesInflight = null;
}

async function fetchCurrentUserProfileUncached(): Promise<UserProfile | null> {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  const userId = user?.id;
  if (!userId || !user) return null;

  if (userProfilesTableMissing === true) {
    return staffProfileFromAuthUser(user);
  }

  const { data, error } = await supabase
    .from('user_profiles')
    .select('user_id, email, full_name, role, points, points_updated_at, avatar_url, phone, extension')
    .eq('user_id', userId)
    .maybeSingle();

  if (!error && data) {
    userProfilesTableMissing = false;
    return data as UserProfile;
  }

  if (error) {
    const { data: fallbackData, error: fallbackErr } = await supabase
      .from('user_profiles')
      .select('user_id, email, full_name, role, points, points_updated_at, avatar_url')
      .eq('user_id', userId)
      .maybeSingle();
    if (!fallbackErr && fallbackData) {
      return { ...(fallbackData as UserProfile), phone: null, extension: null };
    }
    const { data: basicData, error: basicErr } = await supabase
      .from('user_profiles')
      .select('user_id, email, full_name, role, points, points_updated_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (!basicErr && basicData) {
      return { ...(basicData as UserProfile), avatar_url: null, phone: null, extension: null };
    }
  }

  if (error?.code === 'PGRST116') {
    return staffProfileFromAuthUser(user);
  }

  if (error && isMissingUserProfilesRelation(error)) {
    userProfilesTableMissing = true;
    return staffProfileFromAuthUser(user);
  }

  return staffProfileFromAuthUser(user);
}

export async function getCurrentUserProfile(force = false): Promise<UserProfile | null> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) {
    cachedCurrentProfile = null;
    return null;
  }

  if (
    !force &&
    cachedCurrentProfile &&
    cachedCurrentProfile.userId === userId &&
    Date.now() - cachedCurrentProfile.at < PROFILE_CACHE_TTL_MS
  ) {
    return cachedCurrentProfile.profile;
  }

  if (!force && currentProfileInflight) return currentProfileInflight;

  currentProfileInflight = (async () => {
    const profile = await fetchCurrentUserProfileUncached();
    if (profile) {
      cachedCurrentProfile = { userId, profile, at: Date.now() };
    } else {
      cachedCurrentProfile = null;
    }
    currentProfileInflight = null;
    return profile;
  })();

  return currentProfileInflight;
}

export const OPS_CONSOLE_EMAIL = 'ali@globelife-paz.com';

/** HR weekly CSV import + lead assignment to recruiters. */
export const HR_LEAD_DISTRIBUTION_EMAILS = new Set([
  OPS_CONSOLE_EMAIL,
  'hr.licensing@globelife-paz.com',
  'reginald_bentajado@globelife-paz.com',
]);

/** Team reports + per-caller analytics (directors / ops). */
export const REPORTS_VIEWER_EMAILS = new Set([
  OPS_CONSOLE_EMAIL,
  'alex@globelife-paz.com',
  'reginald_bentajado@globelife-paz.com',
  'herlyn_desingano@globelife-paz.com',
]);

export function canAccessReports(role: AppRole | null, email?: string | null): boolean {
  if (role === 'admin' || role === 'leadership') return true;
  const normalized = String(email || '').trim().toLowerCase();
  return normalized.length > 0 && REPORTS_VIEWER_EMAILS.has(normalized);
}

export function isHrLeadDistributorEmail(email: string | null | undefined): boolean {
  const normalized = String(email || '').trim().toLowerCase();
  return normalized.length > 0 && HR_LEAD_DISTRIBUTION_EMAILS.has(normalized);
}

export function canAccessHrLeadDistribution(
  role: AppRole | null,
  email: string | null | undefined,
  fullName?: string | null,
): boolean {
  if (isHrLeadDistributorEmail(email)) return true;
  if (isDirectorHrStaff(email, fullName)) return true;
  return role === 'hr';
}

export function canAccessResumeUploads(
  role: AppRole | null,
  email?: string | null,
): boolean {
  return canAccessHrLeadDistribution(role, email);
}

export function isOpsConsoleEmail(email: string | null | undefined): boolean {
  const normalized = String(email || '').trim().toLowerCase();
  return normalized === OPS_CONSOLE_EMAIL;
}

/** Call disposition log — admins, ali@globelife-paz.com, hr.licensing@globelife-paz.com only. */
export function canAccessCallLog(
  role: AppRole | null,
  email: string | null | undefined,
): boolean {
  if (isOpsConsoleEmail(email)) return true;
  const normalized = String(email || '').trim().toLowerCase();
  if (normalized === 'hr.licensing@globelife-paz.com') return true;
  if (normalized === 'reginald_bentajado@globelife-paz.com') return true;
  return role === 'admin';
}

/** Staff directory — admins only. */
export function canAccessStaffDirectory(role: AppRole | null): boolean {
  return role === 'admin';
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
const ADMIN_PIPELINE_OPERATIONAL_EMAILS = new Set([
  'hr.licensing@globelife-paz.com',
  'reginald_bentajado@globelife-paz.com',
]);

export function adminHasPipelineOperationalAccess(
  role: AppRole | null,
  email: string | null | undefined,
): boolean {
  if (role !== 'admin') return false;
  const normalized = String(email || '').trim().toLowerCase();
  return normalized.length > 0 && ADMIN_PIPELINE_OPERATIONAL_EMAILS.has(normalized);
}

const HIRING_MACHINE_SECTIONS: AppSection[] = [
  'home',
  'overview',
  'pipeline-call',
  'sent-ahead',
  'check-ins',
  'replies',
  'account',
  'pipeline-settings',
];

export function canAccessSection(
  role: AppRole | null,
  section: AppSection,
  _email?: string | null,
  _fullName?: string | null,
): boolean {
  void _email;
  void _fullName;
  if (!role) return section === 'overview' || section === 'home';
  return HIRING_MACHINE_SECTIONS.includes(section);
}

/** Post-login landing: role-based workspace at /home (not legacy CRM overview). */
export function defaultRouteForRole(_role: AppRole | null): string {
  return '/home';
}

export const STAFF_ROLE_LABEL_BY_EMAIL: Record<string, string> = {
  'reginald_bentajado@globelife-paz.com': 'Director HR',
};

export function isDirectorHrStaff(
  email: string | null | undefined,
  fullName?: string | null,
): boolean {
  const normalized = String(email || '').trim().toLowerCase();
  if (normalized && STAFF_ROLE_LABEL_BY_EMAIL[normalized]) return true;
  const name = String(fullName || '').trim().toLowerCase();
  return name.includes('bentajado') || name.includes('reg bentajado');
}

/** Sidebar / profile / dashboard label — overrides default role capitalization when set. */
export function getStaffRoleLabel(
  role: AppRole | null,
  email?: string | null,
  fullName?: string | null,
): string {
  const normalized = String(email || '').trim().toLowerCase();
  const custom = normalized ? STAFF_ROLE_LABEL_BY_EMAIL[normalized] : undefined;
  if (custom) return custom;
  if (isDirectorHrStaff(email, fullName)) return 'Director HR';
  if (!role) return 'Staff';
  return role.charAt(0).toUpperCase() + role.slice(1);
}

/** Admin directors (e.g. Reg) — workstation + HR lead tools like leadership recruiters. */
export function adminHasDirectorOperationalAccess(
  role: AppRole | null,
  email: string | null | undefined,
  fullName?: string | null,
): boolean {
  if (role !== 'admin') return false;
  return (
    adminHasPipelineOperationalAccess(role, email)
    || isOpsConsoleEmail(email)
    || isHrLeadDistributorEmail(email)
    || canAccessReports(role, email)
    || isDirectorHrStaff(email, fullName)
  );
}

/** Hiring CRM (`/dashboard`) — admin, leadership, and HR only. */
export function canAccessCandidatesCrm(
  role: AppRole | null,
  email?: string | null,
): boolean {
  return canAccessSection(role, 'candidates', email);
}

export function resolveAppSectionFromLocation(pathname: string, search: string): AppSection {
  if (pathname === '/home') return 'home';
  if (pathname === '/account') return 'account';
  if (pathname === '/sent-ahead') return 'sent-ahead';
  if (pathname === '/check-ins') return 'check-ins';
  if (pathname === '/replies') return 'replies';
  if (pathname === '/pipeline') return 'pipeline';
  if (pathname === '/pipeline/lead-manager' || pathname.startsWith('/pipeline/lead-manager/')) {
    return 'pipeline-lead-manager';
  }
  if (pathname === '/pipeline/call') return 'pipeline-call';
  if (pathname === '/pipeline/performance') return 'pipeline-performance';
  if (pathname === '/pipeline/email') return 'pipeline-email';
  if (pathname === '/pipeline/webinar-verify') return 'pipeline-webinar-verify';
  if (pathname === '/pipeline/uploads') return 'pipeline-uploads';
  if (pathname === '/pipeline-settings') return 'pipeline-settings';
  if (pathname === '/calls-analytics') return 'calls-analytics';
  if (pathname === '/calls-analytics/leaderboard' || pathname === '/leaderboard') return 'leaderboard';
  if (pathname === '/webinar-geek') return 'webinar-geek';
  if (pathname === '/webinar-questionnaires') return 'webinar-questionnaires';
  if (pathname.startsWith('/live-sessions')) return 'live-sessions';
  if (pathname === '/hr-dashboard') return 'hr-dashboard';
  if (pathname === '/hr/lead-distribution' || pathname === '/hr/leads') return 'pipeline-hr-leads';
  if (pathname === '/qr') return 'qr';
  if (pathname === '/email-log') return 'email-log';
  if (pathname === '/call-log') return 'call-log';
  if (pathname === '/reports' || pathname.startsWith('/reports/')) return 'reports';
  if (pathname === '/admin/staff') return 'staff-directory';
  if (pathname === '/support') return 'support';
  if (pathname === '/performance-check-in') return 'performance-check-in';
  if (pathname === '/performance-check-ins') return 'performance-check-ins';
  if (pathname === '/ops-console') return 'ops-console';
  if (pathname === '/dashboard' || pathname === '/admin') {
    const view = new URLSearchParams(search).get('view');
    if (view === 'settings') return 'settings';
    return 'candidates';
  }
  return 'candidates';
}

export async function listAllUserProfiles(force = false): Promise<UserProfile[]> {
  if (!force && cachedAllProfiles && Date.now() - cachedAllProfiles.at < ALL_PROFILES_CACHE_TTL_MS) {
    return cachedAllProfiles.data;
  }
  if (!force && allProfilesInflight) return allProfilesInflight;

  allProfilesInflight = (async () => {
    const full = await supabase
      .from('user_profiles')
      .select('user_id, email, full_name, role, points, points_updated_at, avatar_url, phone, extension')
      .order('full_name', { ascending: true })
      .order('email', { ascending: true });
    if (!full.error) {
      const data = filterProductionStaffProfiles((full.data || []) as UserProfile[]);
      cachedAllProfiles = { data, at: Date.now() };
      allProfilesInflight = null;
      return data;
    }

    const withoutContact = await supabase
      .from('user_profiles')
      .select('user_id, email, full_name, role, points, points_updated_at, avatar_url')
      .order('full_name', { ascending: true })
      .order('email', { ascending: true });
    if (!withoutContact.error) {
      const data = filterProductionStaffProfiles(
        ((withoutContact.data || []) as UserProfile[]).map((row) => ({ ...row, phone: null, extension: null })),
      );
      cachedAllProfiles = { data, at: Date.now() };
      allProfilesInflight = null;
      return data;
    }

    const withoutPoints = await supabase
      .from('user_profiles')
      .select('user_id, email, full_name, role')
      .order('email', { ascending: true });
    if (!withoutPoints.error) {
      const data = filterProductionStaffProfiles(
        ((withoutPoints.data || []) as UserProfile[]).map((row) => ({
          ...row,
          avatar_url: null,
          phone: null,
          extension: null,
        })),
      );
      cachedAllProfiles = { data, at: Date.now() };
      allProfilesInflight = null;
      return data;
    }

    const viaFn = await fetchDashboardTeamMetricsViaFunction('last7');
    if (viaFn.ok && viaFn.profiles.length > 0) {
      const data = filterProductionStaffProfiles(viaFn.profiles);
      cachedAllProfiles = { data, at: Date.now() };
      allProfilesInflight = null;
      return data;
    }

    allProfilesInflight = null;
    throw new Error(full.error.message || withoutPoints.error?.message || 'Could not load user profiles');
  })();

  return allProfilesInflight;
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

if (typeof window !== 'undefined') {
  window.addEventListener('pohiring:profile-updated', () => invalidateStaffDataCaches());
}

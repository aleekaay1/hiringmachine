import type { Session } from '@supabase/supabase-js';
import type { AppRole } from './accessControl';
import { getCurrentUserProfile } from './accessControl';
import { supabase } from './supabaseClient';

export type StaffSessionSnapshot = {
  userId: string | null;
  role: AppRole | null;
  userEmail: string | null;
  displayName: string;
  avatarUrl: string | null;
  resolved: boolean;
};

let authReady = false;
let authenticated = false;
let profileSnapshot: StaffSessionSnapshot = {
  userId: null,
  role: null,
  userEmail: null,
  displayName: 'Staff',
  avatarUrl: null,
  resolved: false,
};

let authInflight: Promise<boolean> | null = null;
let profileInflight: Promise<StaffSessionSnapshot> | null = null;

export function getStaffAuthState(): { authReady: boolean; isAuthenticated: boolean } {
  return { authReady, isAuthenticated: authenticated };
}

export function getStaffSessionSnapshot(): StaffSessionSnapshot {
  return profileSnapshot;
}

function applyProfile(profile: Awaited<ReturnType<typeof getCurrentUserProfile>>, email: string | null): StaffSessionSnapshot {
  profileSnapshot = {
    userId: profile?.user_id ?? null,
    role: profile?.role ?? null,
    userEmail: email ?? profile?.email ?? null,
    displayName: profile?.full_name || email || 'Staff',
    avatarUrl: profile?.avatar_url ?? null,
    resolved: true,
  };
  return profileSnapshot;
}

export function primeStaffAuth(session: Session | null): void {
  authReady = true;
  authenticated = Boolean(session);
  if (!session) {
    profileSnapshot = {
      userId: null,
      role: null,
      userEmail: null,
      displayName: 'Staff',
      avatarUrl: null,
      resolved: false,
    };
  }
}

export async function ensureStaffAuth(): Promise<boolean> {
  if (authReady) return authenticated;
  if (authInflight) return authInflight;
  authInflight = (async () => {
    const { data } = await supabase.auth.getSession();
    primeStaffAuth(data.session);
    authInflight = null;
    return authenticated;
  })();
  return authInflight;
}

export async function resolveStaffSession(force = false): Promise<StaffSessionSnapshot> {
  if (!force && profileSnapshot.resolved) return profileSnapshot;
  if (!force && profileInflight) return profileInflight;

  profileInflight = (async () => {
    await ensureStaffAuth();
    if (!authenticated) {
      profileSnapshot = { ...profileSnapshot, resolved: true };
      profileInflight = null;
      return profileSnapshot;
    }
    const [profile, authRes] = await Promise.all([getCurrentUserProfile(), supabase.auth.getUser()]);
    const snapshot = applyProfile(profile, authRes.data.user?.email ?? profile?.email ?? null);
    profileInflight = null;
    return snapshot;
  })();

  return profileInflight;
}

export function clearStaffSessionCache(): void {
  authReady = false;
  authenticated = false;
  profileSnapshot = {
    userId: null,
    role: null,
    userEmail: null,
    displayName: 'Staff',
    avatarUrl: null,
    resolved: false,
  };
  authInflight = null;
  profileInflight = null;
}

export function subscribeStaffAuth(onChange: () => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    primeStaffAuth(session);
    if (!session) {
      profileSnapshot = {
        userId: null,
        role: null,
        userEmail: null,
        displayName: 'Staff',
        avatarUrl: null,
        resolved: true,
      };
      onChange();
      return;
    }
    // Keep the current snapshot visible while refreshing — avoid UI flashes (e.g. notification bell).
    void resolveStaffSession(true).then(() => {
      onChange();
    });
  });
  return () => data.subscription.unsubscribe();
}

import type { UserProfile } from './accessControl';

export type StaffAvatarLookup = {
  byUserId: Map<string, string>;
  byDisplayName: Map<string, string>;
};

export function emptyStaffAvatarLookup(): StaffAvatarLookup {
  return { byUserId: new Map(), byDisplayName: new Map() };
}

function normalizeLookupKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function buildStaffAvatarLookup(profiles: UserProfile[]): StaffAvatarLookup {
  const byUserId = new Map<string, string>();
  const byDisplayName = new Map<string, string>();

  for (const profile of profiles) {
    const url = String(profile.avatar_url || '').trim();
    if (!url) continue;

    if (profile.user_id) byUserId.set(profile.user_id, url);

    if (profile.full_name) {
      byDisplayName.set(normalizeLookupKey(profile.full_name), url);
    }
    if (profile.email) {
      byDisplayName.set(normalizeLookupKey(profile.email), url);
      const local = profile.email.split('@')[0] || '';
      if (local) {
        byDisplayName.set(normalizeLookupKey(local), url);
        byDisplayName.set(normalizeLookupKey(local.replace(/[._-]+/g, ' ')), url);
      }
    }
  }

  return { byUserId, byDisplayName };
}

export function resolveStaffAvatarUrl(
  lookup: StaffAvatarLookup | undefined,
  input: {
    userId?: string | null;
    displayName?: string | null;
    avatarUrl?: string | null;
  },
): string | null {
  const direct = String(input.avatarUrl || '').trim();
  if (direct) return direct;
  if (!lookup) return null;

  const userId = String(input.userId || '').trim();
  if (userId && lookup.byUserId.has(userId)) {
    return lookup.byUserId.get(userId)!;
  }

  const nameKey = normalizeLookupKey(input.displayName || '');
  if (nameKey && lookup.byDisplayName.has(nameKey)) {
    return lookup.byDisplayName.get(nameKey)!;
  }

  return null;
}

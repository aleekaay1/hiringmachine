import type { AppRole } from './accessControl';
import { supabase } from './supabaseClient';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export type StaffNotificationCategory =
  | 'email_reply'
  | 'check_in'
  | 'low_dials'
  | 'no_show'
  | 'callback'
  | 'ops'
  | 'system'
  | 'support';

export type StaffNotification = {
  id: string;
  user_id: string | null;
  target_roles: string[] | null;
  category: StaffNotificationCategory;
  title: string;
  body: string | null;
  link_route: string | null;
  link_label: string | null;
  metadata: Record<string, unknown>;
  dedupe_key: string | null;
  read_at: string | null;
  created_at: string;
};

export const NOTIFICATION_CATEGORY_LABELS: Record<StaffNotificationCategory, string> = {
  email_reply: 'Email reply',
  check_in: 'Check-in',
  low_dials: 'Low dials',
  no_show: 'No-show',
  callback: 'Callback',
  ops: 'Ops',
  system: 'System',
  support: 'Support',
};

const STAFF_NOTIFICATION_ROLES = new Set<AppRole>(['recruiter', 'leadership', 'webinar', 'admin', 'hr']);

export function canUseStaffNotifications(role: AppRole | null): boolean {
  return Boolean(role && STAFF_NOTIFICATION_ROLES.has(role));
}

/** Show bell for any signed-in staff workspace user (notifications may still be role-filtered server-side). */
export function shouldShowStaffNotificationBell(userId: string | null, _roleResolved?: boolean): boolean {
  return Boolean(userId);
}

async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function callStaffNotifications(
  init: RequestInit & { query?: Record<string, string> },
): Promise<Record<string, unknown>> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Missing Supabase configuration.');
  }
  const token = await getAccessToken();
  if (!token) throw new Error('Not signed in.');

  const qs = init.query ? `?${new URLSearchParams(init.query).toString()}` : '';
  const res = await fetch(`${SUPABASE_URL}/functions/v1/staff-notifications${qs}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok && json.ledgerMissing !== true) {
    throw new Error(
      typeof json.error === 'string' ? json.error : `Notification request failed (${res.status})`,
    );
  }
  return json;
}

export async function loadStaffNotifications(): Promise<{
  notifications: StaffNotification[];
  unread: number;
  ready: boolean;
}> {
  try {
    const json = await callStaffNotifications({ method: 'GET', query: { action: 'list' } });
    const notifications = Array.isArray(json.notifications) ? (json.notifications as StaffNotification[]) : [];
    return {
      notifications,
      unread: Number(json.unread || 0),
      ready: json.ledgerMissing !== true,
    };
  } catch {
    return { notifications: [], unread: 0, ready: false };
  }
}

export async function syncStaffNotifications(): Promise<{
  notifications: StaffNotification[];
  unread: number;
}> {
  const json = await callStaffNotifications({
    method: 'POST',
    body: JSON.stringify({ action: 'sync' }),
  });
  return {
    notifications: Array.isArray(json.notifications) ? (json.notifications as StaffNotification[]) : [],
    unread: Number(json.unread || 0),
  };
}

export async function markStaffNotificationRead(id: string): Promise<void> {
  await callStaffNotifications({
    method: 'POST',
    body: JSON.stringify({ action: 'mark_read', id }),
  });
}

export async function markAllStaffNotificationsRead(): Promise<void> {
  await callStaffNotifications({
    method: 'POST',
    body: JSON.stringify({ action: 'mark_all_read' }),
  });
}

export async function dismissStaffNotification(id: string): Promise<void> {
  const json = await callStaffNotifications({
    method: 'POST',
    body: JSON.stringify({ action: 'dismiss', id }),
  });
  if (json.ok !== true && typeof json.error === 'string') {
    throw new Error(json.error);
  }
}

export async function dismissAllStaffNotifications(): Promise<void> {
  await callStaffNotifications({
    method: 'POST',
    body: JSON.stringify({ action: 'dismiss_all' }),
  });
}

export async function createStaffNotification(input: {
  title: string;
  body?: string;
  category?: StaffNotificationCategory;
  userId?: string | null;
  targetRoles?: string[] | null;
  linkRoute?: string | null;
  linkLabel?: string | null;
  dedupeKey?: string | null;
  expiresAt?: string | null;
}): Promise<StaffNotification> {
  const json = await callStaffNotifications({
    method: 'POST',
    body: JSON.stringify({
      action: 'create',
      title: input.title,
      body: input.body,
      category: input.category || 'ops',
      userId: input.userId,
      targetRoles: input.targetRoles,
      linkRoute: input.linkRoute,
      linkLabel: input.linkLabel,
      dedupeKey: input.dedupeKey,
      expiresAt: input.expiresAt,
    }),
  });
  return json.notification as StaffNotification;
}

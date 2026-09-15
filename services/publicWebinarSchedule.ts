const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export type PublicUpcomingBroadcast = {
  id: string | number | null;
  title: string | null;
  date: unknown;
  webinar_id: string | number | null;
  day_label?: 'today' | 'tomorrow' | null;
  starts_in_minutes?: number | null;
  is_jit?: boolean;
  jit_period_minutes?: number | null;
};

export type PublicWebinarBookResult = {
  ok: true;
  booked: boolean;
  already_registered: boolean;
  quick?: boolean;
  email_verified?: boolean;
  message?: string;
  watch_link?: string | null;
  confirmation_link?: string | null;
  broadcast?: {
    id: string;
    title: string | null;
    date: unknown;
    webinar_id: string | null;
  };
};

function functionUrl(path: string): string | null {
  if (!SUPABASE_URL) return null;
  return `${SUPABASE_URL}/functions/v1/hm-public-webinar-schedule${path}`;
}

async function callPublic(
  path: string,
  init: RequestInit = {},
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { ok: false, error: 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY' };
  }
  const url = functionUrl(path);
  if (!url) return { ok: false, error: 'Missing function URL' };

  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err =
      typeof json.error === 'string'
        ? json.error
        : res.status === 503
        ? 'Webinar scheduling is not configured yet. Please try again later.'
        : res.statusText || 'Request failed';
    return { ok: false, error: err };
  }
  return { ok: true, data: json };
}

export async function fetchPublicUpcomingBroadcasts(): Promise<
  | {
      ok: true;
      broadcasts: PublicUpcomingBroadcast[];
      quickSlot: PublicUpcomingBroadcast | null;
    }
  | { ok: false; error: string }
> {
  const result = await callPublic('?mode=upcoming');
  if (!result.ok) return result;
  const rows = Array.isArray(result.data.broadcasts)
    ? (result.data.broadcasts as PublicUpcomingBroadcast[])
    : [];
  const quick =
    result.data.quick_slot && typeof result.data.quick_slot === 'object'
      ? (result.data.quick_slot as PublicUpcomingBroadcast)
      : null;
  return { ok: true, broadcasts: rows, quickSlot: quick };
}

export async function bookPublicWebinar(input: {
  email: string;
  firstname: string;
  surname: string;
  phone?: string;
  broadcast_id?: string;
  webinar_id?: string;
  quick?: boolean;
}): Promise<{ ok: true; data: PublicWebinarBookResult } | { ok: false; error: string }> {
  const result = await callPublic('?mode=book', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!result.ok) return result;
  return { ok: true, data: result.data as unknown as PublicWebinarBookResult };
}

/** Format WG unix date for candidate-facing schedule list. */
export function formatBroadcastWhen(date: unknown, timeZone = 'America/Toronto'): string {
  const n = Number(date);
  if (!Number.isFinite(n) || n <= 0) return 'Date TBA';
  const ms = n > 1e12 ? n : n * 1000;
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleString();
  }
}

export function dayLabelText(label: PublicUpcomingBroadcast['day_label']): string {
  if (label === 'today') return 'Today';
  if (label === 'tomorrow') return 'Tomorrow';
  return '';
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export interface WebinarGeekDashboardFilters {
  webinarId?: string;
  broadcastId?: string;
  watchedWebinar?: boolean;
  watchedLive?: boolean;
  watchedReplay?: boolean;
  perPage?: number;
}

export interface WebinarGeekActionResult {
  ok: boolean;
  status: number;
  action: string;
  result: Record<string, unknown>;
}

function buildFunctionUrl(path: string): string | null {
  if (!SUPABASE_URL) return null;
  return `${SUPABASE_URL}/functions/v1/integrations-webinar-geek${path}`;
}

async function callWebinarGeek(
  accessToken: string,
  path: string,
  init: RequestInit = {}
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { ok: false, error: 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY' };
  }
  const url = buildFunctionUrl(path);
  if (!url) return { ok: false, error: 'Missing function URL' };

  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = (json.error as string) || res.statusText || 'Request failed';
    return { ok: false, error: err };
  }
  return { ok: true, data: json };
}

export async function fetchWebinarGeekHealth(accessToken: string) {
  return callWebinarGeek(accessToken, '?mode=health');
}

export async function fetchWebinarGeekDashboard(
  accessToken: string,
  filters: WebinarGeekDashboardFilters
) {
  const params = new URLSearchParams({ mode: 'dashboard' });
  if (filters.webinarId) params.set('webinar_id', filters.webinarId);
  if (filters.broadcastId) params.set('broadcast_id', filters.broadcastId);
  if (typeof filters.watchedWebinar === 'boolean') params.set('watched_webinar', String(filters.watchedWebinar));
  if (typeof filters.watchedLive === 'boolean') params.set('watched_live', String(filters.watchedLive));
  if (typeof filters.watchedReplay === 'boolean') params.set('watched_replay', String(filters.watchedReplay));
  if (typeof filters.perPage === 'number') params.set('per_page', String(filters.perPage));
  return callWebinarGeek(accessToken, `?${params.toString()}`);
}

export async function webinarGeekAction(
  accessToken: string,
  actionPayload: Record<string, unknown>
): Promise<{ ok: true; data: WebinarGeekActionResult } | { ok: false; error: string }> {
  const res = await callWebinarGeek(accessToken, '', {
    method: 'POST',
    body: JSON.stringify(actionPayload),
  });
  if (!res.ok) return res;
  return { ok: true, data: res.data as unknown as WebinarGeekActionResult };
}

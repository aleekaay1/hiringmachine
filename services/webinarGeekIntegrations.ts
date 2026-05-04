const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export interface WebinarGeekDashboardFilters {
  webinarId?: string;
  broadcastId?: string;
  watchedWebinar?: boolean;
  watchedLive?: boolean;
  watchedReplay?: boolean;
  perPage?: number;
  /** Inclusive YYYY-MM-DD (UTC calendar day window used by the Edge Function). */
  since?: string;
  until?: string;
  /** When false, skips heavy `/webinars` + `/broadcasts` list calls (default in UI). */
  includeCatalog?: boolean;
  maxPages?: number;
}

export interface WebinarGeekSyncPayload {
  webinarId?: string;
  broadcastId?: string;
  perPage?: number;
  since?: string;
  until?: string;
  maxPages?: number;
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
    if (res.status === 401) {
      return { ok: false, error: 'Unauthorized (session expired). Please sign in again.' };
    }
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
  if (filters.since?.trim()) params.set('since', filters.since.trim());
  if (filters.until?.trim()) params.set('until', filters.until.trim());
  if (filters.includeCatalog === false) params.set('include_catalog', '0');
  if (typeof filters.maxPages === 'number') params.set('max_pages', String(filters.maxPages));
  return callWebinarGeek(accessToken, `?${params.toString()}`);
}

export async function syncWebinarGeekCandidates(
  accessToken: string,
  payload: WebinarGeekSyncPayload
) {
  const params = new URLSearchParams({ mode: 'sync' });
  return callWebinarGeek(accessToken, `?${params.toString()}`, {
    method: 'POST',
    body: JSON.stringify({
      webinar_id: payload.webinarId || undefined,
      broadcast_id: payload.broadcastId || undefined,
      per_page: payload.perPage ?? 250,
      since: payload.since || undefined,
      until: payload.until || undefined,
      max_pages: payload.maxPages ?? 25,
    }),
  });
}

import { supabase } from './supabaseClient';
import type { UserProfile } from './accessControl';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export type DashboardTeamSnapshot = {
  period: string;
  rows: unknown[];
  previousRows: unknown[];
  windowLabel: string;
  fetchedAt: string | null;
};

export async function fetchPipelineCandidateEmailsViaFunction(candidateIds: string[]): Promise<
  | { ok: true; emails: Map<string, string> }
  | { ok: false; error: string }
> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { ok: false, error: 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY' };
  }
  const unique = [...new Set(candidateIds.filter(Boolean))];
  if (!unique.length) return { ok: true, emails: new Map() };

  const token = await getAccessToken();
  if (!token) return { ok: false, error: 'Not signed in' };

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/pipeline-candidate-emails`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ candidateIds: unique }),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: (json.error as string) || res.statusText || 'Request failed' };
    }
    const raw = json.emails && typeof json.emails === 'object' ? (json.emails as Record<string, string>) : {};
    const emails = new Map<string, string>();
    for (const [id, email] of Object.entries(raw)) {
      const normalized = String(email || '').trim().toLowerCase();
      if (id && normalized) emails.set(id, normalized);
    }
    return { ok: true, emails };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function isSupabaseNetworkError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('failed to fetch') ||
    m.includes('networkerror') ||
    m.includes('network request failed') ||
    m.includes('load failed') ||
    m.includes('cors') ||
    m.includes('err_failed')
  );
}

async function getAccessToken(): Promise<string | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  return sessionData.session?.access_token ?? null;
}

/** Edge function fallback when PostgREST REST calls fail in the browser (CORS / gateway). */
export async function fetchDashboardTeamMetricsViaFunction(period = 'last7'): Promise<
  | {
      ok: true;
      snapshot: DashboardTeamSnapshot | null;
      profiles: UserProfile[];
      roleCounts: Record<string, number>;
    }
  | { ok: false; error: string }
> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { ok: false, error: 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY' };
  }
  const token = await getAccessToken();
  if (!token) return { ok: false, error: 'Not signed in' };

  const url = `${SUPABASE_URL}/functions/v1/dashboard-team-metrics?period=${encodeURIComponent(period)}`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
      },
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: (json.error as string) || res.statusText || 'Request failed' };
    }
    const snap = json.snapshot as DashboardTeamSnapshot | null | undefined;
    return {
      ok: true,
      snapshot: snap
        ? {
            period: String(snap.period || period),
            rows: Array.isArray(snap.rows) ? snap.rows : [],
            previousRows: Array.isArray(snap.previousRows) ? snap.previousRows : [],
            windowLabel: String(snap.windowLabel || ''),
            fetchedAt: snap.fetchedAt ?? null,
          }
        : null,
      profiles: Array.isArray(json.profiles) ? (json.profiles as UserProfile[]) : [],
      roleCounts:
        json.roleCounts && typeof json.roleCounts === 'object'
          ? (json.roleCounts as Record<string, number>)
          : {},
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

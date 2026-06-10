import { supabase } from './supabaseClient';
import { fetchLiveSessionsDashboard } from './liveSessionsIntegrations';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export type LiveSessionOutcomeSyncResult = {
  ok: boolean;
  scanned?: number;
  matched?: number;
  attended?: number;
  scheduled?: number;
  updated?: number;
  coinsSynced?: number;
  message?: string;
  error?: string;
};

/** Pull latest Calendly + Zoom into DB, then match Booked (Live Session) rows. */
export async function refreshLiveSessionsAndMatchOutcomes(options?: {
  syncCoins?: boolean;
  daysBack?: number;
}): Promise<LiveSessionOutcomeSyncResult> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { ok: false, error: 'Missing Supabase configuration' };
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return { ok: false, error: 'Not signed in' };

  try {
    const dash = await fetchLiveSessionsDashboard(token, { sync: true });
    if (!dash.ok) {
      console.warn('[liveSessionOutcome] Calendly/Zoom sync failed, matching cached registrants', dash.error);
    }
  } catch (err) {
    console.warn('[liveSessionOutcome] Calendly/Zoom sync failed, matching cached registrants', err);
  }

  const res = await fetch(`${SUPABASE_URL}/functions/v1/sync-live-session-outcomes`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      syncCoins: options?.syncCoins !== false,
      daysBack: options?.daysBack ?? 90,
    }),
  });

  const body = (await res.json().catch(() => ({}))) as LiveSessionOutcomeSyncResult;
  if (!res.ok) {
    return { ok: false, error: body.error || `Sync failed (${res.status})` };
  }
  return { ...body, ok: true };
}

import { supabase } from './supabaseClient';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const THREEX_WEBCLIENT_URL = import.meta.env.VITE_3CX_WEBCLIENT_URL as string | undefined;

export type ThreeCxAction =
  | 'health'
  | 'dial'
  | 'hangup'
  | 'hold'
  | 'resume'
  | 'mute'
  | 'unmute'
  | 'transfer'
  | 'dtmf'
  | 'active_calls'
  | 'agent_state';

export interface ThreeCxActionPayload {
  action: ThreeCxAction;
  extension?: string;
  destination?: string;
  callId?: string;
  targetExtension?: string;
  dtmfDigits?: string;
  metadata?: Record<string, unknown>;
}

export interface ThreeCxResult {
  ok: boolean;
  error?: string;
  data?: Record<string, unknown>;
}

async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (token) return token;
  const { data: refreshed } = await supabase.auth.refreshSession();
  return refreshed.session?.access_token ?? null;
}

export function buildThreeCxWebclientUrl(phone: string): string | null {
  if (!THREEX_WEBCLIENT_URL) return null;
  const trimmed = phone.trim();
  const sanitized = trimmed.replace(/[^\d+]/g, '');
  let base: URL;
  try {
    base = new URL(THREEX_WEBCLIENT_URL);
  } catch {
    return null;
  }
  const pathname = base.pathname.replace(/\/+$/, '');
  if (!pathname.endsWith('/webclient')) {
    base.pathname = `${pathname}/webclient`;
  }
  if (!sanitized) return base.toString();
  // 3CX webclient uses hash route for click-to-dial.
  base.hash = `/call?phone=${encodeURIComponent(sanitized)}`;
  return base.toString();
}

export async function runThreeCxAction(payload: ThreeCxActionPayload): Promise<ThreeCxResult> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { ok: false, error: 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY' };
  }
  const token = await getAccessToken();
  if (!token) return { ok: false, error: 'No active session token' };
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/threecx-call-control`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: String(json.error || res.statusText || '3CX action failed') };
    }
    return { ok: true, data: json };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

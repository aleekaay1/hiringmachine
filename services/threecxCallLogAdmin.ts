import { supabase } from './supabaseClient';

export type ThreeCxConnectionStatus = {
  ok: boolean;
  webhookConfigured: boolean;
  webhookLive: boolean;
  lastWebhookAt: string | null;
  lastWebhookMinutesAgo: number | null;
  lastEventType: string | null;
  webhooksToday: number;
  recordingsAttachedToday: number;
  extensionMapCount: number;
  threecxApiConfigured: boolean;
  threecxApiOk: boolean;
  threecxApiError: string | null;
  todayDate: string;
  error?: string;
};

async function invokeThreeCxCallAdmin<T>(action: string): Promise<T> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!supabaseUrl || !anonKey) throw new Error('Missing Supabase environment configuration.');

  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw new Error('You must be signed in.');

  const res = await fetch(`${supabaseUrl}/functions/v1/threecx-call-admin`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action }),
  });

  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(String(body.error || `Request failed (${res.status})`));
  }
  return body;
}

export async function fetchThreeCxConnectionStatus(): Promise<ThreeCxConnectionStatus> {
  try {
    const data = await invokeThreeCxCallAdmin<ThreeCxConnectionStatus>('status');
    return { ...data, ok: true };
  } catch (err) {
    return {
      ok: false,
      webhookConfigured: false,
      webhookLive: false,
      lastWebhookAt: null,
      lastWebhookMinutesAgo: null,
      lastEventType: null,
      webhooksToday: 0,
      recordingsAttachedToday: 0,
      extensionMapCount: 0,
      threecxApiConfigured: false,
      threecxApiOk: false,
      threecxApiError: null,
      todayDate: new Date().toISOString().slice(0, 10),
      error: err instanceof Error ? err.message : 'Status check failed',
    };
  }
}

export async function syncRecruiter3cxExtensions(): Promise<{
  updated: number;
  skipped: number;
  message?: string;
  details?: Array<{ email: string; extension: string; status: string }>;
}> {
  return invokeThreeCxCallAdmin('sync-extensions');
}

export async function syncThreeCxRecordings(): Promise<{
  hoursBack?: number;
  scanned: number;
  withRecording: number;
  matched: number;
  updated: number;
  apiMatched?: number;
  warning?: string | null;
  message?: string;
}> {
  return invokeThreeCxCallAdmin('sync-recordings');
}

export async function backfillTodayThreeCxRecordings(): Promise<{
  todayDate: string;
  scanned: number;
  withRecording: number;
  matched: number;
  updated: number;
  webhookScanned?: number;
  webhookMatched?: number;
  apiScanned?: number;
  apiMatched?: number;
  warning?: string | null;
  message?: string;
}> {
  return invokeThreeCxCallAdmin('backfill-today');
}

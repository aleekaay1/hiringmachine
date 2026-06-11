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

async function invokeThreeCxCallAdmin<T>(
  action: string,
  extra?: Record<string, unknown>,
): Promise<T> {
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
    body: JSON.stringify({ action, ...extra }),
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

export async function syncThreeCxRecordings(options?: {
  hoursBack?: number;
  incremental?: boolean;
  fullRematch?: boolean;
}): Promise<{
  hoursBack?: number;
  scanned: number;
  withRecording: number;
  matched: number;
  updated: number;
  cleared?: number;
  incremental?: boolean;
  warning?: string | null;
  message?: string;
}> {
  return invokeThreeCxCallAdmin('sync-recordings', {
    hoursBack: options?.hoursBack ?? 24,
    incremental: options?.incremental !== false,
    fullRematch: options?.fullRematch === true,
  });
}

export async function clearThreeCxRecordings(hoursBack = 0): Promise<{
  cleared: number;
  message?: string;
}> {
  return invokeThreeCxCallAdmin('clear-recordings', { hoursBack });
}

export type CallLogWebhookRow = {
  id: string;
  receivedAt: string;
  phoneNumber: string;
  agentExtension: string | null;
  callDirection: string | null;
  recordingUrl: string | null;
  durationSeconds: number | null;
  matched: boolean;
  callRecordId: string | null;
};

export async function fetchCallRecordingForDisposition(callRecordId: string): Promise<{
  matched: boolean;
  callRecordId?: string;
  recordingUrl?: string | null;
  durationSeconds?: number | null;
  source?: string;
  message?: string;
}> {
  return invokeThreeCxCallAdmin('fetch-recording', { callRecordId });
}

/** Proxy 3CX audio through our edge function (3CX blocks browser CORS). */
export type RecordingTranscriptSegment = {
  start: number;
  end: number;
  text: string;
};

export type RecordingTranscript = {
  text: string;
  segments: RecordingTranscriptSegment[];
  model: string;
  transcribedAt: string;
  language: string;
};

export async function loadCachedRecordingTranscript(
  callRecordId: string,
): Promise<RecordingTranscript | null> {
  const data = await invokeThreeCxCallAdmin<{ transcript: RecordingTranscript | null }>(
    'get-recording-transcript',
    { callRecordId },
  );
  return data.transcript?.text ? data.transcript : null;
}

export async function saveRecordingTranscript(
  callRecordId: string,
  transcript: RecordingTranscript,
): Promise<RecordingTranscript> {
  const data = await invokeThreeCxCallAdmin<{ transcript: RecordingTranscript }>(
    'save-recording-transcript',
    { callRecordId, transcript },
  );
  return data.transcript;
}

export async function fetchCallRecordingStreamUrl(callRecordId: string): Promise<string> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!supabaseUrl || !anonKey) throw new Error('Missing Supabase environment configuration.');

  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw new Error('You must be signed in.');

  const params = new URLSearchParams({
    action: 'stream-recording',
    callRecordId,
  });
  const res = await fetch(`${supabaseUrl}/functions/v1/threecx-call-admin?${params}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anonKey,
    },
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(String(body.error || `Recording stream failed (${res.status})`));
  }

  const blob = await res.blob();
  if (!blob.size) throw new Error('Recording file was empty.');
  return URL.createObjectURL(blob);
}

export async function fetchCallLogWebhookRows(hoursBack = 72): Promise<CallLogWebhookRow[]> {
  const data = await invokeThreeCxCallAdmin<{ rows?: CallLogWebhookRow[] }>('list-webhook-calls', { hoursBack });
  return data.rows || [];
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

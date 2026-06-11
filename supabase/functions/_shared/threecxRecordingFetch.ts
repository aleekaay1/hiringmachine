/**
 * Recording lookup: stored webhooks (primary) → extension+time CDR → phone CDR.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  callIdFromHistoryRow,
  extensionsFromHistory,
  historyExtensionMatches,
  parseRowStartMs,
  recordingUrlFromRow,
  rowContainsPhone,
} from './threecxHistoryParse.ts';
import { digitsOnly, parseDurationSecondsFromText, phonesMatch, resolveRecruiterUserIds } from './threecxCallMatch.ts';
import { RECRUITER_3CX_EXTENSIONS } from './recruiter3cxExtensions.ts';

export type RecordingCandidate = {
  recordingUrl: string;
  durationSeconds: number | null;
  callId: string;
  anchorMs: number;
  extension: string;
  source: string;
};

export type RecordingFetchDiag = {
  phoneHits: number;
  extHits: number;
  withRecording: number;
  webhookRows: number;
  webhookHits: number;
  extensionDayRows: number;
  sampleExtPhones: string[];
  getCallLogAttempts: string[];
  matchAnchorMs: number;
  matchWindowStartMs: number;
  matchWindowEndMs: number;
};

const RECRUITER_EXTENSIONS = new Set(
  RECRUITER_3CX_EXTENSIONS.map((r) => digitsOnly(r.extension)).filter(Boolean),
);

export function isKnownRecruiterExtension(ext: string): boolean {
  const d = digitsOnly(ext);
  if (!d) return false;
  const norm = d.length > 4 ? d.slice(-4) : d;
  return RECRUITER_EXTENSIONS.has(norm) || RECRUITER_EXTENSIONS.has(d);
}

function pickString(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return '';
}

function normalizeExtensionDigits(ext: string): string {
  const digits = digitsOnly(String(ext || '').trim());
  if (!digits) return '';
  return digits.length > 4 ? digits.slice(-4) : digits;
}

function extensionsMatch(a: string, b: string): boolean {
  const ea = normalizeExtensionDigits(a);
  const eb = normalizeExtensionDigits(b);
  return Boolean(ea && eb && ea === eb);
}

function anchorMsFromWebhookPayload(payload: Record<string, unknown>, receivedAt: string): number {
  for (const key of ['call_end_utc', 'call_start_utc']) {
    const raw = pickString(payload, [key]);
    if (raw) {
      const ms = Date.parse(raw);
      if (Number.isFinite(ms)) return ms;
    }
  }
  for (const key of ['call_end_utc_millis', 'call_start_utc_millis']) {
    const n = Number(payload[key]);
    if (Number.isFinite(n) && n > 0) {
      const ms = n > 1e12 ? n : n * 1000;
      if (Number.isFinite(ms)) return ms;
    }
  }
  return Date.parse(receivedAt);
}

/** Disposition is saved after hangup; dial_started_at may equal disposed_at in Call Workspace bug — widen window. */
export function computeMatchWindow(input: {
  disposedMs: number;
  dialStartedMs: number | null;
}): { anchorMs: number; startMs: number; endMs: number } {
  const disposedMs = input.disposedMs;
  const dialMs = input.dialStartedMs;
  let anchorMs = disposedMs;

  if (dialMs != null && Number.isFinite(dialMs)) {
    const gap = disposedMs - dialMs;
    if (gap > 2 * 60 * 1000) {
      anchorMs = dialMs + Math.round(gap * 0.35);
    } else {
      anchorMs = disposedMs - 8 * 60 * 1000;
    }
  } else {
    anchorMs = disposedMs - 10 * 60 * 1000;
  }

  const startMs = Math.min(
    disposedMs - 45 * 60 * 1000,
    (dialMs != null && Number.isFinite(dialMs) ? dialMs : disposedMs) - 5 * 60 * 1000,
  );
  const endMs = disposedMs + 10 * 60 * 1000;
  return { anchorMs, startMs, endMs };
}

function pickClosest(candidates: RecordingCandidate[], targetMs: number): RecordingCandidate | null {
  if (!candidates.length) return null;
  return candidates.reduce((prev, curr) => {
    return Math.abs(curr.anchorMs - targetMs) < Math.abs(prev.anchorMs - targetMs) ? curr : prev;
  });
}

export async function findWebhookRecording(
  admin: SupabaseClient,
  input: {
    phone: string;
    extension: string;
    recruiterUserId: string | null;
    startMs: number;
    endMs: number;
    targetMs: number;
  },
): Promise<{ candidate: RecordingCandidate | null; rowsScanned: number }> {
  const queryStart = new Date(input.startMs - 60 * 60 * 1000).toISOString();
  const queryEnd = new Date(input.endMs + 60 * 60 * 1000).toISOString();

  const { data: events, error } = await admin
    .from('threecx_webhook_events')
    .select('id, received_at, payload, agent_extension, phone_number')
    .eq('event_type', 'report_call')
    .gte('received_at', queryStart)
    .lte('received_at', queryEnd)
    .order('received_at', { ascending: false })
    .limit(300);
  if (error) throw error;

  const candidates: RecordingCandidate[] = [];
  for (const event of events || []) {
    const payload = event.payload && typeof event.payload === 'object'
      ? event.payload as Record<string, unknown>
      : {};
    const recordingUrl = pickString(payload, ['recording_url', 'RecordingUrl']);
    if (!recordingUrl.startsWith('http')) continue;

    const rowPhone = pickString(payload, ['phone_number', 'PhoneNumber']) || String(event.phone_number || '');
    const rowExt = pickString(payload, ['agent_extension', 'Agent']) || String(event.agent_extension || '');
    if (!phonesMatch(input.phone, rowPhone)) continue;
    if (!extensionsMatch(input.extension, rowExt)) continue;

    if (input.recruiterUserId) {
      const ids = await resolveRecruiterUserIds(admin, normalizeExtensionDigits(rowExt), '');
      if (ids.length && !ids.includes(String(input.recruiterUserId))) continue;
    }

    const anchorMs = anchorMsFromWebhookPayload(payload, String(event.received_at || ''));
    if (anchorMs < input.startMs || anchorMs > input.endMs) continue;

    candidates.push({
      recordingUrl,
      durationSeconds: parseDurationSecondsFromText(
        pickString(payload, ['duration_seconds', 'duration', 'Duration']),
      ),
      callId: pickString(payload, ['call_id', 'callId']) || `webhook-${event.id}`,
      anchorMs,
      extension: rowExt,
      source: 'threecx_webhook',
    });
  }

  return { candidate: pickClosest(candidates, input.targetMs), rowsScanned: (events || []).length };
}

export function findHistoryRecording(input: {
  rows: Record<string, unknown>[];
  phone: string;
  extension: string;
  startMs: number;
  endMs: number;
  targetMs: number;
  baseUrl: string;
  token: string;
  requirePhone: boolean;
}): { candidate: RecordingCandidate | null; diag: Pick<RecordingFetchDiag, 'phoneHits' | 'extHits' | 'withRecording'> } {
  const diag = { phoneHits: 0, extHits: 0, withRecording: 0 };
  const candidates: RecordingCandidate[] = [];

  for (const row of input.rows) {
    const anchorMs = parseRowStartMs(row);
    if (anchorMs == null) continue;
    if (anchorMs < input.startMs || anchorMs > input.endMs) continue;

    const phoneOk = rowContainsPhone(row, input.phone);
    if (phoneOk) diag.phoneHits += 1;
    if (input.requirePhone && !phoneOk) continue;
    if (!historyExtensionMatches(row, input.extension)) continue;
    diag.extHits += 1;

    const recordingUrl = recordingUrlFromRow(row, input.baseUrl, input.token);
    if (!recordingUrl) continue;
    diag.withRecording += 1;

    candidates.push({
      recordingUrl,
      durationSeconds: parseDurationSecondsFromText(
        pickString(row, ['TalkingDuration', 'Duration', 'TalkingTime', 'DurationSeconds', 'Length']),
      ),
      callId: callIdFromHistoryRow(row, `api-${anchorMs}`),
      anchorMs,
      extension: extensionsFromHistory(row)[0] || input.extension,
      source: input.requirePhone ? 'threecx_api' : 'threecx_api_ext_time',
    });
  }

  return { candidate: pickClosest(candidates, input.targetMs), diag };
}

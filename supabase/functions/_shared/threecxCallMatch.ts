import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

export function phonesMatch(a: string, b: string): boolean {
  const da = digitsOnly(a);
  const db = digitsOnly(b);
  if (!da || !db) return false;
  if (da.length >= 10 && db.length >= 10) return da.slice(-10) === db.slice(-10);
  return da === db;
}

export function parseDurationSecondsFromText(raw: string): number | null {
  const text = String(raw || '').trim();
  if (!text) return null;
  const parts = text.split(':').map((p) => Number(p));
  if (parts.some((p) => !Number.isFinite(p))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  const asNum = Number(text);
  return Number.isFinite(asNum) && asNum > 0 ? Math.round(asNum) : null;
}

export async function resolveRecruiterUserIds(
  admin: SupabaseClient,
  extension: string,
  email: string,
): Promise<string[]> {
  const ids = new Set<string>();
  const ext = extension.trim();
  const normalizedEmail = email.trim().toLowerCase();

  if (ext) {
    const { data: settings } = await admin.from('pipeline_user_call_settings').select('user_id').eq('extension', ext);
    for (const row of settings || []) {
      if (row.user_id) ids.add(String(row.user_id));
    }
    const { data: profiles } = await admin.from('user_profiles').select('user_id').eq('extension', ext);
    for (const row of profiles || []) {
      if (row.user_id) ids.add(String(row.user_id));
    }
  }

  if (normalizedEmail) {
    const { data: byEmail } = await admin.from('user_profiles').select('user_id').ilike('email', normalizedEmail);
    for (const row of byEmail || []) {
      if (row.user_id) ids.add(String(row.user_id));
    }
  }

  return [...ids];
}

type CallRecordRow = {
  id: string;
  dialed_number: string;
  recruiter_user_id: string | null;
  disposed_at: string;
  recording_url?: string | null;
  threecx_metadata: Record<string, unknown> | null;
};

/** Max gap between call end (webhook) and disposition saved time. */
const MAX_PHONE_TIME_DELTA_MS = 35 * 60 * 1000;
const LIVE_MATCH_WINDOW = { beforeMs: 8 * 60 * 1000, afterMs: 25 * 60 * 1000 };
const REPLAY_MATCH_WINDOW = { beforeMs: 10 * 60 * 1000, afterMs: 40 * 60 * 1000 };

function phoneLast10(phoneNumber: string): string {
  const digits = digitsOnly(phoneNumber);
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function rowHasRecording(row: CallRecordRow): boolean {
  if (String(row.recording_url || '').trim()) return true;
  const meta = row.threecx_metadata && typeof row.threecx_metadata === 'object'
    ? row.threecx_metadata as Record<string, unknown>
    : {};
  return Boolean(String(meta.recording_url || '').trim());
}

/** Match disposition rows by dialed_number + disposed_at near call end — no extension/recruiter guessing. */
async function findDispositionByPhoneAndTime(
  admin: SupabaseClient,
  input: {
    phoneNumber: string;
    anchorMs: number;
    onlyWithoutRecording: boolean;
    window: { beforeMs: number; afterMs: number };
  },
): Promise<CallRecordRow[]> {
  const last10 = phoneLast10(input.phoneNumber);
  if (last10.length < 10) return [];

  const windowStart = new Date(input.anchorMs - input.window.beforeMs).toISOString();
  const windowEnd = new Date(input.anchorMs + input.window.afterMs).toISOString();

  const { data: rows, error } = await admin
    .from('pipeline_call_records')
    .select('id, dialed_number, recruiter_user_id, disposed_at, recording_url, threecx_metadata, threecx_call_id')
    .gte('disposed_at', windowStart)
    .lte('disposed_at', windowEnd)
    .or(`dialed_number.ilike.%${last10},dialed_number.eq.${last10},dialed_number.eq.1${last10},dialed_number.eq.+1${last10}`)
    .order('disposed_at', { ascending: false })
    .limit(25);

  if (error) throw error;

  return (rows || []).filter((row: CallRecordRow) => {
    if (input.onlyWithoutRecording && rowHasRecording(row)) return false;
    if (!phonesMatch(input.phoneNumber, String(row.dialed_number || ''))) return false;
    const disposedMs = new Date(row.disposed_at).getTime();
    if (Number.isNaN(disposedMs)) return false;
    return Math.abs(disposedMs - input.anchorMs) <= MAX_PHONE_TIME_DELTA_MS;
  });
}

function pickClosestByTime(candidates: CallRecordRow[], anchorMs: number): CallRecordRow | null {
  if (!candidates.length) return null;
  const afterHangup = candidates.filter((row) => new Date(row.disposed_at).getTime() >= anchorMs - 60_000);
  const pool = afterHangup.length ? afterHangup : candidates;
  return pool.reduce((prev, curr) => {
    const prevDelta = Math.abs(new Date(prev.disposed_at).getTime() - anchorMs);
    const currDelta = Math.abs(new Date(curr.disposed_at).getTime() - anchorMs);
    return currDelta < prevDelta ? curr : prev;
  });
}

export async function attachRecordingToCallRecord(
  admin: SupabaseClient,
  input: {
    phoneNumber: string;
    agentExtension: string;
    agentEmail: string;
    recordingUrl: string | null;
    callId: string | null;
    durationSeconds: number | null;
    anchorIso: string;
    reportMeta?: Record<string, unknown>;
    replayMode?: boolean;
  },
): Promise<{ matched: boolean; callRecordId?: string; reason?: string }> {
  const anchorMs = new Date(input.anchorIso).getTime();
  if (Number.isNaN(anchorMs)) {
    return { matched: false, reason: 'invalid_anchor_time' };
  }

  const phone = String(input.phoneNumber || '').trim();
  if (phoneLast10(phone).length < 10) {
    return { matched: false, reason: 'missing_phone_number' };
  }

  const window = input.replayMode ? REPLAY_MATCH_WINDOW : LIVE_MATCH_WINDOW;
  const candidates = await findDispositionByPhoneAndTime(admin, {
    phoneNumber: phone,
    anchorMs,
    onlyWithoutRecording: Boolean(input.replayMode),
    window,
  });

  if (!candidates.length) {
    return { matched: false, reason: 'no_phone_time_match' };
  }

  const best = pickClosestByTime(candidates, anchorMs);
  if (!best) return { matched: false, reason: 'no_phone_time_match' };

  const existingMeta =
    best.threecx_metadata && typeof best.threecx_metadata === 'object'
      ? best.threecx_metadata
      : {};

  const patch: Record<string, unknown> = {
    threecx_metadata: {
      ...existingMeta,
      threecx_call_id: input.callId,
      recording_url: input.recordingUrl || existingMeta.recording_url || null,
      duration_seconds: input.durationSeconds,
      match_phone: phoneLast10(phone),
      match_anchor: input.anchorIso,
      threecx_report: {
        ...(input.reportMeta || {}),
        received_at: new Date().toISOString(),
        match_method: 'phone_and_time',
      },
    },
  };
  if (input.recordingUrl) patch.recording_url = input.recordingUrl;
  if (input.callId) patch.threecx_call_id = input.callId;
  if (input.durationSeconds != null) patch.duration_seconds = input.durationSeconds;

  const { error: updateError } = await admin.from('pipeline_call_records').update(patch).eq('id', best.id);
  if (updateError) throw updateError;

  return { matched: true, callRecordId: best.id };
}

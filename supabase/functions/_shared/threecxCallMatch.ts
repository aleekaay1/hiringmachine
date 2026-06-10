import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { RECRUITER_3CX_EXTENSIONS } from './recruiter3cxExtensions.ts';

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

export function phonesMatch(a: string, b: string): boolean {
  const da = digitsOnly(a);
  const db = digitsOnly(b);
  if (!da || !db) return false;
  if (da === db) return true;
  if (da.length >= 10 && db.length >= 10) return da.slice(-10) === db.slice(-10);
  return da.endsWith(db) || db.endsWith(da);
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

  // Hardcoded extension map fallback (Call log → Sync extensions).
  if (!ids.size && ext) {
    const emails = RECRUITER_3CX_EXTENSIONS
      .filter((row) => row.extension.trim() === ext)
      .map((row) => row.email.trim().toLowerCase())
      .filter(Boolean);
    for (const mappedEmail of emails) {
      const { data: byMapped } = await admin.from('user_profiles').select('user_id').ilike('email', mappedEmail);
      for (const row of byMapped || []) {
        if (row.user_id) ids.add(String(row.user_id));
      }
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

type MatchWindow = {
  beforeMs: number;
  afterMs: number;
};

const LIVE_MATCH_WINDOW: MatchWindow = { beforeMs: 90 * 60 * 1000, afterMs: 15 * 60 * 1000 };
/** Dispositions are often saved 30s–5m after hangup; allow a long forward window on replay. */
const REPLAY_MATCH_WINDOW: MatchWindow = { beforeMs: 45 * 60 * 1000, afterMs: 6 * 60 * 60 * 1000 };

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

/** SQL phone filter — avoids scanning only the newest 120 rows in a busy window. */
async function findCallRecordsByPhone(
  admin: SupabaseClient,
  input: {
    phoneNumber: string;
    anchorMs: number;
    recruiterIds: string[];
    allowAnyRecruiter: boolean;
    onlyWithoutRecording: boolean;
    window: MatchWindow;
  },
): Promise<CallRecordRow[]> {
  const last10 = phoneLast10(input.phoneNumber);
  if (last10.length < 10) return [];

  const windowStart = new Date(input.anchorMs - input.window.beforeMs).toISOString();
  const windowEnd = new Date(input.anchorMs + input.window.afterMs).toISOString();

  let query = admin
    .from('pipeline_call_records')
    .select('id, dialed_number, recruiter_user_id, disposed_at, recording_url, threecx_metadata, threecx_call_id')
    .gte('disposed_at', windowStart)
    .lte('disposed_at', windowEnd)
    .or(`dialed_number.ilike.%${last10},dialed_number.eq.${last10},dialed_number.eq.1${last10},dialed_number.eq.+1${last10}`)
    .order('disposed_at', { ascending: false })
    .limit(40);

  if (!input.allowAnyRecruiter) {
    if (input.recruiterIds.length === 1) {
      query = query.eq('recruiter_user_id', input.recruiterIds[0]);
    } else if (input.recruiterIds.length > 1) {
      query = query.in('recruiter_user_id', input.recruiterIds);
    }
  }

  const { data: rows, error } = await query;
  if (error) throw error;

  return (rows || []).filter((row: CallRecordRow) => {
    if (input.onlyWithoutRecording && rowHasRecording(row)) return false;
    return phonesMatch(input.phoneNumber, String(row.dialed_number || ''));
  });
}

async function findCallRecordCandidates(
  admin: SupabaseClient,
  input: {
    phoneNumber: string;
    anchorMs: number;
    recruiterIds: string[];
    allowAnyRecruiter: boolean;
    onlyWithoutRecording: boolean;
    window: MatchWindow;
  },
): Promise<CallRecordRow[]> {
  const windowStart = new Date(input.anchorMs - input.window.beforeMs).toISOString();
  const windowEnd = new Date(input.anchorMs + input.window.afterMs).toISOString();

  let query = admin
    .from('pipeline_call_records')
    .select('id, dialed_number, recruiter_user_id, disposed_at, recording_url, threecx_metadata, threecx_call_id')
    .gte('disposed_at', windowStart)
    .lte('disposed_at', windowEnd)
    .order('disposed_at', { ascending: false })
    .limit(300);

  if (!input.allowAnyRecruiter) {
    if (input.recruiterIds.length === 1) {
      query = query.eq('recruiter_user_id', input.recruiterIds[0]);
    } else if (input.recruiterIds.length > 1) {
      query = query.in('recruiter_user_id', input.recruiterIds);
    }
  }

  const { data: rows, error } = await query;
  if (error) throw error;

  return (rows || []).filter((row: CallRecordRow) => {
    if (input.onlyWithoutRecording && rowHasRecording(row)) return false;
    if (input.phoneNumber && phonesMatch(input.phoneNumber, String(row.dialed_number || ''))) {
      return true;
    }
    return false;
  });
}

async function findByExtensionAndTime(
  admin: SupabaseClient,
  input: {
    anchorMs: number;
    recruiterIds: string[];
    allowAnyRecruiter: boolean;
    window: MatchWindow;
  },
): Promise<CallRecordRow[]> {
  const windowStart = new Date(input.anchorMs - input.window.beforeMs).toISOString();
  const windowEnd = new Date(input.anchorMs + input.window.afterMs).toISOString();

  let query = admin
    .from('pipeline_call_records')
    .select('id, dialed_number, recruiter_user_id, disposed_at, recording_url, threecx_metadata, threecx_call_id')
    .gte('disposed_at', windowStart)
    .lte('disposed_at', windowEnd)
    .is('recording_url', null)
    .order('disposed_at', { ascending: false })
    .limit(30);

  if (!input.allowAnyRecruiter) {
    if (!input.recruiterIds.length) return [];
    if (input.recruiterIds.length === 1) {
      query = query.eq('recruiter_user_id', input.recruiterIds[0]);
    } else {
      query = query.in('recruiter_user_id', input.recruiterIds);
    }
  }

  const { data: rows, error } = await query;
  if (error) throw error;
  return (rows || []).filter((row: CallRecordRow) => !rowHasRecording(row));
}

async function pickBestCandidate(
  candidates: CallRecordRow[],
  anchorMs: number,
  preferDispositionAfterHangup = false,
): Promise<CallRecordRow | null> {
  if (!candidates.length) return null;
  let pool = candidates;
  if (preferDispositionAfterHangup) {
    const after = candidates.filter((row) => new Date(row.disposed_at).getTime() >= anchorMs);
    if (after.length) pool = after;
  }
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
  const recruiterIds = await resolveRecruiterUserIds(admin, input.agentExtension, input.agentEmail);
  const anchorMs = new Date(input.anchorIso).getTime();
  if (Number.isNaN(anchorMs)) {
    return { matched: false, reason: 'invalid_anchor_time' };
  }

  const window = input.replayMode ? REPLAY_MATCH_WINDOW : LIVE_MATCH_WINDOW;
  const phone = String(input.phoneNumber || '').trim();
  const onlyWithoutRecording = Boolean(input.replayMode);
  const preferAfter = Boolean(input.replayMode);

  let candidates: CallRecordRow[] = [];

  if (phone) {
    // Phone-first: match any recruiter (portal user may differ from 3CX extension).
    candidates = await findCallRecordsByPhone(admin, {
      phoneNumber: phone,
      anchorMs,
      recruiterIds,
      allowAnyRecruiter: true,
      onlyWithoutRecording,
      window,
    });
    if (!candidates.length) {
      candidates = await findCallRecordsByPhone(admin, {
        phoneNumber: phone,
        anchorMs,
        recruiterIds,
        allowAnyRecruiter: false,
        onlyWithoutRecording,
        window,
      });
    }
  }

  if (!candidates.length) {
    candidates = await findCallRecordCandidates(admin, {
      phoneNumber: phone,
      anchorMs,
      recruiterIds,
      allowAnyRecruiter: true,
      onlyWithoutRecording,
      window,
    });
  }
  if (!candidates.length) {
    candidates = await findCallRecordCandidates(admin, {
      phoneNumber: phone,
      anchorMs,
      recruiterIds,
      allowAnyRecruiter: false,
      onlyWithoutRecording,
      window,
    });
  }

  // Replay: closest disposition without recording when phone is missing or mismatched.
  if (!candidates.length && input.replayMode) {
    const byTime = await findByExtensionAndTime(admin, {
      anchorMs,
      recruiterIds,
      allowAnyRecruiter: false,
      window,
    });
    let best = await pickBestCandidate(byTime, anchorMs, preferAfter);
    if (!best) {
      const anyRecruiter = await findByExtensionAndTime(admin, {
        anchorMs,
        recruiterIds,
        allowAnyRecruiter: true,
        window,
      });
      best = await pickBestCandidate(anyRecruiter, anchorMs, preferAfter);
    }
    if (best) candidates = [best];
  }

  if (!candidates.length) {
    return { matched: false, reason: 'no_call_record_match' };
  }

  const best = await pickBestCandidate(candidates, anchorMs, preferAfter);
  if (!best) return { matched: false, reason: 'no_call_record_match' };

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
      threecx_report: {
        ...(input.reportMeta || {}),
        received_at: new Date().toISOString(),
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

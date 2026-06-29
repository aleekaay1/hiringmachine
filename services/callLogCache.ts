import type { PipelineCallRecord, PipelineCandidate } from './pipelineService';
import type { UserProfile } from './accessControl';
import type { CallLogPageQuery } from './callLogQuery';

const CACHE_KEY = 'paz_call_log_v2';

export type CallLogCachePayload = {
  savedAt: string;
  query: CallLogPageQuery;
  rows: PipelineCallRecord[];
  candidates: PipelineCandidate[];
  staffProfiles: UserProfile[];
  hasMore: boolean;
  nextOffset: number;
};

export function readCallLogCache(): CallLogCachePayload | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CallLogCachePayload;
    if (!parsed?.savedAt || !Array.isArray(parsed.rows) || !parsed.query?.fromYmd) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeCallLogCache(payload: Omit<CallLogCachePayload, 'savedAt'>): void {
  try {
    const next: CallLogCachePayload = {
      ...payload,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(next));
  } catch {
    /* quota or private mode */
  }
}

export function formatCallLogCacheAge(savedAt: string): string {
  const ms = Date.now() - Date.parse(savedAt);
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

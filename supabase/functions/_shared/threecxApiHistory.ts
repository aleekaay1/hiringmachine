/**
 * 3CX XAPI call history + recordings — on-demand fetch only (filtered by time window).
 * Requires API integration: Department DEFAULT, Role System Owner (not System Admin).
 */

import { parseRowStartMs } from './threecxHistoryParse.ts';

export type ThreeCxHistoryRow = Record<string, unknown>;

export type ThreeCxApiProbe = {
  ok: boolean;
  endpoint: string | null;
  status: number | null;
  error: string | null;
  setupHint: string | null;
};

const SETUP_HINT = 'In 3CX Admin → Integrations → API: Department DEFAULT, Role System Owner. '
  + 'Regenerate API key → update Supabase secrets THREECX_BASE_URL, THREECX_CLIENT_ID, THREECX_CLIENT_SECRET. '
  + 'Check Admin → Security for IP restrictions (can downgrade token to user role → 403).';

const HISTORY_TOP = 1000;

function encodeODataDate(iso: string): string {
  return encodeURIComponent(iso.replace(/\.\d{3}Z$/, 'Z'));
}

export function torontoDateKey(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

export function torontoDayBoundsFromMs(ms: number): { fromIso: string; toIso: string; dateKey: string } {
  const dateKey = torontoDateKey(new Date(ms).toISOString());
  return {
    dateKey,
    fromIso: `${dateKey}T00:00:00.000-04:00`,
    toIso: `${dateKey}T23:59:59.999-04:00`,
  };
}

function historyPathsForWindow(fromIso: string, toIso: string): string[] {
  const from = encodeODataDate(fromIso);
  const to = encodeODataDate(toIso);
  const day = encodeURIComponent(torontoDateKey(fromIso));
  const top = `$top=${HISTORY_TOP}`;
  return [
    `/xapi/v1/CallHistoryView?$filter=date(SegmentStartTime)%20eq%20${day}&${top}&$orderby=SegmentStartTime%20desc`,
    `/xapi/v1/CallLogView?$filter=date(SegmentStartTime)%20eq%20${day}&${top}&$orderby=SegmentStartTime%20desc`,
    `/xapi/v1/ReportCallLogData/Pbx.GetCallLogData(from=${from},to=${to})?${top}&$orderby=SegmentStartTime%20desc`,
    `/xapi/v1/CallHistoryView?$filter=SegmentStartTime%20ge%20${from}%20and%20SegmentStartTime%20le%20${to}&${top}&$orderby=SegmentStartTime%20desc`,
    `/xapi/v1/CallLogView?$filter=SegmentStartTime%20ge%20${from}%20and%20SegmentStartTime%20le%20${to}&${top}&$orderby=SegmentStartTime%20desc`,
    `/xapi/v1/CallHistoryView?${top}&$orderby=SegmentStartTime%20desc`,
  ];
}

function recordingPathsForWindow(fromIso: string): string[] {
  const day = encodeURIComponent(torontoDateKey(fromIso));
  const top = `$top=${HISTORY_TOP}`;
  return [
    `/xapi/v1/Recordings?$filter=date(StartTime)%20eq%20${day}&${top}&$orderby=StartTime%20desc`,
    `/xapi/v1/Recordings?$filter=date(RecordingStartTime)%20eq%20${day}&${top}&$orderby=RecordingStartTime%20desc`,
    `/xapi/v1/Recordings?${top}&$orderby=StartTime%20desc`,
  ];
}

function filterRowsToWindow(
  rows: ThreeCxHistoryRow[],
  fromIso: string,
  toIso: string,
): ThreeCxHistoryRow[] {
  const fromMs = new Date(fromIso).getTime();
  const toMs = new Date(toIso).getTime();
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return rows;
  return rows.filter((row) => {
    const ms = parseRowStartMs(row);
    if (ms == null) return true;
    return ms >= fromMs && ms <= toMs;
  });
}

async function fetchODataPath(
  token: string,
  baseUrl: string,
  path: string,
): Promise<ThreeCxHistoryRow[] | null> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const raw = await res.text();
  if (!res.ok) {
    if (res.status === 403) {
      throw new Error(`3CX call history forbidden (403). ${SETUP_HINT}`);
    }
    return null;
  }
  const parsed = JSON.parse(raw) as { value?: ThreeCxHistoryRow[] };
  return parsed.value || [];
}

export async function probeThreeCxHistoryAccess(
  token: string,
  baseUrl: string,
): Promise<ThreeCxApiProbe> {
  const paths = historyPathsForWindow(
    new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    new Date().toISOString(),
  );
  const errors: string[] = [];
  for (const path of paths) {
    const res = await fetch(`${baseUrl}${path.replace(`$top=${HISTORY_TOP}`, '$top=1')}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (res.ok) {
      return { ok: true, endpoint: path.split('?')[0], status: res.status, error: null, setupHint: null };
    }
    errors.push(`${path.split('?')[0]} → ${res.status}`);
    if (res.status === 403) {
      return {
        ok: false,
        endpoint: null,
        status: 403,
        error: 'Call history API forbidden (403).',
        setupHint: SETUP_HINT,
      };
    }
  }
  return {
    ok: false,
    endpoint: null,
    status: null,
    error: errors.join('; ') || 'No call history endpoint responded OK.',
    setupHint: SETUP_HINT,
  };
}

export async function fetchThreeCxCallHistory(
  token: string,
  baseUrl: string,
): Promise<{ rows: ThreeCxHistoryRow[]; endpoint: string }> {
  const to = new Date().toISOString();
  const from = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  return fetchThreeCxCallHistoryForWindow(token, baseUrl, from, to);
}

export async function fetchThreeCxCallHistoryForWindow(
  token: string,
  baseUrl: string,
  fromIso: string,
  toIso: string,
): Promise<{ rows: ThreeCxHistoryRow[]; endpoint: string }> {
  const errors: string[] = [];
  for (const path of historyPathsForWindow(fromIso, toIso)) {
    const rows = await fetchODataPath(token, baseUrl, path);
    if (rows == null) {
      errors.push(`${path.split('?')[0]} → failed`);
      continue;
    }
    const filtered = filterRowsToWindow(rows, fromIso, toIso);
    const result = filtered.length ? filtered : rows;
    if (!result.length) continue;
    return { rows: result, endpoint: path.split('?')[0] };
  }
  throw new Error(`3CX call history unavailable: ${errors.join('; ')}. ${SETUP_HINT}`);
}

export async function fetchThreeCxRecordingsForWindow(
  token: string,
  baseUrl: string,
  fromIso: string,
  toIso: string,
): Promise<{ rows: ThreeCxHistoryRow[]; endpoint: string | null }> {
  for (const path of recordingPathsForWindow(fromIso)) {
    const rows = await fetchODataPath(token, baseUrl, path);
    if (rows == null || !rows.length) continue;
    const filtered = filterRowsToWindow(rows, fromIso, toIso);
    return { rows: filtered.length ? filtered : rows, endpoint: path.split('?')[0] };
  }
  return { rows: [], endpoint: null };
}

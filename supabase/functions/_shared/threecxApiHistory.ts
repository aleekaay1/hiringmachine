/**
 * 3CX XAPI call history + recordings — on-demand fetch only (filtered by time window).
 * Requires API integration: Department DEFAULT, Role System Owner (not System Admin).
 */

import { historyExtensionMatches, parseRowStartMs } from './threecxHistoryParse.ts';

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

export function torontoDayUtcPeriod(ms: number): { periodFrom: string; periodTo: string; dateKey: string } {
  const { dateKey, fromIso, toIso } = torontoDayBoundsFromMs(ms);
  return {
    dateKey,
    periodFrom: new Date(fromIso).toISOString(),
    periodTo: new Date(toIso).toISOString(),
  };
}

function odataQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** 3CX expects %3A in periodFrom/periodTo inside the function URL path. */
function encodePeriodParam(iso: string): string {
  return iso.replace(/:/g, '%3A');
}

export type GetCallLogDataQuery = {
  periodFrom: string;
  periodTo: string;
  sourceType: number;
  sourceFilter: string;
  destinationType: number;
  destinationFilter: string;
  callsType?: number;
};

export type ODataFetchResult = {
  rows: ThreeCxHistoryRow[];
  status: number;
  error: string | null;
};

function buildGetCallLogDataPath(query: GetCallLogDataQuery, top = HISTORY_TOP): string {
  const params = [
    `periodFrom=${encodePeriodParam(query.periodFrom)}`,
    `periodTo=${encodePeriodParam(query.periodTo)}`,
    `sourceType=${query.sourceType}`,
    `sourceFilter=${query.sourceFilter ? odataQuote(query.sourceFilter) : "''"}`,
    `destinationType=${query.destinationType}`,
    `destinationFilter=${query.destinationFilter ? odataQuote(query.destinationFilter) : "''"}`,
    `callsType=${query.callsType ?? 1}`,
    'callTimeFilterType=0',
    "callTimeFilterFrom='0:00:0'",
    "callTimeFilterTo='0:00:0'",
    'hidePcalls=true',
  ].join(',');
  return `/xapi/v1/ReportCallLogData/Pbx.GetCallLogData(${params})?$top=${top}&$orderby=SegmentStartTime%20desc`;
}

/** Try several URL shapes — 3CX builds vary on period format and callsType. */
function getCallLogProbePaths(periodFrom: string, periodTo: string): string[] {
  const pfMs = encodePeriodParam(periodFrom);
  const ptMs = encodePeriodParam(periodTo);
  const pf = encodePeriodParam(periodFrom.replace(/\.\d{3}Z$/, 'Z'));
  const pt = encodePeriodParam(periodTo.replace(/\.\d{3}Z$/, 'Z'));
  const fromEnc = encodeODataDate(periodFrom);
  const toEnc = encodeODataDate(periodTo);
  const mk = (
    pFrom: string,
    pTo: string,
    callsType: number,
    timeFrom: string,
    timeTo: string,
  ) => `/xapi/v1/ReportCallLogData/Pbx.GetCallLogData(periodFrom=${pFrom},periodTo=${pTo},sourceType=0,sourceFilter='',destinationType=0,destinationFilter='',callsType=${callsType},callTimeFilterType=0,callTimeFilterFrom=${timeFrom},callTimeFilterTo=${timeTo},hidePcalls=true)?$top=${HISTORY_TOP}&$orderby=SegmentStartTime%20desc`;

  return [
    mk(pfMs, ptMs, 1, "'0:00:0'", "'0:00:0'"),
    mk(pf, pt, 1, "'0:00:0'", "'0:00:0'"),
    mk(pfMs, ptMs, 1, "''", "''"),
    mk(pfMs, ptMs, 0, "'0:00:0'", "'0:00:0'"),
    `/xapi/v1/ReportCallLogData/Pbx.GetCallLogData(from=${fromEnc},to=${toEnc})?$top=${HISTORY_TOP}&$orderby=SegmentStartTime%20desc`,
  ];
}

function formatAttempt(result: ODataFetchResult, label: string): string {
  const err = result.error ? ` ${result.error.replace(/\s+/g, ' ').slice(0, 80)}` : '';
  return `${label} → ${result.status} (${result.rows.length} rows)${err}`;
}

/** Load report call log for the day, then filter client-side by extension/phone. */
export async function fetchThreeCxCallLogData(
  token: string,
  baseUrl: string,
  periodFrom: string,
  periodTo: string,
  extension: string,
  _phone: string,
): Promise<{ rows: ThreeCxHistoryRow[]; endpoint: string; attempts: string[] }> {
  const attempts: string[] = [];
  let allRows: ThreeCxHistoryRow[] = [];

  for (const path of getCallLogProbePaths(periodFrom, periodTo)) {
    const result = await fetchODataPathDetailed(token, baseUrl, path);
    attempts.push(formatAttempt(result, 'probe'));
    if (result.status === 200 && result.rows.length) {
      allRows = result.rows;
      break;
    }
  }

  if (!allRows.length) {
    return { rows: [], endpoint: '/xapi/v1/ReportCallLogData/Pbx.GetCallLogData', attempts };
  }

  const extRows = allRows.filter((row) => historyExtensionMatches(row, extension));
  attempts.push(`client ext ${extension} filter → ${extRows.length} of ${allRows.length} rows`);
  return {
    rows: extRows.length ? extRows : allRows,
    endpoint: '/xapi/v1/ReportCallLogData/Pbx.GetCallLogData',
    attempts,
  };
}

export function callHistoryPathsForExtensionDay(day: string, extension: string): string[] {
  const top = `$top=${HISTORY_TOP}`;
  const ext = encodeURIComponent(odataQuote(extension));
  const dayEnc = encodeURIComponent(day);
  return [
    `/xapi/v1/CallHistoryView?$filter=date(SegmentStartTime)%20eq%20${dayEnc}%20and%20SrcDn%20eq%20${ext}&${top}&$orderby=SegmentStartTime%20desc`,
    `/xapi/v1/CallHistoryView?$filter=date(SegmentStartTime)%20eq%20${dayEnc}%20and%20DstDn%20eq%20${ext}&${top}&$orderby=SegmentStartTime%20desc`,
    `/xapi/v1/CallHistoryView?$filter=date(SegmentStartTime)%20eq%20${dayEnc}%20and%20(SrcDn%20eq%20${ext}%20or%20DstDn%20eq%20${ext})&${top}&$orderby=SegmentStartTime%20desc`,
  ];
}

export async function fetchCallHistoryForExtensionDay(
  token: string,
  baseUrl: string,
  day: string,
  extension: string,
): Promise<{ rows: ThreeCxHistoryRow[]; endpoint: string | null }> {
  for (const path of callHistoryPathsForExtensionDay(day, extension)) {
    const result = await fetchODataPathDetailed(token, baseUrl, path);
    if (result.rows.length) {
      return { rows: result.rows, endpoint: path.split('?')[0] };
    }
  }
  return { rows: [], endpoint: null };
}

const MAX_HISTORY_PAGES = 8;

/** Paginate CallHistoryView for a full Toronto day (up to 8000 segments). */
export async function fetchCallHistoryPaginatedForDay(
  token: string,
  baseUrl: string,
  day: string,
): Promise<{ rows: ThreeCxHistoryRow[]; pages: number; endpoint: string }> {
  const dayEnc = encodeURIComponent(day);
  const merged: ThreeCxHistoryRow[] = [];
  let pages = 0;

  for (let page = 0; page < MAX_HISTORY_PAGES; page += 1) {
    const skip = page * HISTORY_TOP;
    const path = `/xapi/v1/CallHistoryView?$filter=date(SegmentStartTime)%20eq%20${dayEnc}&$top=${HISTORY_TOP}&$skip=${skip}&$orderby=SegmentStartTime%20desc`;
    const result = await fetchODataPathDetailed(token, baseUrl, path);
    if (result.status !== 200 || !result.rows.length) break;
    pages += 1;
    merged.push(...result.rows);
    if (result.rows.length < HISTORY_TOP) break;
  }

  return { rows: merged, pages, endpoint: '/xapi/v1/CallHistoryView' };
}

export function filterRowsForExtension(
  rows: ThreeCxHistoryRow[],
  extension: string,
): ThreeCxHistoryRow[] {
  return rows.filter((row) => historyExtensionMatches(row, extension));
}

export function sampleExternalNumbers(rows: ThreeCxHistoryRow[], limit = 8): string[] {
  const out: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      const v = row[key];
      if (typeof v !== 'string' && typeof v !== 'number') continue;
      const s = String(v).trim();
      const d = s.replace(/\D/g, '');
      if (d.length >= 10 && !out.includes(s)) out.push(s);
      if (out.length >= limit) return out;
    }
  }
  return out;
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

async function fetchODataPathDetailed(
  token: string,
  baseUrl: string,
  path: string,
): Promise<ODataFetchResult> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const raw = await res.text();
  if (!res.ok) {
    if (res.status === 403) {
      throw new Error(`3CX call history forbidden (403). ${SETUP_HINT}`);
    }
    return { rows: [], status: res.status, error: raw.slice(0, 200) || res.statusText };
  }
  try {
    const parsed = JSON.parse(raw) as { value?: ThreeCxHistoryRow[] };
    return { rows: parsed.value || [], status: res.status, error: null };
  } catch {
    return { rows: [], status: res.status, error: 'Invalid JSON from 3CX' };
  }
}

async function fetchODataPath(
  token: string,
  baseUrl: string,
  path: string,
): Promise<ThreeCxHistoryRow[] | null> {
  const result = await fetchODataPathDetailed(token, baseUrl, path);
  if (result.status === 403) {
    throw new Error(`3CX call history forbidden (403). ${SETUP_HINT}`);
  }
  if (!result.rows.length && result.status !== 200) return null;
  return result.rows;
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

/**
 * 3CX XAPI call history + recordings — on-demand fetch only (filtered by time window).
 * Requires API integration: Department DEFAULT, Role System Owner (not System Admin).
 */

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

function encodeODataDate(iso: string): string {
  return encodeURIComponent(iso.replace(/\.\d{3}Z$/, 'Z'));
}

function historyPathsForWindow(fromIso: string, toIso: string): string[] {
  const from = encodeODataDate(fromIso);
  const to = encodeODataDate(toIso);
  return [
    `/xapi/v1/ReportCallLogData/Pbx.GetCallLogData(from=${from},to=${to})?$top=250&$orderby=SegmentStartTime%20desc`,
    `/xapi/v1/CallHistoryView?$filter=SegmentStartTime%20ge%20${from}%20and%20SegmentStartTime%20le%20${to}&$top=250&$orderby=SegmentStartTime%20desc`,
    `/xapi/v1/CallLogView?$filter=SegmentStartTime%20ge%20${from}%20and%20SegmentStartTime%20le%20${to}&$top=250&$orderby=SegmentStartTime%20desc`,
    `/xapi/v1/CallHistoryView?$top=250&$orderby=SegmentStartTime%20desc`,
    `/xapi/v1/ReportCallLogData?$top=250&$orderby=SegmentStartTime%20desc`,
    `/xapi/v1/CallLogView?$top=250&$orderby=SegmentStartTime%20desc`,
  ];
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
    const res = await fetch(`${baseUrl}${path.replace('$top=250', '$top=1')}`, {
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
    const res = await fetch(`${baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    const raw = await res.text();
    if (!res.ok) {
      errors.push(`${path.split('?')[0]} → ${res.status}`);
      if (res.status === 403) {
        throw new Error(`3CX call history forbidden (403). ${SETUP_HINT}`);
      }
      continue;
    }
    const parsed = JSON.parse(raw) as { value?: ThreeCxHistoryRow[] };
    return { rows: parsed.value || [], endpoint: path.split('?')[0] };
  }
  throw new Error(`3CX call history unavailable: ${errors.join('; ')}. ${SETUP_HINT}`);
}

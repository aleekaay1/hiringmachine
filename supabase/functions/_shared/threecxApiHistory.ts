/**
 * Fetch call history / recordings from 3CX XAPI — tries multiple entity names (version-dependent).
 */

export type ThreeCxHistoryRow = Record<string, unknown>;

const HISTORY_ENDPOINTS = [
  '/xapi/v1/CallHistoryView?$top=500&$orderby=SegmentStartTime%20desc',
  '/xapi/v1/ReportCallLogData?$top=500&$orderby=SegmentStartTime%20desc',
  '/xapi/v1/CallLogView?$top=500&$orderby=SegmentStartTime%20desc',
];

export async function probeThreeCxHistoryAccess(
  token: string,
  baseUrl: string,
): Promise<{ ok: boolean; endpoint: string | null; error: string | null }> {
  for (const path of HISTORY_ENDPOINTS) {
    const res = await fetch(`${baseUrl}${path.replace('$top=500', '$top=1')}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (res.ok) {
      return { ok: true, endpoint: path.split('?')[0], error: null };
    }
    if (res.status === 403) {
      return { ok: false, endpoint: null, error: null };
    }
  }
  return { ok: false, endpoint: null, error: 'No call history endpoint responded OK.' };
}

export async function fetchThreeCxCallHistory(
  token: string,
  baseUrl: string,
): Promise<{ rows: ThreeCxHistoryRow[]; endpoint: string }> {
  const errors: string[] = [];
  for (const path of HISTORY_ENDPOINTS) {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    const raw = await res.text();
    if (!res.ok) {
      errors.push(`${path.split('?')[0]} → ${res.status}`);
      if (res.status === 403) {
        throw new Error('Call history API not available (optional — webhook sync is used instead).');
      }
      continue;
    }
    const parsed = JSON.parse(raw) as { value?: ThreeCxHistoryRow[] };
    return { rows: parsed.value || [], endpoint: path.split('?')[0] };
  }
  throw new Error(`Call history unavailable: ${errors.join('; ')}`);
}

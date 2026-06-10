import { digitsOnly, phonesMatch } from './threecxCallMatch.ts';

export function pickRowString(row: Record<string, unknown>, keys: string[]): string {
  const lowerMap = new Map<string, unknown>();
  for (const [k, v] of Object.entries(row)) lowerMap.set(k.toLowerCase(), v);

  for (const key of keys) {
    const v = row[key] ?? lowerMap.get(key.toLowerCase());
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return '';
}

export function parseRowStartMs(row: Record<string, unknown>): number | null {
  const startRaw = pickRowString(row, [
    'SegmentStartTime',
    'StartTime',
    'CallStartTimeUTC',
    'CallStartTime',
    'RecordingStartTime',
    'TimeStart',
  ]);
  if (!startRaw) return null;
  const ms = new Date(startRaw).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export function externalNumbersFromHistory(row: Record<string, unknown>): string[] {
  const src = pickRowString(row, [
    'SrcCallerNumber',
    'SourceCallerId',
    'CallerNumber',
    'SrcNumber',
    'Caller',
    'From',
    'Source',
  ]);
  const dst = pickRowString(row, [
    'DstCallerNumber',
    'DestinationCallerId',
    'CalleeNumber',
    'DstNumber',
    'Callee',
    'To',
    'Destination',
  ]);
  const direction = pickRowString(row, ['Direction', 'CallDirection']).toLowerCase();
  const ordered = direction.includes('out')
    ? [dst, src]
    : direction.includes('in')
      ? [src, dst]
      : [dst, src];
  const out: string[] = [];
  for (const n of [...ordered, src, dst]) {
    const trimmed = String(n || '').trim();
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

export function historyPhoneMatches(row: Record<string, unknown>, phone: string): boolean {
  return externalNumbersFromHistory(row).some((n) => phonesMatch(phone, n));
}

export function extensionsFromHistory(row: Record<string, unknown>): string[] {
  const direction = pickRowString(row, ['Direction', 'CallDirection']).toLowerCase();
  const keys = direction.includes('out')
    ? ['SrcDn', 'SrcDN', 'SrcOwnExtension', 'SourceExtension', 'AgentExtension', 'Extension', 'AgentDn', 'Number']
    : direction.includes('in')
      ? ['DstDn', 'DstDN', 'DstOwnExtension', 'DestinationExtension', 'AgentExtension', 'Extension', 'AgentDn', 'Number']
      : ['SrcDn', 'SrcDN', 'DstDn', 'DstDN', 'AgentExtension', 'Extension', 'AgentDn', 'Number'];
  const out: string[] = [];
  for (const key of keys) {
    const v = pickRowString(row, [key]);
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

export function normalizeExtensionDigits(ext: string): string {
  const digits = digitsOnly(String(ext || '').trim());
  if (!digits) return '';
  return digits.length > 4 ? digits.slice(-4) : digits;
}

export function extensionsMatchHistory(a: string, b: string): boolean {
  const ea = normalizeExtensionDigits(a);
  const eb = normalizeExtensionDigits(b);
  return Boolean(ea && eb && ea === eb);
}

export function historyExtensionMatches(row: Record<string, unknown>, extension: string): boolean {
  const target = normalizeExtensionDigits(extension);
  if (!target) return false;
  return extensionsFromHistory(row).some((ext) => extensionsMatchHistory(ext, target));
}

export function recordingIdFromRow(row: Record<string, unknown>): string {
  return pickRowString(row, ['RecId', 'RecordingId', 'recId', 'RecordingID']);
}

export function recordingUrlFromRow(
  row: Record<string, unknown>,
  baseUrl: string,
  token: string,
): string | null {
  const direct = pickRowString(row, ['RecordingUrl', 'recording_url', 'RecordingURL', 'DownloadUrl']);
  if (direct.startsWith('http')) return direct;
  const recId = recordingIdFromRow(row);
  if (!recId) return null;
  return `${baseUrl}/xapi/v1/Recordings/Pbx.DownloadRecording(recId=${encodeURIComponent(recId)})?access_token=${encodeURIComponent(token)}`;
}

export function callIdFromHistoryRow(row: Record<string, unknown>, fallback: string): string {
  return pickRowString(row, ['MainCallHistoryId', 'CallHistoryId', 'SegmentId', 'Id']) || fallback;
}

/**
 * Zoom past-session participant fetch (PMI / recurring meetings).
 * Uses past instance UUIDs + metrics API fallbacks — not the scheduled-meeting UUID from list meetings.
 */

import { DateTime } from 'npm:luxon@3.5.0';

export type ZoomRawMeeting = Record<string, unknown>;

export type ZoomParticipant = {
  name?: string;
  user_email?: string;
  join_time?: string;
  leave_time?: string;
};

export type ZoomParticipantFetchDebug = {
  date_key: string;
  meeting_id_tried: string[];
  instance_uuids_tried: string[];
  paths_attempted: string[];
  participant_count: number;
  source: 'instance_uuid' | 'metrics' | 'hint_uuid' | 'none';
  last_error: string | null;
};

type ZoomGetFn = (token: string, path: string) => Promise<unknown>;

function participantName(row: Record<string, unknown>): string {
  const name = String(row.name ?? '').trim();
  if (name) return name;
  const userName = String(row.user_name ?? '').trim();
  if (userName) return userName;
  return '';
}

function participantEmail(row: Record<string, unknown>): string {
  for (const key of ['user_email', 'email', 'customer_key']) {
    const v = String(row[key] ?? '').trim().toLowerCase();
    if (v && v.includes('@')) return v;
  }
  const name = participantName(row);
  const embedded = name.toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/);
  if (embedded?.[0]) return embedded[0];
  return '';
}

function uuidPathEncodings(uuid: string): string[] {
  const raw = uuid.trim();
  if (!raw) return [];
  const once = encodeURIComponent(raw);
  const twice = encodeURIComponent(encodeURIComponent(raw));
  return once === twice ? [once] : [twice, once];
}

function meetingIdDigits(m: ZoomRawMeeting | string): string {
  if (typeof m === 'string') return m.replace(/\D/g, '');
  return String((m as { id?: string | number }).id ?? '').replace(/\D/g, '');
}

function participantKey(p: ZoomParticipant): string {
  const e = (p.user_email ?? '').trim().toLowerCase();
  if (e) return `e:${e}`;
  return `n:${(p.name ?? '').trim().toLowerCase()}`;
}

export function mergeZoomParticipants(existing: ZoomParticipant[], more: ZoomParticipant[]): ZoomParticipant[] {
  const byKey = new Map<string, ZoomParticipant>();
  for (const p of [...existing, ...more]) {
    const k = participantKey(p);
    if (!k || k === 'n:') continue;
    byKey.set(k, p);
  }
  return [...byKey.values()];
}

export async function zoomParticipantsFromPath(
  zoomApiBase: string,
  token: string,
  path: string,
): Promise<ZoomParticipant[]> {
  const all: ZoomParticipant[] = [];
  let nextPageToken = '';
  let safety = 0;
  do {
    safety++;
    const withToken =
      `${path}${path.includes('?') ? '&' : '?'}page_size=300${nextPageToken ? `&next_page_token=${encodeURIComponent(nextPageToken)}` : ''}`;
    const res = await fetch(`${zoomApiBase}${withToken}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(`Zoom GET ${withToken}: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as {
      participants?: Array<Record<string, unknown>>;
      next_page_token?: string;
    };
    for (const p of body.participants ?? []) {
      all.push({
        name: participantName(p),
        user_email: participantEmail(p),
        join_time: typeof p.join_time === 'string' ? p.join_time : undefined,
        leave_time: typeof p.leave_time === 'string' ? p.leave_time : undefined,
      });
    }
    nextPageToken = String(body.next_page_token ?? '').trim();
  } while (nextPageToken && safety < 20);
  return all;
}

export async function zoomParticipantsForUuid(
  zoomApiBase: string,
  token: string,
  uuid: string,
  pathsAttempted?: string[],
): Promise<ZoomParticipant[]> {
  const encodings = uuidPathEncodings(uuid);
  let merged: ZoomParticipant[] = [];
  let lastErr: unknown = null;
  for (const enc of encodings) {
    for (const suffix of [`/past_meetings/${enc}/participants`, `/report/meetings/${enc}/participants`]) {
      pathsAttempted?.push(suffix);
      try {
        const rows = await zoomParticipantsFromPath(zoomApiBase, token, suffix);
        merged = mergeZoomParticipants(merged, rows);
      } catch (e) {
        lastErr = e;
      }
    }
  }
  if (merged.length === 0 && lastErr) {
    console.warn(
      `[zoom] participants failed for uuid ${uuid}:`,
      lastErr instanceof Error ? lastErr.message : String(lastErr),
    );
  }
  return merged;
}

export async function zoomMetricsPastParticipants(
  zoomApiBase: string,
  token: string,
  meetingId: string,
  dateKey: string,
  pathsAttempted?: string[],
): Promise<ZoomParticipant[]> {
  const id = meetingId.replace(/\D/g, '');
  if (!id || !dateKey) return [];
  const path =
    `/metrics/meetings/${encodeURIComponent(id)}/participants?type=past&from=${encodeURIComponent(dateKey)}&to=${encodeURIComponent(dateKey)}`;
  pathsAttempted?.push(path);
  try {
    const rows = await zoomParticipantsFromPath(zoomApiBase, token, path);
    return rows;
  } catch (e) {
    console.warn(
      `[zoom] metrics participants failed for meeting ${id} on ${dateKey}:`,
      e instanceof Error ? e.message : String(e),
    );
    return [];
  }
}

export async function zoomPastInstancesForMeetingId(
  zoomGet: ZoomGetFn,
  token: string,
  meetingId: string,
): Promise<ZoomRawMeeting[]> {
  const id = meetingId.replace(/\D/g, '');
  if (!id) return [];
  const all: ZoomRawMeeting[] = [];
  let nextPageToken = '';
  let safety = 0;
  const base = `/past_meetings/${encodeURIComponent(id)}/instances`;
  do {
    safety++;
    const qs = `page_size=100${nextPageToken ? `&next_page_token=${encodeURIComponent(nextPageToken)}` : ''}`;
    try {
      const body = (await zoomGet(token, `${base}?${qs}`)) as {
        meetings?: ZoomRawMeeting[];
        next_page_token?: string;
      };
      for (const m of body.meetings ?? []) all.push(m);
      nextPageToken = String(body.next_page_token ?? '').trim();
    } catch (e) {
      console.warn(
        `[zoom] past instances failed for meeting ${id}:`,
        e instanceof Error ? e.message : String(e),
      );
      break;
    }
  } while (nextPageToken && safety < 30);
  return all;
}

export function sortInstancesForDate(
  instances: ZoomRawMeeting[],
  dateKey: string,
  targetMinutes: number | null,
  parseZoomStartMs: (m: ZoomRawMeeting) => number,
  isoDateFn: (dt: DateTime) => string,
  zone: string,
): ZoomRawMeeting[] {
  const onDate = instances.filter((m) => {
    const ms = parseZoomStartMs(m);
    if (!Number.isFinite(ms)) return false;
    const dt = DateTime.fromMillis(ms, { zone });
    return dt.isValid && isoDateFn(dt) === dateKey;
  });
  if (targetMinutes == null) {
    return onDate.sort((a, b) => parseZoomStartMs(b) - parseZoomStartMs(a));
  }
  return onDate.sort((a, b) => {
    const da = DateTime.fromMillis(parseZoomStartMs(a), { zone });
    const db = DateTime.fromMillis(parseZoomStartMs(b), { zone });
    const ma = da.isValid ? da.hour * 60 + da.minute : 0;
    const mb = db.isValid ? db.hour * 60 + db.minute : 0;
    return Math.abs(ma - targetMinutes) - Math.abs(mb - targetMinutes);
  });
}

export async function fetchZoomParticipantsForSessionDate(params: {
  zoomApiBase: string;
  token: string;
  zoomGet: ZoomGetFn;
  dateKey: string;
  targetMinutes: number | null;
  meetingHint?: ZoomRawMeeting | null;
  targetMeetingIds: readonly string[];
  pastInstancesCache: Map<string, ZoomRawMeeting[]>;
  parseZoomStartMs: (m: ZoomRawMeeting) => number;
  isoDateFn: (dt: DateTime) => string;
  timeZone: string;
}): Promise<{ participants: ZoomParticipant[]; instanceUuid: string | null; debug: ZoomParticipantFetchDebug }> {
  const {
    zoomApiBase,
    token,
    zoomGet,
    dateKey,
    targetMinutes,
    meetingHint,
    targetMeetingIds,
    pastInstancesCache,
    parseZoomStartMs,
    isoDateFn,
    timeZone,
  } = params;

  const pathsAttempted: string[] = [];
  const instanceUuidsTried: string[] = [];
  const meetingIdsTried: string[] = [];
  let lastError: string | null = null;
  let merged: ZoomParticipant[] = [];
  let source: ZoomParticipantFetchDebug['source'] = 'none';
  let instanceUuid: string | null = null;

  const hintUuid = String(meetingHint?.uuid ?? '').trim();
  if (hintUuid) {
    instanceUuidsTried.push(hintUuid);
    const rows = await zoomParticipantsForUuid(zoomApiBase, token, hintUuid, pathsAttempted);
    if (rows.length > 0) {
      merged = mergeZoomParticipants(merged, rows);
      source = 'hint_uuid';
      instanceUuid = hintUuid;
    }
  }

  const hintId = meetingHint ? meetingIdDigits(meetingHint) : '';
  const idsToScan = [...new Set([...targetMeetingIds, hintId].filter(Boolean))];

  for (const meetingId of idsToScan) {
    meetingIdsTried.push(meetingId);
    let instances = pastInstancesCache.get(meetingId);
    if (!instances) {
      instances = await zoomPastInstancesForMeetingId(zoomGet, token, meetingId);
      pastInstancesCache.set(meetingId, instances);
    }

    const ordered = sortInstancesForDate(
      instances,
      dateKey,
      targetMinutes,
      parseZoomStartMs,
      isoDateFn,
      timeZone,
    );

    for (const inst of ordered) {
      const iuuid = String(inst.uuid ?? '').trim();
      if (!iuuid || instanceUuidsTried.includes(iuuid)) continue;
      instanceUuidsTried.push(iuuid);
      try {
        const rows = await zoomParticipantsForUuid(zoomApiBase, token, iuuid, pathsAttempted);
        if (rows.length > 0) {
          merged = mergeZoomParticipants(merged, rows);
          source = 'instance_uuid';
          if (!instanceUuid) instanceUuid = iuuid;
        }
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }
    if (merged.length > 0) break;

    const metricsRows = await zoomMetricsPastParticipants(zoomApiBase, token, meetingId, dateKey, pathsAttempted);
    if (metricsRows.length > 0) {
      merged = mergeZoomParticipants(merged, metricsRows);
      source = 'metrics';
      break;
    }
  }

  return {
    participants: merged,
    instanceUuid,
    debug: {
      date_key: dateKey,
      meeting_id_tried: meetingIdsTried,
      instance_uuids_tried: instanceUuidsTried,
      paths_attempted: pathsAttempted.slice(0, 40),
      participant_count: merged.length,
      source,
      last_error: lastError,
    },
  };
}

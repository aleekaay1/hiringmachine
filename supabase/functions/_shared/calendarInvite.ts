/**
 * Synced copy of services/calendarInvite.ts — update both when changing.
 */

export type LiveSessionCalendarEvent = {
  title: string;
  description: string;
  location: string;
  zoomUrl: string;
  start: Date;
  end: Date;
  recurringWeekly?: boolean;
};

export type LiveSessionOccurrenceRecord = {
  session_date: string;
  session_start_at: string;
  status?: string;
  calendly_event_name?: string | null;
  calendly_start_at?: string | null;
  zoom_duration_minutes?: number | null;
};

export type ResolvedLiveSession = LiveSessionCalendarEvent & {
  displayDate: string;
  displayTime: string;
  sessionDate?: string | null;
};

export const LIVE_SESSION_TIMEZONE = 'America/New_York';

const DEFAULT_TITLE = 'Live Online Career Session | Globe Life AIL · Paz Organization';

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function formatIcsUtc(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 19).replace(/[-:]/g, '')}Z`;
}

export function parseIsoDate(value: string | undefined | null): Date | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return null;
  return new Date(ms);
}

type Ymd = { year: number; month: number; day: number };

function easternParts(now: Date): Ymd & { weekday: number; hour: number; minute: number } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: LIVE_SESSION_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(now);
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    weekday: weekdayMap[map.weekday] ?? 0,
    hour: Number(map.hour),
    minute: Number(map.minute),
  };
}

function addDaysYmd(ymd: Ymd, days: number): Ymd {
  const d = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function zonedWallClockToUtc(ymd: Ymd, hour: number, minute: number, timeZone = LIVE_SESSION_TIMEZONE): Date {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const readParts = (ms: number) => {
    const got: Record<string, string> = {};
    for (const p of dtf.formatToParts(new Date(ms))) {
      if (p.type !== 'literal') got[p.type] = p.value;
    }
    return {
      year: Number(got.year),
      month: Number(got.month),
      day: Number(got.day),
      hour: Number(got.hour),
      minute: Number(got.minute),
    };
  };
  let ts = Date.UTC(ymd.year, ymd.month - 1, ymd.day, hour, minute);
  for (let i = 0; i < 4; i += 1) {
    const got = readParts(ts);
    const desired = Date.UTC(ymd.year, ymd.month - 1, ymd.day, hour, minute);
    const actual = Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute);
    ts += desired - actual;
  }
  return new Date(ts);
}

const WEDNESDAY_WEEKDAY = 3;
const LIVE_SESSION_START_HOUR = 11;
const LIVE_SESSION_START_MINUTE = 30;
const LIVE_SESSION_DURATION_MIN = 30;

export function fallbackNextWednesdayLiveSession(
  zoomUrl: string,
  env: Record<string, string | undefined> = {},
  now = new Date(),
): ResolvedLiveSession {
  const parts = easternParts(now);
  const minutesNow = parts.hour * 60 + parts.minute;
  const sessionStartMinutes = LIVE_SESSION_START_HOUR * 60 + LIVE_SESSION_START_MINUTE;
  let daysUntil = (WEDNESDAY_WEEKDAY - parts.weekday + 7) % 7;
  if (daysUntil === 0 && minutesNow >= sessionStartMinutes + LIVE_SESSION_DURATION_MIN) {
    daysUntil = 7;
  }
  const targetYmd = addDaysYmd(
    { year: parts.year, month: parts.month, day: parts.day },
    daysUntil,
  );
  const start = zonedWallClockToUtc(targetYmd, LIVE_SESSION_START_HOUR, LIVE_SESSION_START_MINUTE);
  const end = new Date(start.getTime() + LIVE_SESSION_DURATION_MIN * 60 * 1000);
  const labels = formatSessionDisplayLabels(start, end);
  const sessionDate = `${targetYmd.year}-${String(targetYmd.month).padStart(2, '0')}-${String(targetYmd.day).padStart(2, '0')}`;
  return {
    ...buildEventFields(env, zoomUrl, start, end),
    displayDate: env.PUBLIC_LIVE_SESSION_DISPLAY_DATE?.trim() || labels.displayDate,
    displayTime: env.PUBLIC_LIVE_SESSION_DISPLAY_TIME?.trim() || labels.displayTime,
    sessionDate,
  };
}

export function formatSessionDisplayLabels(start: Date, end: Date): { displayDate: string; displayTime: string } {
  const displayDate = new Intl.DateTimeFormat('en-US', {
    timeZone: LIVE_SESSION_TIMEZONE,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(start);
  const timeFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: LIVE_SESSION_TIMEZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const displayTime = `${timeFmt.format(start)} – ${timeFmt.format(end)} Eastern (ET)`;
  return { displayDate, displayTime };
}

function buildEventFields(
  env: Record<string, string | undefined>,
  zoomUrl: string,
  start: Date,
  end: Date,
): LiveSessionCalendarEvent {
  const title = env.PUBLIC_LIVE_SESSION_CALENDAR_TITLE?.trim() || DEFAULT_TITLE;
  const description =
    env.PUBLIC_LIVE_SESSION_CALENDAR_DESCRIPTION?.trim() ||
    `Live Online Career Session with Globe Life AIL · Paz Organization.\n\nJoin Zoom: ${zoomUrl}\n\nPlease join at least 5 minutes early.`;

  return {
    title,
    description,
    location: env.PUBLIC_LIVE_SESSION_CALENDAR_LOCATION?.trim() || `Online (Zoom) — ${zoomUrl}`,
    zoomUrl,
    start,
    end,
    recurringWeekly: false,
  };
}

export function resolvedCalendarFromOccurrence(
  occ: LiveSessionOccurrenceRecord,
  zoomUrl: string,
  env: Record<string, string | undefined> = {},
): ResolvedLiveSession {
  const start = new Date(occ.session_start_at);
  const durationMin =
    occ.zoom_duration_minutes && Number(occ.zoom_duration_minutes) > 0
      ? Number(occ.zoom_duration_minutes)
      : 30;
  const end = new Date(start.getTime() + durationMin * 60 * 1000);
  const labels = formatSessionDisplayLabels(start, end);
  return {
    ...buildEventFields(env, zoomUrl, start, end),
    displayDate: env.PUBLIC_LIVE_SESSION_DISPLAY_DATE?.trim() || labels.displayDate,
    displayTime: env.PUBLIC_LIVE_SESSION_DISPLAY_TIME?.trim() || labels.displayTime,
    sessionDate: occ.session_date,
  };
}

export function resolveLiveSessionCalendar(
  env: Record<string, string | undefined>,
  zoomUrl: string,
  occurrence: LiveSessionOccurrenceRecord | null = null,
): ResolvedLiveSession {
  const envStart = parseIsoDate(env.PUBLIC_LIVE_SESSION_START_ISO);
  const envEnd = parseIsoDate(env.PUBLIC_LIVE_SESSION_END_ISO);
  if (envStart && envEnd && envEnd.getTime() > envStart.getTime()) {
    const labels = formatSessionDisplayLabels(envStart, envEnd);
    return {
      ...buildEventFields(env, zoomUrl, envStart, envEnd),
      displayDate: env.PUBLIC_LIVE_SESSION_DISPLAY_DATE?.trim() || labels.displayDate,
      displayTime: env.PUBLIC_LIVE_SESSION_DISPLAY_TIME?.trim() || labels.displayTime,
      sessionDate: env.PUBLIC_LIVE_SESSION_DATE?.trim() || null,
    };
  }
  if (occurrence) {
    return resolvedCalendarFromOccurrence(occurrence, zoomUrl, env);
  }
  return fallbackNextWednesdayLiveSession(zoomUrl, env);
}

export function buildIcsContent(
  event: LiveSessionCalendarEvent,
  uid = 'live-session@paz-organization',
): string {
  const stamp = formatIcsUtc(new Date());
  const dtStart = formatIcsUtc(event.start);
  const dtEnd = formatIcsUtc(event.end);
  const summary = escapeIcsText(event.title);
  const description = escapeIcsText(event.description);
  const location = escapeIcsText(event.location);
  const url = escapeIcsText(event.zoomUrl);

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Paz Organization//Live Session//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${location}`,
    `URL:${url}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

export function buildGoogleCalendarUrl(event: LiveSessionCalendarEvent): string {
  const start = formatIcsUtc(event.start);
  const end = formatIcsUtc(event.end);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${start}/${end}`,
    details: event.description,
    location: event.location,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function buildOutlookCalendarUrl(event: LiveSessionCalendarEvent): string {
  const params = new URLSearchParams({
    subject: event.title,
    body: event.description,
    startdt: event.start.toISOString(),
    enddt: event.end.toISOString(),
    location: event.location,
  });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
}

export function buildAddToCalendarEmailHtml(input: { primaryUrl: string }): string {
  const btnColor = '#1a73e8';
  const href = input.primaryUrl.replace(/"/g, '&quot;');
  return `<p style="margin:16px 0 8px;"><a href="${href}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:10px 18px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:#ffffff;text-decoration:none;background-color:${btnColor};border-radius:4px;">Add to Calendar</a></p>`;
}

export function liveSessionCalendarIcsUrl(
  supabaseFunctionsBaseUrl: string,
  anonKey?: string,
  sessionDate?: string | null,
): string {
  const base = `${supabaseFunctionsBaseUrl.replace(/\/$/, '')}/live-session-calendar`;
  const params = new URLSearchParams();
  const key = String(anonKey || '').trim();
  if (key) params.set('apikey', key);
  const date = String(sessionDate || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) params.set('sessionDate', date);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export function buildCalendarEmailAttachments(icsContent: string): Array<{
  filename: string;
  content: string;
  contentType: string;
  contentDisposition: string;
  headers?: Record<string, string>;
}> {
  return [
    {
      filename: 'live-online-career-session.ics',
      content: icsContent,
      contentType: 'text/calendar; charset=UTF-8; method=PUBLISH',
      contentDisposition: 'attachment',
      headers: {
        'Content-Class': 'urn:content-classes:calendarmessage',
      },
    },
  ];
}

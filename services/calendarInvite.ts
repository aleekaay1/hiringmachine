/**
 * Live session calendar invites (ICS + provider links) for post–check-in email.
 * Default schedule: every Wednesday 11:30 AM Eastern (1 hour).
 * Optional Supabase override: PUBLIC_LIVE_SESSION_START_ISO / PUBLIC_LIVE_SESSION_END_ISO
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

export type ResolvedLiveSession = LiveSessionCalendarEvent & {
  displayDate: string;
  displayTime: string;
};

export const LIVE_SESSION_TIMEZONE = 'America/New_York';
/** Wednesday */
export const LIVE_SESSION_WEEKDAY = 3;
export const LIVE_SESSION_START_HOUR = 11;
export const LIVE_SESSION_START_MINUTE = 30;
export const LIVE_SESSION_DURATION_MINUTES = 60;

const DEFAULT_TITLE = 'Live Online Career Session | Globe Life AIL · Paz Organization';

type Ymd = { year: number; month: number; day: number };

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

/** Wall clock in America/New_York → UTC instant. */
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

/** Next upcoming Wednesday 11:30 AM Eastern (or today if still before start). */
export function getNextWednesdayLiveSessionBounds(now = new Date()): {
  start: Date;
  end: Date;
  displayDate: string;
  displayTime: string;
} {
  const ep = easternParts(now);
  let daysAhead = (LIVE_SESSION_WEEKDAY - ep.weekday + 7) % 7;
  if (daysAhead === 0) {
    const beforeStart =
      ep.hour < LIVE_SESSION_START_HOUR ||
      (ep.hour === LIVE_SESSION_START_HOUR && ep.minute < LIVE_SESSION_START_MINUTE);
    if (!beforeStart) daysAhead = 7;
  }
  const sessionYmd = addDaysYmd({ year: ep.year, month: ep.month, day: ep.day }, daysAhead);
  const start = zonedWallClockToUtc(sessionYmd, LIVE_SESSION_START_HOUR, LIVE_SESSION_START_MINUTE);
  const end = new Date(start.getTime() + LIVE_SESSION_DURATION_MINUTES * 60 * 1000);

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

  return { start, end, displayDate, displayTime };
}

function buildEventFields(
  env: Record<string, string | undefined>,
  zoomUrl: string,
  start: Date,
  end: Date,
  recurringWeekly: boolean,
): LiveSessionCalendarEvent {
  const title = env.PUBLIC_LIVE_SESSION_CALENDAR_TITLE?.trim() || DEFAULT_TITLE;
  const description =
    env.PUBLIC_LIVE_SESSION_CALENDAR_DESCRIPTION?.trim() ||
    `Live Online Career Session hosted by Alex Paz.\n\nJoin Zoom: ${zoomUrl}\n\nEvery Wednesday at 11:30 AM Eastern. Please join at least 5 minutes early.`;

  return {
    title,
    description,
    location: env.PUBLIC_LIVE_SESSION_CALENDAR_LOCATION?.trim() || `Online (Zoom) — ${zoomUrl}`,
    zoomUrl,
    start,
    end,
    recurringWeekly,
  };
}

/** Env ISO override, else next Wednesday 11:30 AM ET (weekly). */
export function resolveLiveSessionCalendar(
  env: Record<string, string | undefined>,
  zoomUrl: string,
  now = new Date(),
): ResolvedLiveSession {
  const start = parseIsoDate(env.PUBLIC_LIVE_SESSION_START_ISO);
  const end = parseIsoDate(env.PUBLIC_LIVE_SESSION_END_ISO);
  if (start && end && end.getTime() > start.getTime()) {
    const displayDate =
      env.PUBLIC_LIVE_SESSION_DISPLAY_DATE?.trim() ||
      new Intl.DateTimeFormat('en-US', {
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
    const displayTime =
      env.PUBLIC_LIVE_SESSION_DISPLAY_TIME?.trim() ||
      `${timeFmt.format(start)} – ${timeFmt.format(end)} Eastern (ET)`;
    return {
      ...buildEventFields(env, zoomUrl, start, end, false),
      displayDate,
      displayTime,
    };
  }

  const next = getNextWednesdayLiveSessionBounds(now);
  const displayDate = env.PUBLIC_LIVE_SESSION_DISPLAY_DATE?.trim() || next.displayDate;
  const displayTime = env.PUBLIC_LIVE_SESSION_DISPLAY_TIME?.trim() || next.displayTime;
  return {
    ...buildEventFields(env, zoomUrl, next.start, next.end, true),
    displayDate,
    displayTime,
  };
}

/** @deprecated Use resolveLiveSessionCalendar */
export function getLiveSessionCalendarEventFromEnv(
  env: Record<string, string | undefined>,
  zoomUrl: string,
): LiveSessionCalendarEvent | null {
  const resolved = resolveLiveSessionCalendar(env, zoomUrl);
  return resolved;
}

export function buildIcsContent(event: LiveSessionCalendarEvent, uid = 'live-session-weekly@paz-organization'): string {
  const stamp = formatIcsUtc(new Date());
  const dtStart = formatIcsUtc(event.start);
  const dtEnd = formatIcsUtc(event.end);
  const summary = escapeIcsText(event.title);
  const description = escapeIcsText(event.description);
  const location = escapeIcsText(event.location);
  const url = escapeIcsText(event.zoomUrl);
  const rrule = event.recurringWeekly ? ['RRULE:FREQ=WEEKLY;BYDAY=WE'] : [];

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
    ...rrule,
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
  if (event.recurringWeekly) {
    params.set('recur', 'RRULE:FREQ=WEEKLY;BYDAY=WE');
  }
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

export function buildAddToCalendarEmailHtml(input: {
  /** Primary click target (Google Calendar works in all major clients). */
  primaryUrl: string;
  icsDownloadUrl?: string;
  googleUrl?: string;
  outlookUrl?: string;
}): string {
  const linkStyle = 'color:#005EB8;text-decoration:underline;font-size:13px;font-family:Arial,Helvetica,sans-serif;';
  const extras: string[] = [];
  if (input.icsDownloadUrl) {
    extras.push(`<a href="${input.icsDownloadUrl}" target="_blank" rel="noopener noreferrer" style="${linkStyle}">Download .ics file</a>`);
  }
  if (input.outlookUrl) {
    extras.push(`<a href="${input.outlookUrl}" target="_blank" rel="noopener noreferrer" style="${linkStyle}">Outlook</a>`);
  }
  const extrasRow = extras.length
    ? `<p style="margin:10px 0 0;font-size:12px;color:#4b5563;font-family:Arial,Helvetica,sans-serif;line-height:1.45;">Also: ${extras.join(' · ')}. A calendar file is attached to this email.</p>`
    : `<p style="margin:10px 0 0;font-size:12px;color:#4b5563;font-family:Arial,Helvetica,sans-serif;">A calendar file (.ics) is attached to this email.</p>`;

  return `
<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:16px 0 8px;">
  <tr>
    <td align="left" bgcolor="#005EB8" style="border-radius:8px;mso-padding-alt:14px 24px;">
      <!--[if mso]>
      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${input.primaryUrl}" style="height:44px;v-text-anchor:middle;width:220px;" arcsize="12%" strokecolor="#005EB8" fillcolor="#005EB8">
        <w:anchorlock/>
        <center style="color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;">Add to Calendar</center>
      </v:roundrect>
      <![endif]-->
      <!--[if !mso]><!-->
      <a href="${input.primaryUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 24px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:8px;background-color:#005EB8;border:1px solid #005EB8;">
        Add to Calendar
      </a>
      <!--<![endif]-->
    </td>
  </tr>
</table>
${extrasRow}`.trim();
}

export function liveSessionCalendarIcsUrl(supabaseFunctionsBaseUrl: string, anonKey?: string): string {
  const base = `${supabaseFunctionsBaseUrl.replace(/\/$/, '')}/live-session-calendar`;
  const key = String(anonKey || '').trim();
  if (!key) return base;
  return `${base}?apikey=${encodeURIComponent(key)}`;
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

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
    `Live Online Career Session hosted by Alex Paz.\n\nJoin Zoom: ${zoomUrl}\n\nPlease join at least 5 minutes early.`;

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
): ResolvedLiveSession | null {
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
  return null;
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

export function buildAddToCalendarEmailHtml(input: {
  primaryUrl: string;
  icsDownloadUrl?: string;
  outlookUrl?: string;
}): string {
  const btnColor = '#1a73e8';
  const href = input.primaryUrl.replace(/"/g, '&quot;');
  const button = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 10px;">
  <tr>
    <td align="left" style="border-radius:6px;background-color:${btnColor};">
      <a href="${href}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:11px 22px;font-family:Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:500;line-height:20px;color:#ffffff;text-decoration:none;border-radius:6px;background-color:${btnColor};border:1px solid ${btnColor};mso-padding-alt:11px 22px;">
        Add to Calendar
      </a>
    </td>
  </tr>
</table>`;

  const linkStyle =
    'color:#1a73e8;text-decoration:underline;font-size:12px;font-family:Roboto,Helvetica,Arial,sans-serif;';
  const extras: string[] = [];
  if (input.outlookUrl) {
    const outlookHref = input.outlookUrl.replace(/"/g, '&quot;');
    extras.push(
      `<a href="${outlookHref}" target="_blank" rel="noopener noreferrer" style="${linkStyle}">Open in Outlook</a>`,
    );
  }
  if (input.icsDownloadUrl) {
    const icsHref = input.icsDownloadUrl.replace(/"/g, '&quot;');
    extras.push(
      `<a href="${icsHref}" target="_blank" rel="noopener noreferrer" style="${linkStyle}">Download calendar file</a>`,
    );
  }
  const extrasRow = extras.length
    ? `<p style="margin:0 0 4px;font-size:12px;color:#5f6368;font-family:Roboto,Helvetica,Arial,sans-serif;line-height:1.5;">${extras.join(' &nbsp;&middot;&nbsp; ')}</p>`
    : '';

  return `${button}${extrasRow}`.trim();
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

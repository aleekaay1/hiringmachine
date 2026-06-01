/**
 * Live session calendar invites (ICS + provider links) for post–check-in email.
 * Configure on Supabase: PUBLIC_LIVE_SESSION_START_ISO, PUBLIC_LIVE_SESSION_END_ISO
 * (ISO 8601 UTC or offset, e.g. 2026-06-03T22:00:00-04:00).
 */

export type LiveSessionCalendarEvent = {
  title: string;
  description: string;
  location: string;
  zoomUrl: string;
  start: Date;
  end: Date;
};

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

export function getLiveSessionCalendarEventFromEnv(
  env: Record<string, string | undefined>,
  zoomUrl: string,
): LiveSessionCalendarEvent | null {
  const start = parseIsoDate(env.PUBLIC_LIVE_SESSION_START_ISO);
  const end = parseIsoDate(env.PUBLIC_LIVE_SESSION_END_ISO);
  if (!start || !end || end.getTime() <= start.getTime()) return null;

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
  };
}

export function buildIcsContent(event: LiveSessionCalendarEvent, uid = 'live-session@paz-organization'): string {
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

/** Primary CTA + fallback provider links for HTML email. */
export function buildAddToCalendarEmailHtml(input: {
  icsDownloadUrl: string;
  googleUrl?: string;
  outlookUrl?: string;
}): string {
  const buttonStyle =
    'display:inline-block;background:#005EB8;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;line-height:1.2;padding:14px 28px;border-radius:8px;margin:8px 0 4px;';
  const linkStyle = 'color:#005EB8;text-decoration:underline;font-size:13px;';
  const fallbacks: string[] = [];
  if (input.googleUrl) {
    fallbacks.push(`<a href="${input.googleUrl}" target="_blank" rel="noopener noreferrer" style="${linkStyle}">Google Calendar</a>`);
  }
  if (input.outlookUrl) {
    fallbacks.push(`<a href="${input.outlookUrl}" target="_blank" rel="noopener noreferrer" style="${linkStyle}">Outlook</a>`);
  }
  const fallbackRow = fallbacks.length
    ? `<p style="margin:8px 0 0;font-size:12px;color:#4b5563;">Or add via ${fallbacks.join(' · ')}. An .ics file is also attached to this email.</p>`
    : `<p style="margin:8px 0 0;font-size:12px;color:#4b5563;">An .ics calendar file is attached to this email for Apple Calendar and other apps.</p>`;

  return `
<p style="margin:16px 0 8px;">
  <a href="${input.icsDownloadUrl}" target="_blank" rel="noopener noreferrer" style="${buttonStyle}">Add to Calendar</a>
</p>
${fallbackRow}`.trim();
}

export function liveSessionCalendarIcsUrl(supabaseFunctionsBaseUrl: string): string {
  const base = supabaseFunctionsBaseUrl.replace(/\/$/, '');
  return `${base}/live-session-calendar`;
}

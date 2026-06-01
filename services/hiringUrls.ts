/** Shared hiring links (Zoom, assessment lookup). */

export const ZOOM_MEETING_URL = 'https://us02web.zoom.us/j/6478311787';

/** Reschedule link for missed live career session emails. */
export const LIVE_SESSION_RESCHEDULE_CALENDLY_URL =
  'https://calendly.com/alex_paz/live-online-career-session';

/**
 * Default session line items for post–check-in invite (computed at send time when not overridden).
 * Live session: every Wednesday 11:30 AM Eastern (1 hour). See services/calendarInvite.ts.
 * Optional Supabase overrides: PUBLIC_LIVE_SESSION_DISPLAY_DATE, PUBLIC_LIVE_SESSION_DISPLAY_TIME,
 * or PUBLIC_LIVE_SESSION_START_ISO / PUBLIC_LIVE_SESSION_END_ISO for a fixed one-off event.
 */
export const POST_CHECKIN_DEFAULT_SESSION_DATE = 'Every Wednesday (next session date in your invite)';
export const POST_CHECKIN_DEFAULT_SESSION_TIME = '11:30 AM – 12:30 PM Eastern (ET)';

/** Public assessment lookup page. Override per send via merge extras if needed. */
export const DEFAULT_ASSESSMENT_LOOKUP_URL = 'https://paz-talent-journey.vercel.app/assessment-lookup';

/** Optional dev/prod override from Vite (client only). */
export function getAssessmentLookupUrlForClient(): string {
  const fromEnv = (import.meta.env.VITE_PUBLIC_ASSESSMENT_LOOKUP_URL as string | undefined)?.trim();
  return fromEnv || DEFAULT_ASSESSMENT_LOOKUP_URL;
}

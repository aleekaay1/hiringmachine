/** Shared hiring links (Zoom, assessment lookup). */

export const ZOOM_MEETING_URL = 'https://us02web.zoom.us/j/6478311787';

/** Reschedule link for missed live career session emails. */
export const LIVE_SESSION_RESCHEDULE_CALENDLY_URL =
  'https://calendly.com/alex_paz/live-online-career-session';

/** Fallback labels when no live_session_occurrences row is loaded yet (preview only). */
export const POST_CHECKIN_DEFAULT_SESSION_DATE = 'See your calendar invite for the session date';
export const POST_CHECKIN_DEFAULT_SESSION_TIME = 'See your calendar invite for the session time';

/** Public assessment lookup page. Override per send via merge extras if needed. */
export const DEFAULT_ASSESSMENT_LOOKUP_URL = 'https://paz-talent-journey.vercel.app/assessment-lookup';

/** Optional dev/prod override from Vite (client only). */
export function getAssessmentLookupUrlForClient(): string {
  const fromEnv = (import.meta.env.VITE_PUBLIC_ASSESSMENT_LOOKUP_URL as string | undefined)?.trim();
  return fromEnv || DEFAULT_ASSESSMENT_LOOKUP_URL;
}

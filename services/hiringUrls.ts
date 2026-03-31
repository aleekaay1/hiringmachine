/** Shared hiring links (Zoom, assessment lookup). */

export const ZOOM_MEETING_URL = 'https://us02web.zoom.us/j/6478311787';

/** Public assessment lookup page. Override per send via merge extras if needed. */
export const DEFAULT_ASSESSMENT_LOOKUP_URL = 'https://paz-talent-journey.vercel.app/assessment-lookup';

/** Optional dev/prod override from Vite (client only). */
export function getAssessmentLookupUrlForClient(): string {
  const fromEnv = (import.meta.env.VITE_PUBLIC_ASSESSMENT_LOOKUP_URL as string | undefined)?.trim();
  return fromEnv || DEFAULT_ASSESSMENT_LOOKUP_URL;
}

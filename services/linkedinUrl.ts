/**
 * Normalize and validate public LinkedIn profile URLs (free-form paste from candidates).
 * Does not call LinkedIn — URL shape only.
 */

function looksLikeLinkedInHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  return h === 'linkedin.com' || h.endsWith('.linkedin.com');
}

/** Returns a canonical https URL or empty string if invalid / empty. */
export function normalizeLinkedInProfileUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  let toParse = trimmed;
  if (!/^https?:\/\//i.test(toParse)) {
    toParse = `https://${toParse}`;
  }

  let url: URL;
  try {
    url = new URL(toParse);
  } catch {
    return '';
  }

  if (!looksLikeLinkedInHost(url.hostname)) return '';

  const path = url.pathname.replace(/\/+$/, '') || '/';
  const okPath =
    /^\/in\/[^/]+/i.test(path) || /^\/pub\//i.test(path) || /^\/sales\/lead\//i.test(path);
  if (!okPath) return '';

  const slug = path.replace(/^\/+|\/+$/g, '');
  return `https://www.linkedin.com/${slug}${url.search || ''}`;
}

export function isValidLinkedInProfileUrl(raw: string): boolean {
  return normalizeLinkedInProfileUrl(raw) !== '';
}

/** True if the candidate provided at least one resume file URL or a LinkedIn profile URL. */
export function hasResumeOrLinkedInMaterial(
  resumeUrls: string[] | undefined | null,
  linkedinProfileUrl: string | undefined | null,
): boolean {
  return Boolean(resumeUrls?.length) || Boolean(linkedinProfileUrl?.trim());
}

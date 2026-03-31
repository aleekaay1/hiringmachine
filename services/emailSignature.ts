export { CC_EMAIL_ALEX, buildEmailSignatureHtml, appendEmailSignatureToHtml, SIGNATURE_LOGO_URL } from './emailSignatureHtml';

/** Site origin for emails: browser admin, or optional Vite env for automation. */
export function getSiteOriginForEmail(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  const url = import.meta.env.VITE_PUBLIC_SITE_URL as string | undefined;
  return url?.replace(/\/$/, '') || '';
}

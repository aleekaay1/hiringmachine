/**
 * Shared HTML email signature (Talent Acquisition · Paz Organization).
 * Logo uses absolute URL from your deployed site so images load in email clients.
 */

/** Optional CC for report emails from admin (testing: leave checkbox off). */
export const CC_EMAIL_ALEX = 'alex@globelife-paz.com';

/** Public paths on the same origin as the app (Vercel, etc.). */
const LOGO_PATH = '/logo.png';

/** Icon assets (hosted) — small, email-client friendly. */
const ICONS = {
  website: 'https://img.icons8.com/fluency/48/domain.png',
  linkedin: 'https://img.icons8.com/color/48/linkedin.png',
  facebook: 'https://img.icons8.com/color/48/facebook.png',
  instagram: 'https://img.icons8.com/color/48/instagram-new.png',
} as const;

/** Default outbound links for social row (update here if you add dedicated profile URLs). */
const SOCIAL_LINKS = {
  website: 'https://globelife-paz.com',
  linkedin: 'https://globelife-paz.com',
  facebook: 'https://globelife-paz.com',
  instagram: 'https://globelife-paz.com',
} as const;

function normalizeOrigin(siteOrigin: string): string {
  return siteOrigin.replace(/\/$/, '');
}

export function buildEmailSignatureHtml(siteOrigin: string): string {
  const origin = normalizeOrigin(siteOrigin);
  if (!origin) return '';
  const logoUrl = `${origin}${LOGO_PATH}`;

  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px; border-top:1px solid #e5e7eb; padding-top:16px; max-width:520px; font-family:Arial,Helvetica,sans-serif; font-size:12px; color:#374151; line-height:1.55;">
  <tr>
    <td style="padding-bottom:12px;">
      <img src="${logoUrl}" alt="Globe Life AIL · Paz Organization" width="132" style="display:block; max-width:132px; height:auto; border:0;" />
    </td>
  </tr>
  <tr>
    <td>
      <strong style="font-size:13px; color:#111827;">Talent Acquisition</strong><br/>
      Globe Life AIL Division: Paz Organization<br/>
      Phone: <a href="tel:+12898123930" style="color:#005EB8; text-decoration:none;">(289) 812-3930</a><br/>
      Address: 59-700 Third Line, Oakville, ON L6L 4B1<br/>
      <a href="https://globelife-paz.com" style="color:#005EB8; text-decoration:none;">globelife-paz.com</a>
    </td>
  </tr>
  <tr>
    <td style="padding-top:14px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="padding-right:10px;"><a href="${SOCIAL_LINKS.website}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;"><img src="${ICONS.website}" width="26" height="26" alt="Website" style="display:block; border:0;" /></a></td>
          <td style="padding-right:10px;"><a href="${SOCIAL_LINKS.linkedin}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;"><img src="${ICONS.linkedin}" width="26" height="26" alt="LinkedIn" style="display:block; border:0;" /></a></td>
          <td style="padding-right:10px;"><a href="${SOCIAL_LINKS.facebook}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;"><img src="${ICONS.facebook}" width="26" height="26" alt="Facebook" style="display:block; border:0;" /></a></td>
          <td><a href="${SOCIAL_LINKS.instagram}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;"><img src="${ICONS.instagram}" width="26" height="26" alt="Instagram" style="display:block; border:0;" /></a></td>
        </tr>
      </table>
    </td>
  </tr>
</table>
  `.trim();
}

/** Append signature to HTML composed by admin (no merge placeholder). */
export function appendEmailSignatureToHtml(bodyHtml: string, siteOrigin: string): string {
  const sig = buildEmailSignatureHtml(siteOrigin);
  if (!sig) return bodyHtml;
  return `${bodyHtml.trim()}${sig}`;
}

/** Site origin for emails: browser admin, or optional Vite env for automation. */
export function getSiteOriginForEmail(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  const url = import.meta.env.VITE_PUBLIC_SITE_URL as string | undefined;
  return url?.replace(/\/$/, '') || '';
}

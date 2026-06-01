/**
 * HTML signature only (safe for Edge / Vite). No import.meta.
 */

export const CC_EMAIL_ALEX = 'alex@globelife-paz.com';

export const SIGNATURE_LOGO_URL =
  'https://globelife-paz.com/wp-content/uploads/2026/02/Globe_Life_AIL_CD_NZ_Paz-Organization_Stacked_Logo_RGB_COLOR_BLUE_TEXT_TEMPLATE.png';

const ICONS = {
  website: 'https://img.icons8.com/fluency/48/domain.png',
  linkedin: 'https://img.icons8.com/color/48/linkedin.png',
  facebook: 'https://img.icons8.com/color/48/facebook.png',
  instagram: 'https://img.icons8.com/color/48/instagram-new.png',
} as const;

const SOCIAL_LINKS = {
  website: 'https://globelife-paz.com',
  facebook: 'https://www.facebook.com/profile.php?id=61584527937036',
  linkedin: 'https://www.linkedin.com/company/globe-life-ail-division-paz-organization/',
  instagram: 'https://www.instagram.com/paz_organization/',
} as const;

export function buildEmailSignatureHtml(_siteOrigin?: string): string {
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;border-top:1px solid #e5e7eb;padding-top:10px;max-width:520px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#374151;line-height:1.45;">
  <tr>
    <td style="padding:0 0 6px 0;font-size:13px;color:#374151;">Best regards,</td>
  </tr>
  <tr>
    <td style="padding:0 0 8px 0;">
      <img src="${SIGNATURE_LOGO_URL}" alt="Globe Life AIL · Paz Organization" width="132" style="display:block;max-width:132px;height:auto;border:0;" />
    </td>
  </tr>
  <tr>
    <td>
      <strong style="font-size:13px; color:#111827;">Talent Acquisition Team</strong><br/>
      Globe Life AIL Division – Paz Organization<br/>
      Phone: <a href="tel:+12898123930" style="color:#005EB8; text-decoration:none;">(289) 812-3930</a><br/>
      Address: 59-700 Third Line, Oakville, ON L6L 4B1<br/>
      <a href="https://globelife-paz.com" style="color:#005EB8; text-decoration:none;">globelife-paz.com</a>
    </td>
  </tr>
  <tr>
    <td style="padding-top:8px;">
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

export function appendEmailSignatureToHtml(bodyHtml: string, siteOrigin?: string): string {
  const sig = buildEmailSignatureHtml(siteOrigin);
  if (!sig) return bodyHtml;
  return `${bodyHtml.trim()}${sig}`;
}

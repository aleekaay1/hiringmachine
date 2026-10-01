export const AGENT_TITLE_DEFAULT = 'Life Insurance Producer';
export const AGENT_TEAM_DEFAULT = 'AO Globe Life - Team Paz';
export const AGENT_TAGLINE_DEFAULT = "AO Let's Grow - Make Tomorrow Better";
export const AGENT_ADDRESS_DEFAULT = '59-700 Third Line, Oakville, ON. L6L 4B1';
export const AGENT_WEBSITE_URL = 'https://globelife-paz.com';
export const AGENT_OFFICE_DEFAULT = '+12898123930';

export const AGENT_LOGO_URL =
  'https://globelife-paz.com/wp-content/uploads/2026/02/Globe_Life_AIL_CD_NZ_Paz-Organization_Stacked_Logo_RGB_COLOR_BLUE_TEXT_TEMPLATE.png';

const SOCIAL = {
  instagram: 'https://www.instagram.com/paz_organization/',
  linkedin: 'https://www.linkedin.com/company/globe-life-ail-division-paz-organization/',
  facebook: 'https://www.facebook.com/profile.php?id=61584527937036',
  youtube: 'https://www.youtube.com/results?search_query=AO+Globe+Life+Paz',
  tiktok: 'https://www.tiktok.com/@paz_organization',
} as const;

const ICONS = {
  instagram: 'https://img.icons8.com/color/48/instagram-new.png',
  linkedin: 'https://img.icons8.com/color/48/linkedin.png',
  facebook: 'https://img.icons8.com/color/48/facebook.png',
  youtube: 'https://img.icons8.com/color/48/youtube-play.png',
  tiktok: 'https://img.icons8.com/color/48/tiktok.png',
  phone: 'https://img.icons8.com/fluency-systems-filled/48/ffffff/phone.png',
  email: 'https://img.icons8.com/fluency-systems-filled/48/ffffff/new-post.png',
  web: 'https://img.icons8.com/fluency-systems-filled/48/ffffff/domain.png',
  pin: 'https://img.icons8.com/fluency-systems-filled/48/ffffff/marker.png',
} as const;

export type AgentCardInput = {
  fullName: string;
  title?: string | null;
  teamLine?: string | null;
  tagline?: string | null;
  email: string;
  officePhone?: string | null;
  officeExt?: string | null;
  directPhone?: string | null;
  address?: string | null;
  websiteUrl?: string | null;
  logoUrl?: string | null;
  contactUrl: string;
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function telHref(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, '');
  return digits ? `tel:${digits}` : '#';
}

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 ${digits.slice(1, 4)}${digits.slice(4, 7)}${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `+1 ${digits.slice(0, 3)}${digits.slice(3, 6)}${digits.slice(6)}`;
  }
  return raw.trim();
}

export function buildConfidentialityStatement(fullName: string, email: string): string {
  return (
    `Confidentiality Statement: This transmission is intended to be delivered to the named addressee(s) and may contain information that is confidential, proprietary, agent work-product, and/or agent-client privileged. If this information is received by anyone other than the named addressee(s), the recipient(s) should immediately notify the sender, ${fullName}, by e-mail: ${email}, and obtain instructions for the disposal of the transmitted information. In no event shall the information be read, used, copied, reproduced, stored, or retained by anyone other than the named addressee(s), unless express written consent is provided by the Sender or the named addressee(s)`
  );
}

export function buildAgentVcard(input: AgentCardInput): string {
  const name = input.fullName.trim();
  const parts = name.split(/\s+/);
  const last = parts.length > 1 ? parts[parts.length - 1] : '';
  const first = parts.slice(0, -1).join(' ') || name;
  const office = (input.officePhone || '').trim();
  const direct = (input.directPhone || '').trim();
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${name}`,
    `N:${last};${first};;;`,
    `ORG:${input.teamLine || AGENT_TEAM_DEFAULT}`,
    `TITLE:${input.title || AGENT_TITLE_DEFAULT}`,
    `EMAIL;TYPE=WORK:${input.email.trim()}`,
  ];
  if (office) lines.push(`TEL;TYPE=WORK,VOICE:${office.replace(/\s+/g, '')}`);
  if (direct) lines.push(`TEL;TYPE=CELL,VOICE:${direct.replace(/\s+/g, '')}`);
  lines.push('ADR;TYPE=WORK:;;59-700 Third Line;Oakville;ON;L6L 4B1;Canada');
  lines.push(`URL:${input.websiteUrl || AGENT_WEBSITE_URL}`);
  lines.push('END:VCARD');
  return lines.join('\r\n');
}

function greenIcon(src: string, alt: string): string {
  return `<td width="36" valign="middle" style="width:36px;padding:0 10px 10px 0;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="32" height="32" style="width:32px;height:32px;background-color:#21c45a;border-radius:16px;">
      <tr><td align="center" valign="middle" style="background-color:#21c45a;border-radius:16px;width:32px;height:32px;">
        <img src="${src}" width="16" height="16" alt="${escapeHtml(alt)}" style="display:block;border:0;width:16px;height:16px;" />
      </td></tr>
    </table>
  </td>`;
}

export function buildAgentSignatureCardHtml(input: AgentCardInput): string {
  const name = escapeHtml(input.fullName.trim());
  const title = escapeHtml(input.title || AGENT_TITLE_DEFAULT);
  const team = escapeHtml(input.teamLine || AGENT_TEAM_DEFAULT);
  const tagline = escapeHtml(input.tagline || AGENT_TAGLINE_DEFAULT);
  const email = escapeHtml(input.email.trim());
  const emailRaw = input.email.trim();
  const officeRaw = (input.officePhone || AGENT_OFFICE_DEFAULT).trim();
  const ext = (input.officeExt || '').trim();
  const officeLabel = `${formatPhone(officeRaw)}${ext ? ` Ext. ${escapeHtml(ext)}` : ''}`;
  const directRaw = (input.directPhone || '').trim();
  const address = escapeHtml(input.address || AGENT_ADDRESS_DEFAULT);
  const siteUrl = input.websiteUrl || AGENT_WEBSITE_URL;
  const logo = input.logoUrl || AGENT_LOGO_URL;
  const contactUrl = input.contactUrl;
  const confidentiality = escapeHtml(buildConfidentialityStatement(input.fullName.trim(), emailRaw));

  const officeRow = officeRaw
    ? `<tr>
        ${greenIcon(ICONS.phone, 'Office')}
        <td style="padding:0 0 10px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827;">
          <a href="${telHref(officeRaw)}" style="color:#111827;text-decoration:none;">${escapeHtml(officeLabel)}</a>
          <div style="font-size:11px;color:#6b7280;">Office</div>
        </td>
        ${
          directRaw
            ? `${greenIcon(ICONS.phone, 'Direct')}
        <td style="padding:0 0 10px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827;">
          <a href="${telHref(directRaw)}" style="color:#111827;text-decoration:none;">${escapeHtml(formatPhone(directRaw))}</a>
          <div style="font-size:11px;color:#6b7280;">Direct</div>
        </td>`
            : '<td></td><td></td>'
        }
      </tr>`
    : '';

  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="640" style="max-width:640px;width:100%;font-family:Arial,Helvetica,sans-serif;background:#ffffff;color:#111827;">
  <tr>
    <td valign="top" width="110" style="padding:8px 16px 8px 0;">
      <img src="${escapeHtml(logo)}" alt="AO Globe Life" width="96" style="display:block;max-width:96px;height:auto;border:0;" />
    </td>
    <td valign="top" style="padding:8px 0;">
      <div style="font-size:22px;font-weight:700;color:#111827;line-height:1.2;">${name}</div>
      <div style="font-size:14px;color:#4b5563;margin-top:4px;">${title}</div>
      <div style="font-size:14px;color:#111827;margin-top:6px;">${team}</div>
      <div style="font-size:13px;color:#4b5563;margin-top:2px;">${tagline}</div>
    </td>
  </tr>
  <tr>
    <td colspan="2" style="padding:12px 0 4px 0;border-top:2px solid #21c45a;"></td>
  </tr>
  <tr>
    <td colspan="2" style="padding:8px 0 0 0;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        ${officeRow}
        <tr>
          ${greenIcon(ICONS.email, 'Email')}
          <td style="padding:0 0 10px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827;">
            <a href="mailto:${email}" style="color:#111827;text-decoration:none;">${email}</a>
          </td>
          ${greenIcon(ICONS.web, 'Website')}
          <td style="padding:0 0 10px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827;">
            <a href="${escapeHtml(siteUrl)}" style="color:#111827;text-decoration:none;">AO Globe Life Website</a>
          </td>
        </tr>
        <tr>
          ${greenIcon(ICONS.pin, 'Address')}
          <td colspan="3" style="padding:0 0 12px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827;">${address}</td>
        </tr>
      </table>
    </td>
  </tr>
  <tr>
    <td colspan="2" style="padding:8px 0 4px 0;border-top:2px solid #21c45a;"></td>
  </tr>
  <tr>
    <td colspan="2" style="padding:10px 0 4px 0;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          <td>
            <a href="${SOCIAL.instagram}"><img src="${ICONS.instagram}" width="28" height="28" alt="Instagram" style="border:0;margin-right:8px;" /></a>
            <a href="${SOCIAL.linkedin}"><img src="${ICONS.linkedin}" width="28" height="28" alt="LinkedIn" style="border:0;margin-right:8px;" /></a>
            <a href="${SOCIAL.facebook}"><img src="${ICONS.facebook}" width="28" height="28" alt="Facebook" style="border:0;margin-right:8px;" /></a>
            <a href="${SOCIAL.youtube}"><img src="${ICONS.youtube}" width="28" height="28" alt="YouTube" style="border:0;margin-right:8px;" /></a>
            <a href="${SOCIAL.tiktok}"><img src="${ICONS.tiktok}" width="28" height="28" alt="TikTok" style="border:0;" /></a>
          </td>
          <td align="right">
            <a href="${escapeHtml(contactUrl)}" style="display:inline-block;background:#21c45a;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;text-decoration:none;padding:10px 18px;border-radius:22px;">Save contact</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
  <tr>
    <td colspan="2" style="padding:18px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.5;color:#6b7280;">
      ${confidentiality}
    </td>
  </tr>
</table>`.trim();
}

export function defaultWelcomePackageHtml(firstName: string, portalLink?: string | null): string {
  const first = escapeHtml(firstName || 'there');
  const portal = portalLink
    ? `<p style="margin:20px 0;"><a href="${escapeHtml(portalLink)}" style="display:inline-block;background:#005EB8;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:700;">Open the hiring portal</a></p>
       <p style="font-size:13px;color:#4b5563;">Use that button to set your password and start tracking your candidates.</p>`
    : `<p style="font-size:13px;color:#4b5563;">Your hiring-portal invite is on the way. Use it to track your candidates.</p>`;
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:640px;font-family:Arial,Helvetica,sans-serif;color:#1f2937;font-size:15px;line-height:1.55;">
  <tr><td>
    <p>Hi ${first},</p>
    <p>Welcome to <strong>AO Globe Life – Team Paz</strong>. You are hired, and we are glad you are here.</p>
    <p>This email is your welcome package. A second email follows with your personalized email signature (copy it into Gmail / Outlook, or save the attached HTML).</p>
    ${portal}
    <div style="margin:24px 0;padding:16px;border:1px dashed #c4b8a1;border-radius:12px;background:#fbf8f2;">
      <p style="margin:0 0 8px 0;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#8a8276;"><strong>Welcome package</strong></p>
      <p style="margin:0;">The full welcome-packet HTML will be dropped in here. Until then, reply to this email if you need licensing, contracting, or first-week details.</p>
    </div>
    <p>Talk soon,<br/>Team Paz</p>
  </td></tr>
</table>`.trim();
}

export function buildSignatureSetupEmailHtml(input: AgentCardInput): string {
  const first = escapeHtml(input.fullName.trim().split(/\s+/)[0] || 'there');
  const card = buildAgentSignatureCardHtml(input);
  const contactUrl = escapeHtml(input.contactUrl);
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:680px;font-family:Arial,Helvetica,sans-serif;color:#1f2937;font-size:15px;line-height:1.5;">
  <tr><td>
    <p>Hi ${first},</p>
    <p>Here is your <strong>AO Globe Life</strong> email signature. Paste the card below into Gmail (Settings → See all settings → Signature) or Outlook. You can also open the attached HTML file and copy from there.</p>
    <p>View my contact details here: <a href="${contactUrl}">${contactUrl}</a></p>
    <div style="margin:20px 0;padding:16px;border:1px solid #e5e7eb;border-radius:12px;">
      ${card}
    </div>
    <p style="font-size:13px;color:#4b5563;">Tip: in Gmail, paste with original formatting so the logo and buttons stay intact.</p>
  </td></tr>
</table>`.trim();
}

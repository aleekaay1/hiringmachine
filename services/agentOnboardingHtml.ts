export const AGENT_TITLE_DEFAULT = 'Life Insurance Producer';
export const AGENT_TEAM_DEFAULT = 'AO Globe Life - Team Paz';
export const AGENT_TAGLINE_DEFAULT = "AO Let's Grow - Make Tomorrow Better";
export const AGENT_ADDRESS_DEFAULT = '59-700 Third Line, Oakville, ON. L6L 4B1';
export const AGENT_WEBSITE_URL = 'https://globelife-paz.com';
export const AGENT_OFFICE_DEFAULT = '+12898123930';

/** Production origin so email clients can load the PNG mark. AVIF stays in /brand for the source file. */
export const SIGNATURE_ASSET_ORIGIN = 'https://aopaz.vercel.app';
export const SIGNATURE_GREEN = '#389C50';
/** Full-resolution PNG from the AVIF, displayed small so phone screens stay sharp. */
export const SIGNATURE_MARK_URL = `${SIGNATURE_ASSET_ORIGIN}/brand/ao-globe-life-mark-hq.png`;
export const SIGNATURE_MARK_WIDTH = 96;
export const SIGNATURE_MARK_HEIGHT = 119;
export const ALEX_PAZ_EMAIL = 'alex@globelife-paz.com';
export const ALEX_PAZ_OFFICE_EXT = '5201';
export const ALEX_PAZ_DIRECT_PHONE = '+16478311787';
export const ALEX_PAZ_VCARD_URL = `${SIGNATURE_ASSET_ORIGIN}/brand/alex-paz.vcf`;

export const AGENT_LOGO_URL = SIGNATURE_MARK_URL;

export const ORG_SOCIAL_LINKS = {
  instagram: 'https://www.instagram.com/paz_organization/',
  linkedin: 'https://www.linkedin.com/company/globe-life-ail-division-paz-organization/',
  facebook: 'https://www.facebook.com/profile.php?id=61584527937036',
  youtube: 'https://www.youtube.com/results?search_query=AO+Globe+Life+Paz',
  tiktok: 'https://www.tiktok.com/@paz_organization',
} as const;

const SOCIAL = ORG_SOCIAL_LINKS;

export type SignatureSocials = {
  instagram?: string | null;
  linkedin?: string | null;
  facebook?: string | null;
  youtube?: string | null;
  tiktok?: string | null;
};

const ICONS = {
  instagram: `${SIGNATURE_ASSET_ORIGIN}/brand/icons/instagram.png`,
  linkedin: `${SIGNATURE_ASSET_ORIGIN}/brand/icons/linkedin.png`,
  facebook: `${SIGNATURE_ASSET_ORIGIN}/brand/icons/facebook.png`,
  youtube: `${SIGNATURE_ASSET_ORIGIN}/brand/icons/youtube.png`,
  tiktok: `${SIGNATURE_ASSET_ORIGIN}/brand/icons/tiktok.png`,
  phone: `${SIGNATURE_ASSET_ORIGIN}/brand/icons/phone.png`,
  email: `${SIGNATURE_ASSET_ORIGIN}/brand/icons/email.png`,
  website: `${SIGNATURE_ASSET_ORIGIN}/brand/icons/website.png`,
  pin: `${SIGNATURE_ASSET_ORIGIN}/brand/icons/pin.png`,
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
  /** When set, only non-empty links are shown. When omitted, the org profiles are used. */
  socials?: SignatureSocials | null;
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
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  const trimmed = raw.trim();
  if (!digits) return trimmed;
  return trimmed.startsWith('+') ? `+${digits}` : trimmed;
}

export function buildConfidentialityStatement(fullName: string, email: string): string {
  return (
    `Confidentiality Statement: This transmission is intended to be delivered to the named addressee(s) and may contain information that is confidential, proprietary, agent work-product, and/or agent-client privileged. If this information is received by anyone other than the named addressee(s), the recipient(s) should immediately notify the sender, ${fullName}, by e-mail: ${email}, and obtain instructions for the disposal of the transmitted information. In no event shall the information be read, used, copied, reproduced, stored, or retained by anyone other than the named addressee(s), unless express written consent is provided by the Sender or the named addressee(s)`
  );
}

function vcardFileSlug(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'contact';
}

/** HTTPS .vcf link for the Save contact button. The card layout stays the same. */
export function buildSaveContactUrl(input: AgentCardInput): string {
  const name = input.fullName.trim();
  const params = new URLSearchParams();
  params.set('n', name);
  params.set('t', (input.title || AGENT_TITLE_DEFAULT).trim());
  params.set('o', (input.teamLine || AGENT_TEAM_DEFAULT).trim());
  params.set('e', input.email.trim());
  const office = (input.officePhone || AGENT_OFFICE_DEFAULT).trim();
  const direct = (input.directPhone || '').trim();
  const ext = (input.officeExt || '').trim();
  if (office) params.set('p', office);
  if (ext) params.set('x', ext);
  if (direct) params.set('d', direct);
  params.set('a', (input.address || AGENT_ADDRESS_DEFAULT).trim());
  params.set('w', (input.websiteUrl || AGENT_WEBSITE_URL).trim());
  return `${SIGNATURE_ASSET_ORIGIN}/v/${vcardFileSlug(name)}.vcf?${params.toString()}`;
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
  const ext = (input.officeExt || '').trim();
  if (ext) lines.push(`NOTE:Office Ext. ${ext}`);
  lines.push('ADR;TYPE=WORK:;;59-700 Third Line;Oakville;ON;L6L 4B1;Canada');
  lines.push(`URL:${input.websiteUrl || AGENT_WEBSITE_URL}`);
  lines.push('END:VCARD');
  return lines.join('\r\n');
}

const FONT_FACE = 'Arial, Helvetica, sans-serif';
const FONT_COLOR = '#222222';

function iconImg(src: string, alt: string, size: number): string {
  return `<img src="${src}" width="${size}" height="${size}" alt="${escapeHtml(alt)}" style="display:block;border:0;width:${size}px;height:${size}px;" />`;
}

/** Gmail's signature editor keeps font color and drops CSS-colored spans. */
function fontText(escaped: string, px: number, bold = false): string {
  const body = bold ? `<b>${escaped}</b>` : escaped;
  return `<font color="${FONT_COLOR}" face="${FONT_FACE}" style="font-size:${px}px;line-height:1.3;color:${FONT_COLOR};">${body}</font>`;
}

function fontLink(href: string, escapedLabel: string, px: number): string {
  return `<a href="${escapeHtml(href)}" style="text-decoration:none;">${fontText(escapedLabel, px)}</a>`;
}

function contactBits(iconSrc: string, alt: string, bodyHtml: string): string {
  return `<table cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td width="30" valign="middle" style="padding:0 6px 0 0;">${iconImg(iconSrc, alt, 22)}</td>
      <td valign="middle">${bodyHtml}</td>
    </tr>
  </table>`;
}

function pairRow(left: string, right: string): string {
  return `<tr>
    <td width="50%" valign="middle" style="padding:0 6px 8px 0;">${left}</td>
    <td width="50%" valign="middle" style="padding:0 0 8px 4px;">${right}</td>
  </tr>`;
}

function fullRow(inner: string): string {
  return `<tr><td colspan="2" valign="middle" style="padding:0 0 8px 0;">${inner}</td></tr>`;
}

function greenRule(): string {
  return `<tr><td height="8" style="height:8px;font-size:0;line-height:0;padding:0;">&nbsp;</td></tr>
    <tr><td height="2" bgcolor="${SIGNATURE_GREEN}" style="height:2px;font-size:2px;line-height:2px;padding:0;background-color:${SIGNATURE_GREEN};">&nbsp;</td></tr>
    <tr><td height="8" style="height:8px;font-size:0;line-height:0;padding:0;">&nbsp;</td></tr>`;
}

function socialCell(href: string, src: string, alt: string): string {
  return `<td valign="middle" style="padding:0 6px 0 0;"><a href="${escapeHtml(href)}" style="text-decoration:none;">${iconImg(src, alt, 26)}</a></td>`;
}

function socialCells(input: AgentCardInput): string {
  const source = input.socials ?? SOCIAL;
  const items: Array<[string, string, string]> = [
    [source.instagram || '', ICONS.instagram, 'Instagram'],
    [source.linkedin || '', ICONS.linkedin, 'LinkedIn'],
    [source.facebook || '', ICONS.facebook, 'Facebook'],
    [source.youtube || '', ICONS.youtube, 'YouTube'],
    [source.tiktok || '', ICONS.tiktok, 'TikTok'],
  ];
  return items
    .map(([href, src, alt]) => {
      const url = href.trim();
      if (!url) return '';
      return socialCell(url, src, alt);
    })
    .join('');
}

function confidentialityHtml(fullName: string, email: string): string {
  const statement = buildConfidentialityStatement(fullName, email);
  const at = statement.indexOf(email);
  if (at < 0) return fontText(escapeHtml(statement), 10);
  const before = escapeHtml(statement.slice(0, at));
  const after = escapeHtml(statement.slice(at + email.length));
  const link = `<a href="mailto:${escapeHtml(email)}" style="text-decoration:underline;">${fontText(escapeHtml(email), 10)}</a>`;
  return `${fontText(before, 10)}${link}${fontText(after, 10)}`;
}

export function buildAgentSignatureCardHtml(input: AgentCardInput): string {
  const name = escapeHtml(input.fullName.trim());
  const title = escapeHtml(input.title || AGENT_TITLE_DEFAULT);
  const team = escapeHtml(input.teamLine || AGENT_TEAM_DEFAULT);
  const tagline = escapeHtml(input.tagline || AGENT_TAGLINE_DEFAULT);
  const emailRaw = input.email.trim();
  const email = escapeHtml(emailRaw);
  const officeRaw = (input.officePhone || AGENT_OFFICE_DEFAULT).trim();
  const ext = (input.officeExt || '').trim();
  const officeLabel = officeRaw ? `${formatPhone(officeRaw)}${ext ? ` Ext. ${ext}` : ''}` : '';
  const directRaw = (input.directPhone || '').trim();
  const address = escapeHtml(input.address || AGENT_ADDRESS_DEFAULT);
  const siteUrl = input.websiteUrl || AGENT_WEBSITE_URL;
  const saveContactUrl = buildSaveContactUrl(input);

  const officeCell = officeRaw
    ? contactBits(
        ICONS.phone,
        'Office',
        `${fontLink(telHref(officeRaw), escapeHtml(officeLabel), 12)}<br>${fontText('Office', 11)}`,
      )
    : '';
  const directCell = directRaw
    ? contactBits(
        ICONS.phone,
        'Direct',
        `${fontLink(telHref(directRaw), escapeHtml(formatPhone(directRaw)), 12)}<br>${fontText('Direct', 11)}`,
      )
    : '';
  const emailCell = contactBits(
    ICONS.email,
    'Email',
    fontLink(`mailto:${emailRaw}`, email, 12),
  );
  const webCell = contactBits(
    ICONS.website,
    'Website',
    fontLink(siteUrl, 'AO Globe Life Website', 12),
  );
  const addressCell = contactBits(ICONS.pin, 'Address', fontText(address, 12));

  const phoneRow =
    officeCell && directCell
      ? pairRow(officeCell, directCell)
      : fullRow(officeCell || directCell);
  const webRow = pairRow(emailCell, webCell);

  return `<table cellpadding="0" cellspacing="0" border="0" width="480" style="width:100%;max-width:480px;border-collapse:collapse;">
  <tr>
    <td width="104" valign="top" style="width:104px;padding:2px 8px 0 0;">
      <img src="${SIGNATURE_MARK_URL}" width="${SIGNATURE_MARK_WIDTH}" height="${SIGNATURE_MARK_HEIGHT}" alt="AO Globe Life" style="display:block;border:0;width:${SIGNATURE_MARK_WIDTH}px;height:${SIGNATURE_MARK_HEIGHT}px;" />
    </td>
    <td valign="top">
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:0 0 1px 0;">${fontText(name, 18, true)}</td></tr>
        <tr><td>${fontText(title, 12)}</td></tr>
        <tr><td style="padding:1px 0 0 0;">${fontText(team, 12)}</td></tr>
        <tr><td style="padding:1px 0 0 0;">${fontText(tagline, 12)}</td></tr>
        ${greenRule()}
        <tr><td>
          <table cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;">
            ${phoneRow}
            ${webRow}
            ${fullRow(addressCell)}
          </table>
        </td></tr>
        ${greenRule()}
        <tr><td>
          <table cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;">
            <tr>
              <td valign="middle">
                <table cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    ${socialCells(input)}
                  </tr>
                </table>
              </td>
              <td valign="middle" align="right">
                <table cellpadding="0" cellspacing="0" border="0" align="right">
                  <tr>
                    <td bgcolor="${SIGNATURE_GREEN}" style="background-color:${SIGNATURE_GREEN};padding:8px 12px;border-radius:8px;">
                      <a href="${escapeHtml(saveContactUrl)}" style="text-decoration:none;">${fontText('Save contact', 13, true)}</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td></tr>
      </table>
    </td>
  </tr>
  <tr>
    <td colspan="2" style="padding:12px 0 0 0;">
      ${confidentialityHtml(input.fullName.trim(), emailRaw)}
    </td>
  </tr>
</table>`;
}

export function alexPazSignatureInput(): AgentCardInput {
  return {
    fullName: 'Alex Paz',
    title: AGENT_TITLE_DEFAULT,
    teamLine: AGENT_TEAM_DEFAULT,
    tagline: AGENT_TAGLINE_DEFAULT,
    email: ALEX_PAZ_EMAIL,
    officePhone: AGENT_OFFICE_DEFAULT,
    officeExt: ALEX_PAZ_OFFICE_EXT,
    directPhone: ALEX_PAZ_DIRECT_PHONE,
    address: AGENT_ADDRESS_DEFAULT,
    websiteUrl: AGENT_WEBSITE_URL,
    logoUrl: SIGNATURE_MARK_URL,
    contactUrl: ALEX_PAZ_VCARD_URL,
  };
}

export function buildAlexPazSignatureCardHtml(): string {
  return buildAgentSignatureCardHtml(alexPazSignatureInput());
}

export function buildAgentSignaturePlainText(input: AgentCardInput): string {
  const name = input.fullName.trim();
  const title = (input.title || AGENT_TITLE_DEFAULT).trim();
  const team = (input.teamLine || AGENT_TEAM_DEFAULT).trim();
  const tagline = (input.tagline || AGENT_TAGLINE_DEFAULT).trim();
  const email = input.email.trim();
  const officeRaw = (input.officePhone || AGENT_OFFICE_DEFAULT).trim();
  const ext = (input.officeExt || '').trim();
  const directRaw = (input.directPhone || '').trim();
  const address = (input.address || AGENT_ADDRESS_DEFAULT).trim();
  const siteUrl = input.websiteUrl || AGENT_WEBSITE_URL;
  const lines = [name, title, team, tagline, ''];
  if (officeRaw) lines.push(`Office: ${formatPhone(officeRaw)}${ext ? ` Ext. ${ext}` : ''}`);
  if (directRaw) lines.push(`Direct: ${formatPhone(directRaw)}`);
  if (email) lines.push(`Email: ${email}`);
  lines.push(`Website: ${siteUrl}`, `Address: ${address}`, '');
  const source = input.socials ?? SOCIAL;
  const socials: Array<[string, string]> = [
    ['Instagram', source.instagram || ''],
    ['LinkedIn', source.linkedin || ''],
    ['Facebook', source.facebook || ''],
    ['YouTube', source.youtube || ''],
    ['TikTok', source.tiktok || ''],
  ];
  for (const [label, href] of socials) {
    const url = href.trim();
    if (url) lines.push(`${label}: ${url}`);
  }
  lines.push(`Save contact: ${buildSaveContactUrl(input)}`);
  lines.push('', buildConfidentialityStatement(name, email));
  return lines.join('\n');
}

export function buildStandaloneSignatureEmailHtml(cardHtml: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head><body bgcolor="#ffffff" style="margin:0;padding:16px;">${cardHtml}</body></html>`;
}

/** White page containing only the signature, for Chrome select-copy into Gmail settings. */
export function buildSignatureInstallHtml(cardHtml: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Signature</title></head><body bgcolor="#ffffff">${cardHtml}</body></html>`;
}

function stepRow(num: string, title: string, body: string): string {
  return `<tr>
    <td valign="top" width="56" style="padding:14px 12px 14px 0;">
      <div style="width:44px;height:44px;border-radius:22px;background:#0A2F5C;color:#ffffff;font-family:Georgia,Times,serif;font-size:16px;font-weight:700;line-height:44px;text-align:center;">${num}</div>
    </td>
    <td valign="top" style="padding:14px 0;border-bottom:1px solid #ece7dc;">
      <div style="font-size:16px;font-weight:700;color:#0A2F5C;margin:0 0 4px 0;">${title}</div>
      <div style="font-size:14px;line-height:1.5;color:#3f3a32;">${body}</div>
    </td>
  </tr>`;
}

function meetRow(name: string, when: string, access: string): string {
  return `<tr>
    <td valign="top" style="padding:10px 8px;border-bottom:1px solid #ece7dc;font-size:13px;font-weight:700;color:#0A2F5C;">${name}</td>
    <td valign="top" style="padding:10px 8px;border-bottom:1px solid #ece7dc;font-size:13px;color:#3f3a32;">${when}</td>
    <td valign="top" style="padding:10px 8px;border-bottom:1px solid #ece7dc;font-size:13px;color:#3f3a32;">${access}</td>
  </tr>`;
}

export type PortalLoginInfo = {
  loginUrl: string;
  email: string;
  agentCode: string;
  password?: string | null;
  alreadyHadAccess?: boolean;
};

export function defaultWelcomePackageHtml(
  firstName: string,
  portalLink?: string | null,
  login?: PortalLoginInfo | null,
  signature?: AgentCardInput | null,
): string {
  const first = escapeHtml(firstName || 'there');
  const loginUrl = escapeHtml(login?.loginUrl || portalLink || '');
  const agentCode = escapeHtml(login?.agentCode || '');
  const loginEmail = escapeHtml(login?.email || '');
  const password = login?.password ? escapeHtml(login.password) : '';
  const creds = login
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:18px 0 0 0;background:#f4f7fb;border:1px solid #d7e2ef;border-radius:12px;">
        <tr><td style="padding:16px 18px;">
          <p style="margin:0 0 8px 0;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6f675c;font-weight:700;">Your Team Paz portal</p>
          ${agentCode ? `<p style="margin:0 0 6px 0;font-size:14px;color:#1f2a24;"><strong>Agent ID:</strong> ${agentCode}</p>` : ''}
          ${loginEmail ? `<p style="margin:0 0 6px 0;font-size:14px;color:#1f2a24;"><strong>Email:</strong> ${loginEmail}</p>` : ''}
          ${
            password
              ? `<p style="margin:0 0 6px 0;font-size:14px;color:#1f2a24;"><strong>Temporary password:</strong> <span style="font-family:Consolas,Menlo,monospace;">${password}</span></p>
                 <p style="margin:0 0 10px 0;font-size:13px;color:#5a5348;">Sign in, then change this password under Account. Keep it private.</p>`
              : login.alreadyHadAccess
                ? `<p style="margin:0 0 10px 0;font-size:13px;color:#5a5348;">Use the same login you already have. You can change your password anytime under Account.</p>`
                : `<p style="margin:0 0 10px 0;font-size:13px;color:#5a5348;">Use the login details from your welcome message. You can change your password under Account after you sign in.</p>`
          }
          ${
            loginUrl
              ? `<p style="margin:0;"><a href="${loginUrl}" style="display:inline-block;background:#0A2F5C;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:999px;font-weight:700;font-size:13px;">Sign in to your portal</a></p>`
              : ''
          }
        </td></tr>
      </table>`
    : portalLink
      ? `<p style="margin:18px 0 0 0;"><a href="${escapeHtml(portalLink)}" style="display:inline-block;background:#0A2F5C;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:999px;font-weight:700;font-size:13px;">Sign in to your portal</a></p>`
      : '';
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f4f1ea;padding:0;margin:0;">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="640" style="max-width:640px;width:100%;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#1f2a24;">
      <tr>
        <td style="background:#0A2F5C;padding:22px 28px;">
          <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#d4c4a0;">AO Globe Life</div>
          <div style="font-size:20px;font-weight:700;color:#ffffff;margin-top:6px;">AO Globe Life • Team Paz</div>
        </td>
      </tr>
      <tr>
        <td style="padding:28px 28px 8px 28px;">
          <div style="font-family:Georgia,Times,serif;font-size:28px;line-height:1.25;color:#0A2F5C;font-weight:700;">Welcome to AO Globe Life, ${first}.</div>
          <p style="margin:14px 0 0 0;font-size:15px;line-height:1.6;color:#3f3a32;">You are officially beginning your launch with AO. The priority now is simple: follow the system, and move through licensing with urgency.</p>
          <p style="margin:12px 0 0 0;font-size:15px;font-weight:700;color:#0A2F5C;">Ready to serve clients and build your business.</p>
        </td>
      </tr>
      <tr>
        <td style="padding:8px 28px 0 28px;font-size:15px;line-height:1.65;color:#3f3a32;">
          <p style="margin:0 0 12px 0;">Congratulations and welcome to AO Globe Life and Team Paz. We are excited to support you as you begin your licensing journey and prepare to build a business through AO's proven systems.</p>
          <p style="margin:0 0 12px 0;"><strong>Your AO Globe Life New Agent Welcome Guide is attached.</strong> Please review it today. It outlines your first steps, the licensing process, the AO support rhythm, and the expectations for new builders.</p>
          <p style="margin:0 0 12px 0;">Your path is <strong>AO-first</strong>, supported by Team Paz.</p>
          <p style="margin:0;">Globe Life Inc. is the parent company, AO Globe Life is the platform you are joining, and Team Paz is here to help you plug into the process, stay accountable, and move quickly from licensing to production. American Income Life Insurance Company remains the underwriting company for policies sold through AO Globe Life.</p>
        </td>
      </tr>
      <tr>
        <td style="padding:18px 28px 8px 28px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            ${stepRow('01', 'Get set up', 'Verify AO Planet, join Slack, complete the Agent Onboarding Kit, and save the required meetings.')}
            ${stepRow('02', 'Get licensed', 'Complete certification, book and pass provincial exams, complete background check, and submit licensing.')}
            ${stepRow('03', 'Build', 'Attend training, serve clients, recruit builders, and start building your business with consistency.')}
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:18px 28px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#fbf8f2;border-left:4px solid #B8954A;">
            <tr><td style="padding:18px 18px 8px 18px;font-size:16px;font-weight:700;color:#0A2F5C;">Complete these steps today</td></tr>
            <tr><td style="padding:0 18px 18px 18px;font-size:14px;line-height:1.65;color:#3f3a32;">
              <p style="margin:0 0 10px 0;"><strong>Confirm your pre-licensing course enrollment.</strong><br/>Use the current AO-provided REMIC HLLQP link or access your account here: <a href="https://shop.remic.ca/my-account/" style="color:#005EB8;">https://shop.remic.ca/my-account/</a></p>
              <p style="margin:0 0 10px 0;"><strong>Start certification immediately.</strong><br/>Complete at least one focused 90-minute study block today so you build momentum from day one.</p>
              <p style="margin:0 0 10px 0;"><strong>Verify your AO Planet account.</strong><br/>Check your inbox for the verification email from <a href="mailto:recruiting@aoglobelife.com" style="color:#005EB8;">recruiting@aoglobelife.com</a>. If you do not see it, check spam or junk.</p>
              <p style="margin:0 0 10px 0;"><strong>Join the AO Nation Slack workspace.</strong><br/>Accept the invitation from no-reply@slack.com and monitor the appropriate channels for announcements, links, and daily updates.</p>
              <p style="margin:0 0 10px 0;"><strong>Complete your Agent Onboarding Kit.</strong><br/>Set aside 20-25 minutes to complete the required onboarding paperwork and appointment documents. Watch for the subject line: <em>Globe Life: American Income Division Agent Appointment Invitation</em>.</p>
              <p style="margin:0;"><strong>Add the AO meetings to your calendar.</strong><br/>Show up at least 5 minutes early, be seated, and be ready to take notes.</p>
              <p style="margin:12px 0 0 0;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#8a8276;">REMIC Course Access · Business Builders Forum · Canadian LLQP Requirements</p>
            </td></tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:0 28px 8px 28px;font-size:16px;font-weight:700;color:#0A2F5C;">Your AO support rhythm</td>
      </tr>
      <tr>
        <td style="padding:0 28px 18px 28px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid #ece7dc;">
            <tr style="background:#0A2F5C;color:#ffffff;">
              <td style="padding:10px 8px;font-size:12px;font-weight:700;">Meeting</td>
              <td style="padding:10px 8px;font-size:12px;font-weight:700;">When</td>
              <td style="padding:10px 8px;font-size:12px;font-weight:700;">Link / Access</td>
            </tr>
            ${meetRow('Career Meeting', '—', 'See current AO onboarding email / Slack')}
            ${meetRow('HLLQP Study Help &amp; Support', 'Mon/Wed/Fri', 'AO Nation Zoom Office<br/>Meeting ID: 403 836 9488<br/>Password: Winning<br/>Breakout:')}
            ${meetRow('Business Builders Forum', 'Every Monday<br/>2:00 PM EST', '<a href="https://www.planetaltig.com/sales-calls" style="color:#005EB8;">https://www.planetaltig.com/sales-calls</a>')}
            ${meetRow('All Agency Meeting', 'Every Thursday<br/>2:00 PM EST', 'Also check Slack #announcements every Thursday morning.')}
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:0 28px 8px 28px;font-size:16px;font-weight:700;color:#0A2F5C;">The standard</td>
      </tr>
      <tr>
        <td style="padding:0 28px 18px 28px;font-size:15px;line-height:1.65;color:#3f3a32;">
          <p style="margin:0 0 12px 0;">Your licensing path is straightforward: complete certification, book and pass your provincial exams, complete the background check where required, and finalize your licensing application and fee. Delays in this process delay your ability to earn, serve clients, recruit builders, and build your business.</p>
          <p style="margin:0 0 12px 0;"><strong>Daily communication standard:</strong> send your manager or pipeline manager what you completed today, what challenges came up, and your plan for tomorrow. What gets scheduled gets done.</p>
          <p style="margin:0;">If you need help with any item above, reach out right away. AO provides the system, training, and support, but your progress will depend on urgency, consistency, and follow-through.</p>
          <p style="margin:18px 0 0 0;font-family:Georgia,Times,serif;font-size:18px;color:#0A2F5C;font-weight:700;">AO Let's Grow!</p>
        </td>
      </tr>
      <tr>
        <td style="padding:12px 28px 8px 28px;">
          ${signature ? buildAgentSignatureCardHtml(signature) : buildAlexPazSignatureCardHtml()}
        </td>
      </tr>
      <tr>
        <td style="padding:8px 28px 22px 28px;">
          <p style="margin:0;font-size:13px;color:#5a5348;"><strong>Attachment:</strong> AO Globe Life New Agent Welcome Guide</p>
          ${creds}
        </td>
      </tr>
      <tr>
        <td style="background:#f7f3eb;padding:16px 28px;font-size:11px;line-height:1.5;color:#6f675c;">
          American Income Life Insurance Company remains the underwriting company for policies sold through AO Globe Life.
        </td>
      </tr>
    </table>
  </td></tr>
</table>`.trim();
}

export function buildSignatureSetupEmailHtml(input: AgentCardInput): string {
  const first = escapeHtml(input.fullName.trim().split(/\s+/)[0] || 'there');
  const card = buildAgentSignatureCardHtml(input);
  const contactUrl = escapeHtml(input.contactUrl);
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;max-width:520px;font-family:Arial,Helvetica,sans-serif;color:#1f2937;font-size:15px;line-height:1.5;">
  <tr><td style="padding:0;">
    <p>Hi ${first},</p>
    <p>Here is your <strong>AO Globe Life</strong> email signature. Paste the card below into Gmail (Settings → See all settings → Signature) or Outlook. You can also open the attached HTML file and copy from there.</p>
    <p style="word-break:break-all;">View my contact details here: <a href="${contactUrl}">${contactUrl}</a></p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;margin:16px 0;border:1px solid #e5e7eb;">
      <tr><td style="padding:12px;">
      ${card}
      </td></tr>
    </table>
    <p style="font-size:13px;color:#4b5563;">Tip: in Gmail, paste with original formatting so the logo and buttons stay intact.</p>
  </td></tr>
</table>`.trim();
}

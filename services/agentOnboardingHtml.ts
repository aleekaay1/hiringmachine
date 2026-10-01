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

export function defaultWelcomePackageHtml(firstName: string, portalLink?: string | null): string {
  const first = escapeHtml(firstName || 'there');
  const portal = portalLink
    ? `<p style="margin:18px 0 0 0;"><a href="${escapeHtml(portalLink)}" style="display:inline-block;background:#0A2F5C;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:999px;font-weight:700;font-size:13px;">Open the hiring portal</a></p>
       <p style="margin:8px 0 0 0;font-size:13px;color:#5a5348;">Use this to set your password and track your candidates.</p>`
    : '';
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f4f1ea;padding:0;margin:0;">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="640" style="max-width:640px;width:100%;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#1f2a24;">
      <tr>
        <td style="background:#0A2F5C;padding:22px 28px;">
          <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#d4c4a0;">AO Globe Life</div>
          <div style="font-size:20px;font-weight:700;color:#ffffff;margin-top:6px;">AO Globe Life • Paz Team</div>
        </td>
      </tr>
      <tr>
        <td style="padding:28px 28px 8px 28px;">
          <div style="font-family:Georgia,Times,serif;font-size:28px;line-height:1.25;color:#0A2F5C;font-weight:700;">Welcome to AO Globe Life, ${first}.</div>
          <p style="margin:14px 0 0 0;font-size:15px;line-height:1.6;color:#3f3a32;">You are officially beginning your launch with AO. The priority now is simple: follow the system, move through licensing with urgency, and get ready to serve clients and build your business.</p>
          <p style="margin:12px 0 0 0;font-size:15px;font-weight:700;color:#0A2F5C;">Ready to serve clients and build your business.</p>
        </td>
      </tr>
      <tr>
        <td style="padding:8px 28px 0 28px;font-size:15px;line-height:1.65;color:#3f3a32;">
          <p style="margin:0 0 12px 0;">Hi ${first},</p>
          <p style="margin:0 0 12px 0;">Congratulations and welcome to AO Globe Life and the Paz Team. We are excited to support you as you begin your licensing journey and prepare to build a business through AO's proven systems.</p>
          <p style="margin:0 0 12px 0;"><strong>Your AO Globe Life New Agent Welcome Guide is attached.</strong> Please review it today. It outlines your first steps, the licensing process, the AO support rhythm, and the expectations for new builders.</p>
          <p style="margin:0 0 12px 0;">Your path is <strong>AO-first</strong>, supported by the Paz Team.</p>
          <p style="margin:0;">Globe Life Inc. is the parent company, AO Globe Life is the platform you are joining, and the Paz Team is here to help you plug into the process, stay accountable, and move quickly from licensing to production. American Income Life Insurance Company remains the underwriting company for policies sold through AO Globe Life.</p>
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
        <td style="padding:8px 28px 8px 28px;font-size:15px;line-height:1.55;color:#1f2a24;">
          Best regards,<br/>
          <strong>Alex Paz</strong><br/>
          Life Insurance Agent<br/>
          Paz Team • AO Globe Life
        </td>
      </tr>
      <tr>
        <td style="padding:8px 28px 22px 28px;">
          <p style="margin:0;font-size:13px;color:#5a5348;"><strong>Attachment:</strong> AO Globe Life New Agent Welcome Guide</p>
          ${portal}
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

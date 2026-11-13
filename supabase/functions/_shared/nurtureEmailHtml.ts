/**
 * Nurture email HTML: tokens, Vimeo thumbnail link, signature slot.
 * Keep in sync with services/nurtureEmailHtml.ts.
 */

export type NurturePerson = {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
};

export type ParsedVimeo = {
  videoId: string;
  hash: string | null;
  watchUrl: string;
  thumbnailUrl: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function tokenValue(person: NurturePerson, key: 'first' | 'last' | 'email'): string {
  if (key === 'first') return (person.firstName || '').trim() || 'there';
  if (key === 'last') return (person.lastName || '').trim();
  return (person.email || '').trim();
}

export function applyNurtureTokens(input: string, person: NurturePerson, html: boolean): string {
  const rawFor = (key: 'first' | 'last' | 'email') => {
    const raw = tokenValue(person, key);
    return html ? escapeHtml(raw) : raw;
  };
  return input
    .replace(/\{\{\s*first_name\s*\}\}/gi, () => rawFor('first'))
    .replace(/\{\{\s*last_name\s*\}\}/gi, () => rawFor('last'))
    .replace(/\{\{\s*email\s*\}\}/gi, () => rawFor('email'));
}

/** Vimeo id, vimeo.com/id, vimeo.com/id/hash, or player.vimeo.com/video/id?h=hash. */
export function parseVimeoRef(raw: string): ParsedVimeo | null {
  const input = raw.trim();
  if (!input) return null;
  if (/^\d{6,12}$/.test(input)) {
    return {
      videoId: input,
      hash: null,
      watchUrl: `https://vimeo.com/${input}`,
      thumbnailUrl: `https://vumbnail.com/${input}.jpg`,
    };
  }
  let url: URL;
  try {
    url = new URL(input.startsWith('http') ? input : `https://${input}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  if (host !== 'vimeo.com' && host !== 'player.vimeo.com') return null;
  const parts = url.pathname.split('/').filter(Boolean);
  let videoId = '';
  let hash: string | null = null;
  if (parts[0] === 'video' && parts[1] && /^\d{6,12}$/.test(parts[1])) {
    videoId = parts[1];
  } else if (parts[0] && /^\d{6,12}$/.test(parts[0])) {
    videoId = parts[0];
    if (parts[1] && /^[A-Za-z0-9]+$/.test(parts[1])) hash = parts[1];
  }
  const queryHash = url.searchParams.get('h');
  if (queryHash && /^[A-Za-z0-9]+$/.test(queryHash)) hash = queryHash;
  if (!videoId) return null;
  const watchUrl = hash ? `https://vimeo.com/${videoId}/${hash}` : `https://vimeo.com/${videoId}`;
  return {
    videoId,
    hash,
    watchUrl,
    thumbnailUrl: `https://vumbnail.com/${videoId}.jpg`,
  };
}

/** Clickable thumbnail plus a text link. Email clients drop iframes, so this is the send format. */
export function vimeoEmailBlock(raw: string): string {
  const parsed = parseVimeoRef(raw);
  if (!parsed) return '';
  const href = escapeHtml(parsed.watchUrl);
  const thumb = escapeHtml(parsed.thumbnailUrl);
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0;font-family:Arial,Helvetica,sans-serif;">
  <tr>
    <td>
      <a href="${href}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;">
        <img src="${thumb}" width="480" alt="Watch video" style="display:block;width:100%;max-width:480px;height:auto;border:0;border-radius:8px;background:#0f172a;" />
      </a>
    </td>
  </tr>
  <tr>
    <td style="padding-top:10px;">
      <a href="${href}" target="_blank" rel="noopener noreferrer"
        style="display:inline-block;padding:12px 18px;background-color:#005EB8;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:bold;">
        Watch video
      </a>
    </td>
  </tr>
</table>`.trim();
}

export function nurtureHtmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>[\s\S]*?<\/a>/gi, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function assembleNurtureHtml(input: {
  bodyHtml: string;
  vimeoUrl: string;
  signatureHtml: string;
  person: NurturePerson;
}): string {
  const body = applyNurtureTokens(input.bodyHtml.trim(), input.person, true);
  const video = vimeoEmailBlock(input.vimeoUrl.trim());
  const signature = input.signatureHtml.trim();
  const fullDoc = /<\s*(html|body)\b/i.test(body);
  const inner = [body, video].filter(Boolean).join('\n');
  const wrapped = fullDoc || !inner
    ? inner
    : `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1f2937;">${inner}</div>`;
  return [wrapped, signature].filter(Boolean).join('\n');
}

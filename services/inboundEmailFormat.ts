/**
 * Turn raw IMAP/plain snippets into readable preview + optional quoted thread (for UI).
 */

const REPLY_SPLIT_PATTERNS: RegExp[] = [
  /\r?\nOn .{8,200}?wrote:\s*\r?\n/i,
  /\r?\n-{2,}\s*Original Message\s*-{2,}\s*\r?\n/i,
  /\r?\nFrom:\s*.+\r?\n(?:Sent|Date|To):\s*.+\r?\n/i,
  /\r?\n________________________________\r?\n/i,
  /\r?\nLe .{6,120} a écrit\s*:\s*\r?\n/i,
];

/** Normalize spaces; keep paragraph breaks. */
export function normalizeInboundWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * Split snippet into "what they wrote now" vs quoted thread / forwarded block.
 */
export function splitInboundSnippet(snippet: string | null | undefined): {
  latest: string;
  quoted: string | null;
} {
  const raw = String(snippet || '').trim();
  if (!raw) return { latest: '', quoted: null };

  let cut = -1;
  for (const re of REPLY_SPLIT_PATTERNS) {
    const m = re.exec(raw);
    if (m && m.index !== undefined && m.index > 8) {
      cut = cut === -1 ? m.index : Math.min(cut, m.index);
    }
  }

  if (cut > 0) {
    const latest = normalizeInboundWhitespace(raw.slice(0, cut));
    const quoted = normalizeInboundWhitespace(raw.slice(cut));
    return {
      latest: latest || normalizeInboundWhitespace(raw),
      quoted: quoted.length > 40 ? quoted : null,
    };
  }

  return { latest: normalizeInboundWhitespace(raw), quoted: null };
}

/** Strip common "Re: Re:" noise for display only. */
export function cleanSubjectForDisplay(subject: string | null | undefined): string {
  const s = String(subject || '').trim();
  if (!s) return '(No subject)';
  return s.replace(/^(Re:\s*)+/i, 'Re: ').trim();
}

/** Subject line for a reply. */
export function subjectForReply(subject: string | null | undefined): string {
  const s = String(subject || '').trim();
  if (!s) return 'Re: (no subject)';
  if (/^re:\s*/i.test(s)) return s;
  return `Re: ${s}`;
}

/** Ensure RFC5322 Message-ID form for In-Reply-To. */
export function normalizeMessageIdForHeader(messageId: string | null | undefined): string | null {
  const m = String(messageId || '').trim();
  if (!m) return null;
  if (m.startsWith('<') && m.endsWith('>')) return m;
  return `<${m.replace(/^<|>$/g, '')}>`;
}

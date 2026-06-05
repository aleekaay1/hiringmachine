/**
 * WebinarGeek custom registration link tags: cooper_{slug} / rms_{slug}.
 * Shared by integrations-webinar-geek edge function.
 */

export const BOOKING_LINK_CHANNELS = ['cooper', 'rms'] as const;
export type BookingLinkChannel = (typeof BOOKING_LINK_CHANNELS)[number];

export type ParsedBookingLinkTag = {
  tag: string;
  channel: BookingLinkChannel;
  slug: string;
  slugKey: string;
  label: string;
};

function normalizeIdentityToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function splitIdentityWords(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2);
}

export function buildRecruiterScopeTokens(email: string | null, fullName: string | null): Set<string> {
  const tokens = new Set<string>();
  const add = (raw: string) => {
    const token = normalizeIdentityToken(raw);
    if (token) tokens.add(token);
  };
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const localPart = normalizedEmail.split('@')[0] || '';
  add(normalizedEmail);
  add(localPart);
  add(localPart.replace(/[._-]+/g, ' '));
  add(localPart.replace(/[._-]+/g, ''));
  const name = String(fullName || '').trim().toLowerCase();
  add(name);
  add(name.replace(/\s+/g, ''));
  for (const word of splitIdentityWords(localPart)) add(word);
  for (const word of splitIdentityWords(name)) add(word);
  return tokens;
}

export function recruiterOwnsNameKey(nameKey: string | null, tokens: Set<string>): boolean {
  if (!nameKey || tokens.size === 0) return false;
  const normalized = normalizeIdentityToken(nameKey);
  if (!normalized) return false;
  if (tokens.has(normalized)) return true;

  const words = splitIdentityWords(nameKey);
  if (words.length > 0) {
    const matchedWords = words.reduce((count, word) => (tokens.has(normalizeIdentityToken(word)) ? count + 1 : count), 0);
    if (matchedWords >= 2) return true;
    if (matchedWords >= 1 && words.length === 1 && words[0].length >= 5) return true;
  }

  for (const token of tokens) {
    if (token.length < 6) continue;
    if (normalized.includes(token) || token.includes(normalized)) return true;
  }
  return false;
}

function titleCaseSlug(slug: string): string {
  return slug
    .split(/[_\-\s]+/g)
    .filter(Boolean)
    .map((part) => {
      if (part.length <= 2) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(' ');
}

export function channelDisplay(channel: BookingLinkChannel): string {
  return channel === 'rms' ? 'RMS' : 'Cooper';
}

export function formatBookingLinkLabel(channel: BookingLinkChannel, slug: string): string {
  return `${channelDisplay(channel)} · ${titleCaseSlug(slug)}`;
}

export function parseBookingLinkTag(raw: string | null | undefined): ParsedBookingLinkTag | null {
  const tag = String(raw ?? '').trim();
  if (!tag || tag.toLowerCase() === 'registration_page') return null;
  const match = tag.match(/^(cooper|rms)[_\-\s]+([a-z0-9][a-z0-9_\-\s]*)$/i);
  if (!match) return null;
  const channel = match[1].toLowerCase() as BookingLinkChannel;
  if (!BOOKING_LINK_CHANNELS.includes(channel)) return null;
  const slug = match[2].trim().toLowerCase().replace(/\s+/g, '_');
  if (!slug) return null;
  const slugKey = slug.replace(/_/g, ' ');
  return {
    tag: `${channel}_${slug}`,
    channel,
    slug,
    slugKey,
    label: formatBookingLinkLabel(channel, slug),
  };
}

export function isBookingLinkTag(raw: string | null | undefined): boolean {
  return parseBookingLinkTag(raw) != null;
}

/** Slugs used to build cooper_/rms_ registration link tags for a recruiter account. */
export function primaryRecruiterLinkSlugs(email: string | null, fullName: string | null): string[] {
  const slugs = new Set<string>();
  const localPart = String(email || '').trim().toLowerCase().split('@')[0] || '';
  for (const part of localPart.split(/[._-]+/g)) {
    const p = part.trim();
    if (p.length >= 3) slugs.add(p);
  }
  const nameParts = String(fullName || '')
    .trim()
    .toLowerCase()
    .split(/\s+/g)
    .filter(Boolean);
  if (nameParts[0] && nameParts[0].length >= 3) slugs.add(nameParts[0]);
  if (nameParts.length >= 2) {
    slugs.add(`${nameParts[0]}_${nameParts[1]}`);
  }
  return [...slugs];
}

export function suggestedBookingLinkTags(email: string | null, fullName: string | null): string[] {
  const tokens = buildRecruiterScopeTokens(email, fullName);
  const tags = new Set<string>();
  for (const slug of primaryRecruiterLinkSlugs(email, fullName)) {
    if (!recruiterOwnsNameKey(slug.replace(/_/g, ' '), tokens)) continue;
    for (const channel of BOOKING_LINK_CHANNELS) {
      tags.add(`${channel}_${slug}`);
    }
  }
  return [...tags];
}

export type BookingIdentityOption = {
  tag: string;
  channel: BookingLinkChannel;
  slug: string;
  label: string;
  source: 'observed' | 'suggested' | 'settings';
};

export function buildBookingIdentitiesForUser(input: {
  email: string | null;
  fullName: string | null;
  observedTags: string[];
  settingsTag?: string | null;
}): BookingIdentityOption[] {
  const tokens = buildRecruiterScopeTokens(input.email, input.fullName);
  const byTag = new Map<string, BookingIdentityOption>();

  const add = (raw: string, source: BookingIdentityOption['source']) => {
    const parsed = parseBookingLinkTag(raw);
    if (!parsed) return;
    if (!recruiterOwnsNameKey(parsed.slugKey, tokens)) return;
    const existing = byTag.get(parsed.tag);
    if (!existing || source === 'observed' || (source === 'settings' && existing.source === 'suggested')) {
      byTag.set(parsed.tag, {
        tag: parsed.tag,
        channel: parsed.channel,
        slug: parsed.slug,
        label: parsed.label,
        source,
      });
    }
  };

  for (const tag of input.observedTags) add(tag, 'observed');
  for (const tag of suggestedBookingLinkTags(input.email, input.fullName)) add(tag, 'suggested');
  if (input.settingsTag) add(input.settingsTag, 'settings');

  return [...byTag.values()].sort((a, b) => {
    if (a.channel !== b.channel) return a.channel.localeCompare(b.channel);
    return a.label.localeCompare(b.label);
  });
}

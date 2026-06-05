/**
 * WebinarGeek custom registration link tags: cooper_{slug} / rms_{slug}.
 * Match slugs to recruiters by first name (not email local-part segments).
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

/** First name token used to match cooper_/rms_ link slugs. */
export function bookingLinkFirstNameToken(fullName: string | null, email: string | null): string | null {
  const nameParts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (nameParts[0] && nameParts[0].length >= 2) {
    return normalizeIdentityToken(nameParts[0]);
  }
  const localPart = String(email || '').trim().toLowerCase().split('@')[0] || '';
  const firstSegment = localPart.split(/[._-]+/)[0]?.trim() || '';
  if (firstSegment.length >= 2) return normalizeIdentityToken(firstSegment);
  return null;
}

/** Raw slug fragment for suggested tags, e.g. hassaan from "Hassaan Khalid". */
export function bookingLinkFirstNameSlug(fullName: string | null, email: string | null): string | null {
  const nameParts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (nameParts[0] && nameParts[0].length >= 2) {
    return nameParts[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  }
  const localPart = String(email || '').trim().toLowerCase().split('@')[0] || '';
  const firstSegment = localPart.split(/[._-]+/)[0]?.trim() || '';
  return firstSegment.length >= 2 ? firstSegment.replace(/[^a-z0-9]+/g, '') : null;
}

export function recruiterOwnsBookingLinkSlug(
  slugKey: string | null,
  fullName: string | null,
  email: string | null,
): boolean {
  const firstName = bookingLinkFirstNameToken(fullName, email);
  if (!firstName || !slugKey) return false;

  const slugParts = splitIdentityWords(slugKey.replace(/_/g, ' '));
  if (!slugParts.length) return false;

  // Single-token slugs (cooper_hassaan) must match first name exactly.
  if (slugParts.length === 1) {
    return normalizeIdentityToken(slugParts[0]) === firstName;
  }

  // Multi-part slugs must start with the recruiter first name; ignore trailing segments.
  return normalizeIdentityToken(slugParts[0]) === firstName;
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

export function suggestedBookingLinkTags(email: string | null, fullName: string | null): string[] {
  const slug = bookingLinkFirstNameSlug(fullName, email);
  if (!slug) return [];
  return BOOKING_LINK_CHANNELS.map((channel) => `${channel}_${slug}`);
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
  const byTag = new Map<string, BookingIdentityOption>();

  const add = (raw: string, source: BookingIdentityOption['source']) => {
    const parsed = parseBookingLinkTag(raw);
    if (!parsed) return;
    if (!recruiterOwnsBookingLinkSlug(parsed.slugKey, input.fullName, input.email)) return;
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

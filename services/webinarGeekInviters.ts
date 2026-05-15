/**
 * Parse WebinarGeek custom_field values shaped like resume uploads: `{inviter}_{candidateName}`.
 * Only `cooper` and `rms` count as inviters — no legacy UTM/referrer fields, no "unattributed" bucket.
 */

export const INVITER_FILE_PREFIXES = ['cooper', 'rms'] as const;
export type InviterFilePrefix = (typeof INVITER_FILE_PREFIXES)[number];

export type ParsedInviterAttribution = {
  /** Lowercase slug from filename prefix, e.g. cooper | rms */
  inviterSlug: string | null;
  /** Human label for the inviter chip, e.g. Cooper | RMS */
  inviterDisplay: string;
  /** Candidate / invitee label from filename tail (underscores → spaces) */
  inviteeLabel: string | null;
  /** Raw custom_field string */
  raw: string;
};

export type InviterWatchStats = {
  scheduled: number;
  watchedYes: number;
  full: number;
  half: number;
  notYet: number;
};

export type InviterProfile = InviterWatchStats & {
  slug: string;
  displayName: string;
};

type AnyRow = Record<string, unknown>;

const INVITER_SLUG_RE = /^[a-z]{2,20}$/;

function slugToDisplay(slug: string): string {
  const s = slug.trim().toLowerCase();
  if (!s) return '';
  if (s === 'rms') return 'RMS';
  if (s === 'cooper') return 'Cooper';
  if (s.length <= 3) return s.toUpperCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function isKnownInviterPrefix(prefix: string): prefix is InviterFilePrefix {
  const p = prefix.trim().toLowerCase();
  return INVITER_SLUG_RE.test(p) && (INVITER_FILE_PREFIXES as readonly string[]).includes(p);
}

const RESUME_EXT_RE = /\.(pdf|docx?|rtf|txt|png|jpe?g|webp)$/i;

/** `john_smith` → `John Smith`; strips resume extension if present. */
export function formatInviteeNameFromFileTail(tail: string): string {
  const cleaned = String(tail ?? '')
    .trim()
    .replace(RESUME_EXT_RE, '')
    .replace(/[^a-zA-Z0-9\s'-]/g, ' ')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  return cleaned
    .split(' ')
    .map((w) => {
      const t = w.trim();
      if (!t) return '';
      if (t.length <= 2) return t.toUpperCase();
      return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
    })
    .filter(Boolean)
    .join(' ');
}

/**
 * Parse only `custom_field` values: `cooper_*`, `rms_*`, or bare `cooper` / `rms`.
 * Does not treat random strings, emails, or UTM values as inviters.
 */
export function parseInviterCustomField(raw: string | null | undefined): ParsedInviterAttribution | null {
  const s = String(raw ?? '').trim();
  if (!s || s.toLowerCase() === 'registration_page') return null;

  const lower = s.toLowerCase();
  if (isKnownInviterPrefix(lower)) {
    return {
      inviterSlug: lower,
      inviterDisplay: slugToDisplay(lower),
      inviteeLabel: null,
      raw: s,
    };
  }

  const idx = s.indexOf('_');
  if (idx <= 0) {
    return { inviterSlug: null, inviterDisplay: '', inviteeLabel: null, raw: s };
  }

  const prefix = s.slice(0, idx).trim().toLowerCase();
  if (!INVITER_SLUG_RE.test(prefix) || !isKnownInviterPrefix(prefix)) {
    return { inviterSlug: null, inviterDisplay: '', inviteeLabel: null, raw: s };
  }

  const tail = s.slice(idx + 1).trim();
  const inviteeLabel = tail ? formatInviteeNameFromFileTail(tail) || null : null;

  return {
    inviterSlug: prefix,
    inviterDisplay: slugToDisplay(prefix),
    inviteeLabel,
    raw: s,
  };
}

/** Inviter = cooper | rms from custom_field only (never legacy referrer/UTM fields). */
export function getInviterAttributionFromRow(row: AnyRow): ParsedInviterAttribution {
  const customRaw = String(row.custom_field ?? '').trim();
  const parsed = parseInviterCustomField(customRaw);
  if (parsed) return parsed;
  return { inviterSlug: null, inviterDisplay: '', inviteeLabel: null, raw: customRaw };
}

export function inviterSlugFromRow(row: AnyRow): InviterFilePrefix | null {
  const slug = getInviterAttributionFromRow(row).inviterSlug;
  if (slug && isKnownInviterPrefix(slug)) return slug;
  return null;
}

export function inviterDisplayFromRow(row: AnyRow): string {
  const slug = inviterSlugFromRow(row);
  return slug ? slugToDisplay(slug) : '—';
}

/** Candidate name from `cooper_*` / `rms_*` tail, else WebinarGeek registration name. */
export function candidateDisplayNameFromRow(row: AnyRow): string {
  const a = getInviterAttributionFromRow(row);
  if (a.inviteeLabel) return a.inviteeLabel;
  const wg = `${String(row.firstname ?? '').trim()} ${String(row.surname ?? '').trim()}`.trim();
  return wg;
}

export function inviteeLabelFromRow(row: AnyRow): string {
  return candidateDisplayNameFromRow(row);
}

export type WatchBucket = 'full' | 'half' | 'not_yet';

export function watchBucketFromSeconds(seconds: number): WatchBucket {
  const FULL = 45 * 60;
  const HALF = Math.floor(47 * 60 * 0.5);
  if (seconds >= FULL) return 'full';
  if (seconds >= HALF) return 'half';
  return 'not_yet';
}

export function emptyInviterStats(): InviterWatchStats {
  return { scheduled: 0, watchedYes: 0, full: 0, half: 0, notYet: 0 };
}

/** Stats for Cooper and RMS only (rows without `cooper_*` / `rms_*` custom_field are excluded). */
export function buildInviterProfiles(
  rows: AnyRow[],
  watchSeconds: (row: AnyRow) => number,
): InviterProfile[] {
  const map = new Map<string, InviterProfile>();

  for (const prefix of INVITER_FILE_PREFIXES) {
    map.set(prefix, { slug: prefix, displayName: slugToDisplay(prefix), ...emptyInviterStats() });
  }

  for (const row of rows) {
    const slug = inviterSlugFromRow(row);
    if (!slug) continue;

    const p = map.get(slug)!;
    p.scheduled += 1;
    if (row.watched === true) p.watchedYes += 1;
    const bucket = watchBucketFromSeconds(watchSeconds(row));
    if (bucket === 'full') p.full += 1;
    else if (bucket === 'half') p.half += 1;
    else p.notYet += 1;
  }

  return INVITER_FILE_PREFIXES.map((prefix) => map.get(prefix)!);
}

export function inviterInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

/** Rows that belong to a known inviter (for filter + counts). */
export function rowMatchesInviterSlug(row: AnyRow, slug: string): boolean {
  return inviterSlugFromRow(row) === slug;
}

/**
 * Parse WebinarGeek custom_field values shaped like resume uploads: `{inviter}_{candidateName}`.
 * Known team prefixes: cooper, rms (extend INVITER_FILE_PREFIXES as you add callers).
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
  /** Raw attribution string used for parsing */
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

function slugToDisplay(slug: string): string {
  const s = slug.trim().toLowerCase();
  if (!s) return 'Unknown';
  if (s === 'rms') return 'RMS';
  if (s.length <= 3) return s.toUpperCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function isKnownInviterPrefix(prefix: string): prefix is InviterFilePrefix {
  return (INVITER_FILE_PREFIXES as readonly string[]).includes(prefix.toLowerCase());
}

const RESUME_EXT_RE = /\.(pdf|docx?|rtf|txt|png|jpe?g|webp)$/i;

/** `john_smith` → `John Smith`; strips resume extension if present. */
export function formatInviteeNameFromFileTail(tail: string): string {
  const cleaned = String(tail ?? '')
    .trim()
    .replace(RESUME_EXT_RE, '')
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
 * Split `cooper_john_smith` → inviter `cooper`, candidate name `John Smith` (everything after first `_`).
 */
export function parseInviterCustomField(raw: string | null | undefined): ParsedInviterAttribution | null {
  const s = String(raw ?? '').trim();
  if (!s || s.toLowerCase() === 'registration_page') return null;

  const idx = s.indexOf('_');
  if (idx <= 0) {
    return { inviterSlug: null, inviterDisplay: s, inviteeLabel: null, raw: s };
  }

  const prefix = s.slice(0, idx).trim().toLowerCase();
  const tail = s.slice(idx + 1).trim();
  const inviteeLabel = tail ? formatInviteeNameFromFileTail(tail) || null : null;

  if (isKnownInviterPrefix(prefix)) {
    return {
      inviterSlug: prefix,
      inviterDisplay: slugToDisplay(prefix),
      inviteeLabel,
      raw: s,
    };
  }

  return { inviterSlug: null, inviterDisplay: s, inviteeLabel, raw: s };
}

/** Prefer custom_field `cooper_*` / `rms_*`; fall back to other attribution fields with the same pattern. */
export function getInviterAttributionFromRow(row: AnyRow): ParsedInviterAttribution {
  const customRaw = String(row.custom_field ?? '').trim();
  const fromCustom = parseInviterCustomField(customRaw);
  if (fromCustom?.inviterSlug) return fromCustom;

  const legacy = pickLegacyInviterRaw(row);
  if (legacy && legacy !== customRaw) {
    const parsed = parseInviterCustomField(legacy);
    if (parsed?.inviterSlug) return parsed;
    if (parsed?.inviteeLabel) return parsed;
  }

  if (fromCustom?.inviteeLabel) {
    return { ...fromCustom, inviterDisplay: fromCustom.inviterDisplay || '—' };
  }

  if (legacy) {
    return { inviterSlug: null, inviterDisplay: legacy, inviteeLabel: null, raw: legacy };
  }

  return { inviterSlug: null, inviterDisplay: '', inviteeLabel: null, raw: '' };
}

function pickLegacyInviterRaw(row: AnyRow): string {
  const extraFields = row.extra_fields && typeof row.extra_fields === 'object'
    ? (row.extra_fields as AnyRow)
    : null;
  const options = [
    row.inviter_name,
    row.invited_by,
    row.invited_by_name,
    row.inviter_signal,
    row.utm_source,
    row.utm_term,
    row.utm_content,
    row.registration_page_name,
    row.referrer_name,
    row.affiliate_name,
  ];
  for (const option of options) {
    const s = String(option ?? '').trim();
    if (s && s.toLowerCase() !== 'registration_page') return s;
  }
  const source = String(row.registration_source ?? '').trim();
  if (source && source.toLowerCase() !== 'registration_page') return source;
  if (extraFields) {
    for (const v of Object.values(extraFields)) {
      const s = String(v ?? '').trim();
      if (s && s.toLowerCase() !== 'registration_page') return s;
    }
  }
  const custom = String(row.custom_field ?? '').trim();
  if (custom && custom.toLowerCase() !== 'registration_page') return custom;
  return '';
}

export function inviterSlugFromRow(row: AnyRow): string | null {
  return getInviterAttributionFromRow(row).inviterSlug;
}

export function inviterDisplayFromRow(row: AnyRow): string {
  const a = getInviterAttributionFromRow(row);
  return a.inviterDisplay || '—';
}

/** Candidate name from resume filename tail (`cooper_*` / `rms_*`), else WebinarGeek registration name. */
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

/** Aggregate inviter profiles from subscription rows (recomputed on every fetch / scope change). */
export function buildInviterProfiles(
  rows: AnyRow[],
  watchSeconds: (row: AnyRow) => number,
): InviterProfile[] {
  const map = new Map<string, InviterProfile>();

  for (const row of rows) {
    const attr = getInviterAttributionFromRow(row);
    const slug = attr.inviterSlug ?? '_unattributed';
    const displayName = attr.inviterSlug ? attr.inviterDisplay : 'Other / unattributed';

    if (!map.has(slug)) {
      map.set(slug, { slug, displayName, ...emptyInviterStats() });
    }
    const p = map.get(slug)!;
    p.scheduled += 1;
    if (row.watched === true) p.watchedYes += 1;
    const bucket = watchBucketFromSeconds(watchSeconds(row));
    if (bucket === 'full') p.full += 1;
    else if (bucket === 'half') p.half += 1;
    else p.notYet += 1;
  }

  return [...map.values()].sort((a, b) => {
    if (b.scheduled !== a.scheduled) return b.scheduled - a.scheduled;
    return a.displayName.localeCompare(b.displayName);
  });
}

export function inviterInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

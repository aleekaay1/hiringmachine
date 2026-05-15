/**
 * Parse WebinarGeek `custom_field` resume tags: `cooper_{candidateName}` / `rms_{candidateName}`.
 * UI filters group by **candidate name** (after prefix), not by cooper/rms.
 */

export const INVITER_FILE_PREFIXES = ['cooper', 'rms'] as const;
export type InviterFilePrefix = (typeof INVITER_FILE_PREFIXES)[number];

export type ParsedInviterAttribution = {
  /** cooper | rms when tag uses known prefix */
  inviterSlug: string | null;
  /** Candidate name from filename (after cooper_/rms_) */
  inviteeLabel: string | null;
  raw: string;
};

export type WatchStats = {
  scheduled: number;
  watchedYes: number;
  full: number;
  half: number;
  notYet: number;
};

/** One filter card per candidate name parsed from custom_field. */
export type CandidateNameProfile = WatchStats & {
  /** Normalized key for filter matching */
  key: string;
  displayName: string;
};

type AnyRow = Record<string, unknown>;

const INVITER_SLUG_RE = /^[a-z]{2,20}$/;

function isKnownInviterPrefix(prefix: string): prefix is InviterFilePrefix {
  const p = prefix.trim().toLowerCase();
  return INVITER_SLUG_RE.test(p) && (INVITER_FILE_PREFIXES as readonly string[]).includes(p);
}

const RESUME_EXT_RE = /\.(pdf|docx?|rtf|txt|png|jpe?g|webp)$/i;

/** `john_smith` → `John Smith`; strips resume extension and junk characters. */
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

export function normalizeNameKey(displayName: string): string {
  return displayName.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Parse `custom_field` only: strips `cooper_` / `rms_` prefix; returns candidate name in inviteeLabel.
 */
export function parseInviterCustomField(raw: string | null | undefined): ParsedInviterAttribution | null {
  const s = String(raw ?? '').trim();
  if (!s || s.toLowerCase() === 'registration_page') return null;

  const lower = s.toLowerCase();
  if (isKnownInviterPrefix(lower)) {
    return { inviterSlug: lower, inviteeLabel: null, raw: s };
  }

  const idx = s.indexOf('_');
  if (idx <= 0) {
    return { inviterSlug: null, inviteeLabel: null, raw: s };
  }

  const prefix = s.slice(0, idx).trim().toLowerCase();
  if (!INVITER_SLUG_RE.test(prefix) || !isKnownInviterPrefix(prefix)) {
    return { inviterSlug: null, inviteeLabel: null, raw: s };
  }

  const tail = s.slice(idx + 1).trim();
  const inviteeLabel = tail ? formatInviteeNameFromFileTail(tail) || null : null;

  return { inviterSlug: prefix, inviteeLabel, raw: s };
}

export function getInviterAttributionFromRow(row: AnyRow): ParsedInviterAttribution {
  const customRaw = String(row.custom_field ?? '').trim();
  const parsed = parseInviterCustomField(customRaw);
  if (parsed) return parsed;
  return { inviterSlug: null, inviteeLabel: null, raw: customRaw };
}

/** Normalized name key for filtering (null if no `cooper_*` / `rms_*` name in custom_field). */
export function nameKeyFromRow(row: AnyRow): string | null {
  const label = getInviterAttributionFromRow(row).inviteeLabel;
  if (!label) return null;
  return normalizeNameKey(label);
}

export function rowMatchesNameKey(row: AnyRow, key: string): boolean {
  const k = nameKeyFromRow(row);
  return k !== null && k === key;
}

/** Name from custom_field tag (after cooper_/rms_). */
export function fileTagNameFromRow(row: AnyRow): string {
  const label = getInviterAttributionFromRow(row).inviteeLabel;
  return label || '—';
}

/** cooper | rms | — (for optional caller column, not used as filters). */
export function callerSlugFromRow(row: AnyRow): InviterFilePrefix | null {
  const slug = getInviterAttributionFromRow(row).inviterSlug;
  if (slug && isKnownInviterPrefix(slug)) return slug;
  return null;
}

export function callerDisplayFromRow(row: AnyRow): string {
  return recruiterTeamFromRow(row);
}

/** Cooper / RMS channel from file prefix. */
export function recruiterTeamFromRow(row: AnyRow): string {
  const slug = callerSlugFromRow(row);
  if (slug === 'rms') return 'RMS';
  if (slug === 'cooper') return 'Cooper';
  return '—';
}

/** Recruiter name from custom_field (after cooper_/rms_). */
export function recruiterNameFromRow(row: AnyRow): string {
  return fileTagNameFromRow(row);
}

function unixMsFromField(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1e12 ? n : n * 1000;
}

/** When HR scheduled / invited (subscription created_at). */
export function hrScheduledMsFromRow(row: AnyRow): number | null {
  return unixMsFromField(row.created_at);
}

/** When the webinar session runs (broadcast date). */
export function webinarSessionMsFromRow(row: AnyRow): number | null {
  const broadcast = row.broadcast && typeof row.broadcast === 'object' ? (row.broadcast as AnyRow) : null;
  return unixMsFromField(broadcast?.date);
}

/** Person who registered (WebinarGeek first + last name). */
export function registrationDisplayNameFromRow(row: AnyRow): string {
  return `${String(row.firstname ?? '').trim()} ${String(row.surname ?? '').trim()}`.trim();
}

/** Table "Name" column: registrant only; falls back to file tag if WG name missing. */
export function candidateDisplayNameFromRow(row: AnyRow): string {
  const reg = registrationDisplayNameFromRow(row);
  if (reg) return reg;
  return fileTagNameFromRow(row) === '—' ? '' : fileTagNameFromRow(row);
}

/** Alias for file-tag search / filters (not the registrant). */
export function inviteeLabelFromRow(row: AnyRow): string {
  return fileTagNameFromRow(row);
}

export type WatchBucket = 'full' | 'half' | 'not_yet';

export function watchBucketFromSeconds(seconds: number): WatchBucket {
  const FULL = 45 * 60;
  const HALF = Math.floor(47 * 60 * 0.5);
  if (seconds >= FULL) return 'full';
  if (seconds >= HALF) return 'half';
  return 'not_yet';
}

export function emptyWatchStats(): WatchStats {
  return { scheduled: 0, watchedYes: 0, full: 0, half: 0, notYet: 0 };
}

/** One profile per recruiter name from `cooper_*` / `rms_*` custom_field tags. */
export function buildRecruiterFilterProfiles(
  rows: AnyRow[],
  watchSeconds: (row: AnyRow) => number,
): CandidateNameProfile[] {
  return buildCandidateNameProfiles(rows, watchSeconds);
}

/** @deprecated Use buildRecruiterFilterProfiles */
export function buildCandidateNameProfiles(
  rows: AnyRow[],
  watchSeconds: (row: AnyRow) => number,
): CandidateNameProfile[] {
  const map = new Map<string, CandidateNameProfile>();

  for (const row of rows) {
    const key = nameKeyFromRow(row);
    if (!key) continue;
    const displayName = getInviterAttributionFromRow(row).inviteeLabel!;

    if (!map.has(key)) {
      map.set(key, { key, displayName, ...emptyWatchStats() });
    }
    const p = map.get(key)!;
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

export function profileInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

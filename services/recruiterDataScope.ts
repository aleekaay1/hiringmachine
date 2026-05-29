import {
  buildRecruiterScopeTokens,
  recruiterOwnsNameKey,
} from './accessControl';
import {
  formatInviteeNameFromFileTail,
  nameKeyFromRow,
  normalizeNameKey,
} from './webinarGeekInviters';

type AnyRow = Record<string, unknown>;

function fallbackNameKeyFromCustomField(row: AnyRow): string | null {
  const raw = String(row.custom_field ?? '').trim();
  if (!raw) return null;
  const m = raw.match(/^(cooper|rms)[_\-\s]+(.+)$/i);
  if (!m) return null;
  const parsed = formatInviteeNameFromFileTail(m[2] || '');
  if (!parsed) return null;
  return normalizeNameKey(parsed);
}

export function filterRowsForRecruiterOwnership(
  rows: AnyRow[] | null | undefined,
  userEmail: string | null | undefined,
  userFullName: string | null | undefined,
): AnyRow[] {
  if (!rows?.length) return [];
  const scopeTokens = buildRecruiterScopeTokens(userEmail, userFullName);
  if (scopeTokens.size === 0) return [];
  return rows.filter((row) => {
    const key = nameKeyFromRow(row) ?? fallbackNameKeyFromCustomField(row);
    return recruiterOwnsNameKey(key, scopeTokens);
  });
}

import {
  buildRecruiterScopeTokens,
  recruiterOwnsNameKey,
} from './accessControl';
import { nameKeyFromRow } from './webinarGeekInviters';

type AnyRow = Record<string, unknown>;

export function filterRowsForRecruiterOwnership(
  rows: AnyRow[] | null | undefined,
  userEmail: string | null | undefined,
  userFullName: string | null | undefined,
): AnyRow[] {
  if (!rows?.length) return [];
  const scopeTokens = buildRecruiterScopeTokens(userEmail, userFullName);
  if (scopeTokens.size === 0) return [];
  return rows.filter((row) => recruiterOwnsNameKey(nameKeyFromRow(row), scopeTokens));
}

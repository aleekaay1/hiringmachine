/**
 * Lead duplicate detection — phone (last 10) and email matching.
 */

export function digitsOnly(value: string | null | undefined): string {
  return String(value || '').replace(/\D/g, '');
}

export function phoneLast10(value: string | null | undefined): string {
  const d = digitsOnly(value);
  return d.length >= 10 ? d.slice(-10) : d.length >= 7 ? d : '';
}

export function normalizeEmail(value: string | null | undefined): string | null {
  const v = String(value || '').trim().toLowerCase();
  return v || null;
}

export function normalizeStoredPhone(value: string | null | undefined): string | null {
  const d = digitsOnly(value);
  if (d.length >= 10) return d.length === 11 && d.startsWith('1') ? d : d.slice(-10);
  return d.length >= 7 ? d : null;
}

export function phonesEquivalent(a: string | null | undefined, b: string | null | undefined): boolean {
  const pa = phoneLast10(a);
  const pb = phoneLast10(b);
  if (!pa || !pb) return false;
  return pa === pb;
}

export type ImportRowLike = {
  row_number?: number;
  full_name?: string;
  email?: string | null;
  phone?: string | null;
};

export type WithinFileDuplicate = {
  rowNumber: number;
  kind: 'duplicate_phone_in_file' | 'duplicate_email_in_file';
  matchRowNumber: number;
  message: string;
};

export function findWithinFileDuplicates(rows: ImportRowLike[]): WithinFileDuplicate[] {
  const issues: WithinFileDuplicate[] = [];
  const phoneFirst = new Map<string, number>();
  const emailFirst = new Map<string, number>();

  for (const row of rows) {
    const rowNumber = Number(row.row_number || 0) || 0;
    const phoneKey = phoneLast10(row.phone);
    if (phoneKey.length >= 10) {
      const first = phoneFirst.get(phoneKey);
      if (first != null) {
        issues.push({
          rowNumber,
          kind: 'duplicate_phone_in_file',
          matchRowNumber: first,
          message: `Duplicate phone in CSV (same as row ${first}).`,
        });
      } else {
        phoneFirst.set(phoneKey, rowNumber);
      }
    }
    const emailKey = normalizeEmail(row.email);
    if (emailKey) {
      const first = emailFirst.get(emailKey);
      if (first != null) {
        issues.push({
          rowNumber,
          kind: 'duplicate_email_in_file',
          matchRowNumber: first,
          message: `Duplicate email in CSV (same as row ${first}).`,
        });
      } else {
        emailFirst.set(emailKey, rowNumber);
      }
    }
  }
  return issues;
}

export type ExistingCandidateMatch = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  assigned_to_user_id: string | null;
  assigned_to_label: string | null;
  source: string | null;
  status: string | null;
};

export function existingMatchReason(match: ExistingCandidateMatch): string {
  if (match.assigned_to_user_id) {
    return `Already assigned to ${match.assigned_to_label || 'another recruiter'}.`;
  }
  return 'Already in the pipeline pool (unassigned).';
}

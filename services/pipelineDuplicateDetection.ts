import type { ParsedHrLeadRow } from './pipelineCsvParse';

export function digitsOnly(value: string | null | undefined): string {
  return String(value || '').replace(/\D/g, '');
}

export function phoneLast10(value: string | null | undefined): string {
  const d = digitsOnly(value);
  return d.length >= 10 ? d.slice(-10) : d.length >= 7 ? d : '';
}

export type HrLeadDuplicateIssue = {
  rowNumber: number;
  fullName: string;
  email: string | null;
  phone: string | null;
  kind:
    | 'duplicate_phone_in_file'
    | 'duplicate_email_in_file'
    | 'existing_phone'
    | 'existing_email';
  matchRowNumber?: number;
  existingCandidateId?: string;
  existingAssignedTo?: string | null;
  message: string;
};

export function findWithinFileDuplicateIssues(rows: ParsedHrLeadRow[]): HrLeadDuplicateIssue[] {
  const issues: HrLeadDuplicateIssue[] = [];
  const phoneFirst = new Map<string, number>();
  const emailFirst = new Map<string, number>();

  for (const row of rows) {
    const phoneKey = phoneLast10(row.phone);
    if (phoneKey.length >= 10) {
      const first = phoneFirst.get(phoneKey);
      if (first != null) {
        issues.push({
          rowNumber: row.rowNumber,
          fullName: row.fullName,
          email: row.email,
          phone: row.phone,
          kind: 'duplicate_phone_in_file',
          matchRowNumber: first,
          message: `Duplicate phone in this file (same as row ${first}).`,
        });
      } else {
        phoneFirst.set(phoneKey, row.rowNumber);
      }
    }
    const emailKey = String(row.email || '').trim().toLowerCase();
    if (emailKey) {
      const first = emailFirst.get(emailKey);
      if (first != null) {
        issues.push({
          rowNumber: row.rowNumber,
          fullName: row.fullName,
          email: row.email,
          phone: row.phone,
          kind: 'duplicate_email_in_file',
          matchRowNumber: first,
          message: `Duplicate email in this file (same as row ${first}).`,
        });
      } else {
        emailFirst.set(emailKey, row.rowNumber);
      }
    }
  }
  return issues;
}

export function mergeDuplicateIssues(
  withinFile: HrLeadDuplicateIssue[],
  fromServer: HrLeadDuplicateIssue[],
): HrLeadDuplicateIssue[] {
  const byRow = new Map<number, HrLeadDuplicateIssue>();
  for (const issue of [...withinFile, ...fromServer]) {
    const prev = byRow.get(issue.rowNumber);
    if (!prev || issue.kind.startsWith('existing')) {
      byRow.set(issue.rowNumber, issue);
    }
  }
  return [...byRow.values()].sort((a, b) => a.rowNumber - b.rowNumber);
}

export function defaultExcludedDuplicateRows(issues: HrLeadDuplicateIssue[]): Set<number> {
  return new Set(issues.map((row) => row.rowNumber));
}

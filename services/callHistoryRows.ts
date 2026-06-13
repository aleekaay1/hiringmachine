import { readPipelineCandidateEmail, readPipelineCandidatePhone, readPipelineCandidateProfile, type PipelineCallRecord, type PipelineCandidate, type PipelineResume } from './pipelineService';
import { getCandidateBatchGroupKey } from './pipelineLeadGrouping';

export type CallHistoryRow = {
  candidateId: string;
  candidate: PipelineCandidate | null;
  latestRecord: PipelineCallRecord;
  callCount: number;
  resumes: PipelineResume[];
  displayName: string;
  phone: string;
  email: string;
  disposition: string;
  disposedAt: string;
  batchKey: string;
  batchTitle: string;
  title: string | null;
};

function recordDisplayName(record: PipelineCallRecord, candidate: PipelineCandidate | null): string {
  const fromRecord = String(record.candidate_name || '').trim();
  if (fromRecord) return fromRecord;
  return String(candidate?.full_name || '').trim() || 'Unknown candidate';
}

function recordEmail(record: PipelineCallRecord, candidate: PipelineCandidate | null): string {
  const fromRecord = String(record.candidate_email || '').trim();
  if (fromRecord) return fromRecord;
  if (candidate) return readPipelineCandidateEmail(candidate).effectiveEmail;
  return '';
}

function recordPhone(record: PipelineCallRecord, candidate: PipelineCandidate | null): string {
  const dialed = String(record.dialed_number || '').trim();
  if (dialed) return dialed;
  if (candidate) return readPipelineCandidatePhone(candidate).effectivePhone;
  return '';
}

export function buildCallHistoryRows(input: {
  records: PipelineCallRecord[];
  candidates: PipelineCandidate[];
  resumesByCandidate: Map<string, PipelineResume[]>;
  batchTitleByKey?: Map<string, string>;
}): CallHistoryRow[] {
  const candidateById = new Map(input.candidates.map((c) => [c.id, c]));
  const grouped = new Map<string, PipelineCallRecord[]>();

  for (const record of input.records) {
    const id = String(record.candidate_id || '').trim();
    if (!id) continue;
    const list = grouped.get(id) || [];
    list.push(record);
    grouped.set(id, list);
  }

  const rows: CallHistoryRow[] = [];

  for (const [candidateId, recordList] of grouped) {
    const sorted = [...recordList].sort(
      (a, b) => new Date(b.disposed_at || b.created_at).getTime() - new Date(a.disposed_at || a.created_at).getTime(),
    );
    const latest = sorted[0];
    if (!latest) continue;

    const candidate = candidateById.get(candidateId) ?? null;
    const resumes = input.resumesByCandidate.get(candidateId) || [];
    const profile = candidate ? readPipelineCandidateProfile(candidate) : null;
    const title = profile?.current_title?.trim() || null;

    const batchKey = candidate ? getCandidateBatchGroupKey(candidate) : 'unknown';
    const batchTitle = input.batchTitleByKey?.get(batchKey) || batchKey;

    rows.push({
      candidateId,
      candidate,
      latestRecord: latest,
      callCount: sorted.length,
      resumes,
      displayName: recordDisplayName(latest, candidate),
      phone: recordPhone(latest, candidate),
      email: recordEmail(latest, candidate),
      disposition: String(latest.disposition || '—').trim(),
      disposedAt: latest.disposed_at || latest.created_at,
      batchKey,
      batchTitle,
      title,
    });
  }

  return rows.sort(
    (a, b) => new Date(b.disposedAt).getTime() - new Date(a.disposedAt).getTime(),
  );
}

export function matchesCallHistorySearch(row: CallHistoryRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const qDigits = q.replace(/\D/g, '');
  const phoneDigits = row.phone.replace(/\D/g, '');
  return (
    row.displayName.toLowerCase().includes(q) ||
    row.email.toLowerCase().includes(q) ||
    row.disposition.toLowerCase().includes(q) ||
    row.batchTitle.toLowerCase().includes(q) ||
    (row.title || '').toLowerCase().includes(q) ||
    row.phone.toLowerCase().includes(q) ||
    (qDigits.length >= 3 && phoneDigits.includes(qDigits))
  );
}

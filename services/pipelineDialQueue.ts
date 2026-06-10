import type { PipelineCallRecord, PipelineCandidate } from './pipelineService';
import { getCandidateBatchGroupKey } from './pipelineLeadGrouping';

export type DialQueueStartMode = 'first' | 'resume';

export type LoadedDialQueue = {
  batchKey: string;
  batchTitle: string;
  startMode: DialQueueStartMode;
  candidateId?: string;
};

export function candidateInBatchGroup(candidate: PipelineCandidate, batchKey: string): boolean {
  return getCandidateBatchGroupKey(candidate) === batchKey;
}

function normalizeDisposition(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase();
}

const RETRY_DISPOSITIONS = new Set([
  'callback requested',
  'no answer',
  'voicemail left',
  'busy / line busy',
]);

function isRetryDisposition(label: string): boolean {
  return RETRY_DISPOSITIONS.has(label);
}

function orderBatchCandidates(candidates: PipelineCandidate[], batchKey: string): PipelineCandidate[] {
  return candidates
    .filter((candidate) => candidateInBatchGroup(candidate, batchKey))
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

export function applyDialQueueStartMode(
  queue: PipelineCandidate[],
  orderedBatch: PipelineCandidate[],
  startMode: DialQueueStartMode,
  latestByCandidate: Map<string, PipelineCallRecord>,
): PipelineCandidate[] {
  if (startMode !== 'resume' || !orderedBatch.length) return queue;

  let lastDisposedIndex = -1;
  for (let index = 0; index < orderedBatch.length; index += 1) {
    const candidate = orderedBatch[index];
    if (!latestByCandidate.has(candidate.id)) continue;
    const disposition = normalizeDisposition(latestByCandidate.get(candidate.id)?.disposition);
    if (!isRetryDisposition(disposition)) {
      lastDisposedIndex = index;
    }
  }

  if (lastDisposedIndex < 0) return queue;

  const allowedIds = new Set(orderedBatch.slice(lastDisposedIndex + 1).map((row) => row.id));
  return queue.filter((candidate) => allowedIds.has(candidate.id));
}

export function buildLoadedDialQueue(
  candidates: PipelineCandidate[],
  loaded: LoadedDialQueue,
  latestByCandidate: Map<string, PipelineCallRecord>,
  buildActiveQueue: (scoped: PipelineCandidate[]) => PipelineCandidate[],
): PipelineCandidate[] {
  const orderedBatch = orderBatchCandidates(candidates, loaded.batchKey);
  const scoped = candidates.filter((candidate) => candidateInBatchGroup(candidate, loaded.batchKey));
  const active = buildActiveQueue(scoped);
  return applyDialQueueStartMode(active, orderedBatch, loaded.startMode, latestByCandidate);
}

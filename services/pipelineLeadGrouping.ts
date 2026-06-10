import { formatDateCanadaEastern } from './dateDisplay';
import { formatHrLeadTeamDisplay, readCandidateLeadTeam } from './hrLeadTeamCategories';
import type { PipelineCandidate } from './pipelineService';

export type LeadBatchGroupKind = 'hr_batch' | 'self_lead' | 'bulk_upload' | 'other';

export type LeadBatchGroup<T = PipelineCandidate> = {
  key: string;
  kind: LeadBatchGroupKind;
  batchNumber: number | null;
  title: string;
  subtitle: string;
  sortTimestamp: number;
  items: T[];
  newCount: number;
  inProgressCount: number;
  doneCount: number;
};

type GroupingOptions = {
  isNew?: (candidate: PipelineCandidate) => boolean;
  isInProgress?: (candidate: PipelineCandidate) => boolean;
  isDone?: (candidate: PipelineCandidate) => boolean;
};

export function readCandidateBatchLabel(candidate: PipelineCandidate): string {
  const meta = candidate.metadata && typeof candidate.metadata === 'object' ? candidate.metadata : {};
  const label = String((meta as Record<string, unknown>).lead_batch_label || '').trim();
  if (label) return label;
  const leadTeam = readCandidateLeadTeam(meta as Record<string, unknown>);
  if (leadTeam && candidate.source === 'hr_csv_batch') return leadTeam;
  return '';
}

export function readCandidateSourceFilename(candidate: PipelineCandidate): string {
  const meta = candidate.metadata && typeof candidate.metadata === 'object' ? candidate.metadata : {};
  return String((meta as Record<string, unknown>).lead_source_filename || '').trim();
}

function buildHrBatchDisplayTitle(batchLabel: string, team: string, sourceFilename: string): string {
  const teamLabel = formatHrLeadTeamDisplay(team);
  const fileBase = sourceFilename.replace(/\.[^.]+$/, '').trim();
  if (teamLabel && fileBase && !batchLabel.toLowerCase().includes(teamLabel.toLowerCase())) {
    return `${teamLabel} · ${fileBase}`;
  }
  if (teamLabel && batchLabel && !batchLabel.toLowerCase().startsWith(teamLabel.toLowerCase())) {
    return `${teamLabel} · ${batchLabel}`;
  }
  return batchLabel || (teamLabel ? `${teamLabel} leads` : '');
}

export function readCandidateBatchDate(candidate: PipelineCandidate): string {
  const assignedAt = candidate.assigned_at;
  const meta = candidate.metadata && typeof candidate.metadata === 'object' ? candidate.metadata : {};
  const batchCreated = String((meta as Record<string, unknown>).lead_batch_created_at || '').trim();
  return assignedAt || batchCreated || candidate.created_at;
}

export function getCandidateBatchGroupKey(candidate: PipelineCandidate): string {
  if (candidate.source === 'self_lead') return 'self_lead';
  if (candidate.source === 'hr_csv_batch') {
    if (candidate.lead_batch_id) return `hr_batch:${candidate.lead_batch_id}`;
    const week = readCandidateBatchDate(candidate).slice(0, 10);
    return `hr_week:${week}`;
  }
  if (candidate.source === 'bulk_upload') return `bulk:${candidate.created_at.slice(0, 10)}`;
  return `other:${candidate.source || 'misc'}`;
}

function buildGroupTitle(kind: LeadBatchGroupKind, batchLabel: string, dateStr: string): string {
  const dateFormatted = formatDateCanadaEastern(dateStr);
  if (kind === 'self_lead') return 'Self-added leads';
  if (kind === 'bulk_upload') return batchLabel || `Earlier uploads · ${dateFormatted}`;
  if (batchLabel) return batchLabel;
  return `HR leads · ${dateFormatted}`;
}

function buildGroupSubtitle(
  kind: LeadBatchGroupKind,
  batchLabel: string,
  dateStr: string,
  sourceFilename = '',
  team = '',
): string {
  const dateFormatted = formatDateCanadaEastern(dateStr);
  if (kind === 'self_lead') return 'LinkedIn, referrals, and manual adds';
  if (kind === 'hr_batch') {
    const fileHint = sourceFilename ? `File: ${sourceFilename}` : '';
    const teamHint = team ? formatHrLeadTeamDisplay(team) : '';
    const parts = [teamHint && `${teamHint} leads`, fileHint, `Week of ${dateFormatted}`].filter(Boolean);
    return parts.join(' · ') || `Assigned ${dateFormatted}`;
  }
  if (kind === 'bulk_upload') return `Uploaded ${dateFormatted}`;
  return dateFormatted;
}

export function groupPipelineCandidatesByBatch(
  candidates: PipelineCandidate[],
  options: GroupingOptions = {},
): LeadBatchGroup[] {
  const isNew = options.isNew ?? (() => false);
  const isInProgress = options.isInProgress ?? (() => false);
  const isDone = options.isDone ?? (() => false);
  const map = new Map<string, LeadBatchGroup>();

  for (const candidate of candidates) {
    const key = getCandidateBatchGroupKey(candidate);
    let group = map.get(key);
    if (!group) {
      const kind: LeadBatchGroupKind =
        candidate.source === 'self_lead'
          ? 'self_lead'
          : candidate.source === 'hr_csv_batch'
            ? 'hr_batch'
            : candidate.source === 'bulk_upload'
              ? 'bulk_upload'
              : 'other';
      const meta = candidate.metadata && typeof candidate.metadata === 'object' ? candidate.metadata : {};
      const batchLabel = String((meta as Record<string, unknown>).lead_batch_label || '').trim() || readCandidateBatchLabel(candidate);
      const team = readCandidateLeadTeam(meta as Record<string, unknown>);
      const sourceFilename = readCandidateSourceFilename(candidate);
      const dateStr = readCandidateBatchDate(candidate);
      const title =
        kind === 'hr_batch'
          ? buildHrBatchDisplayTitle(batchLabel, team, sourceFilename) || buildGroupTitle(kind, batchLabel, dateStr)
          : buildGroupTitle(kind, batchLabel, dateStr);
      group = {
        key,
        kind,
        batchNumber: null,
        title,
        subtitle: buildGroupSubtitle(kind, batchLabel, dateStr, sourceFilename, team),
        sortTimestamp: new Date(dateStr).getTime() || 0,
        items: [],
        newCount: 0,
        inProgressCount: 0,
        doneCount: 0,
      };
      map.set(key, group);
    }
    group.items.push(candidate);
    if (isNew(candidate)) group.newCount += 1;
    else if (isInProgress(candidate)) group.inProgressCount += 1;
    else if (isDone(candidate)) group.doneCount += 1;
  }

  const sorted = [...map.values()].sort((a, b) => b.sortTimestamp - a.sortTimestamp);
  let hrBatchIndex = 0;
  return sorted.map((group) => {
    if (group.kind !== 'hr_batch') return group;
    hrBatchIndex += 1;
    const numberedTitle = group.title.match(/^Batch \d+ · /)
      ? group.title
      : `Batch ${hrBatchIndex} · ${group.title}`;
    return {
      ...group,
      batchNumber: hrBatchIndex,
      title: numberedTitle,
    };
  });
}

export type HrLeadBatchRef = {
  id: string;
  label: string;
  created_at: string;
  source_filename?: string | null;
  lead_team?: string | null;
  imported_count?: number;
  assigned_count?: number;
};

export type HrLeadListGroup<T> = {
  key: string;
  title: string;
  subtitle: string;
  sortTimestamp: number;
  items: T[];
};

export function groupHrLeadsByBatchId<T extends { lead_batch_id: string | null; created_at: string }>(
  leads: T[],
  batches: HrLeadBatchRef[],
): HrLeadListGroup<T>[] {
  const batchById = new Map(batches.map((batch) => [batch.id, batch]));
  const map = new Map<string, HrLeadListGroup<T>>();

  for (const lead of leads) {
    const batchId = lead.lead_batch_id || 'unbatched';
    let group = map.get(batchId);
    if (!group) {
      const batch = batchId !== 'unbatched' ? batchById.get(batchId) : null;
      const team = formatHrLeadTeamDisplay(batch?.lead_team);
      const batchLabel = batch?.label || (batchId === 'unbatched' ? 'Unbatched leads' : 'HR import batch');
      const sourceFilename = String(batch?.source_filename || '').trim();
      const title = team
        ? buildHrBatchDisplayTitle(batchLabel, team, sourceFilename)
        : batchLabel;
      const dateStr = batch?.created_at || lead.created_at;
      group = {
        key: batchId,
        title,
        subtitle: [
          team ? `${team} leads` : '',
          sourceFilename ? `File: ${sourceFilename}` : '',
          `Imported ${formatDateCanadaEastern(dateStr)} · ${batch?.imported_count ?? '—'} imported`,
        ]
          .filter(Boolean)
          .join(' · '),
        sortTimestamp: new Date(dateStr).getTime() || 0,
        items: [],
      };
      map.set(batchId, group);
    }
    group.items.push(lead);
  }

  const sorted = [...map.values()].sort((a, b) => b.sortTimestamp - a.sortTimestamp);
  let batchNumber = 0;
  return sorted.map((group) => {
    if (group.key === 'unbatched') return group;
    batchNumber += 1;
    return {
      ...group,
      title: group.title.startsWith('Batch ') ? group.title : `Batch ${batchNumber} · ${group.title}`,
    };
  });
}

export function defaultExpandedGroupKeys(groups: LeadBatchGroup[]): Set<string> {
  const keys = new Set<string>();
  if (!groups.length) return keys;
  keys.add(groups[0].key);
  const secondHr = groups.find((group, index) => index > 0 && group.kind === 'hr_batch' && group.newCount > 0);
  if (secondHr) keys.add(secondHr.key);
  const selfWithNew = groups.find((group) => group.kind === 'self_lead' && group.newCount > 0);
  if (selfWithNew) keys.add(selfWithNew.key);
  return keys;
}

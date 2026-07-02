import { DISPLAY_TIME_ZONE_CANADA_EASTERN, formatDateCanadaEastern } from './dateDisplay';
import type { HrDispositionCounts } from './pipelineHrLeadsService';
import type { PipelineCallRecord, PipelineCandidate } from './pipelineService';
import { readCandidateLeadTeam } from './hrLeadTeamCategories';
import {
  getCandidateBatchGroupKey,
  readCandidateBatchLabel,
  readCandidateSourceFilename,
  type LeadBatchGroup,
} from './pipelineLeadGrouping';

export const DIAL_QUEUE_INTENT_KEY = 'pipeline-dial-queue-intent';
export const ACTIVE_DIAL_QUEUE_KEY = 'pipeline-active-dial-queue';
export const CALL_HOUR_START = 10;
export const CALL_HOUR_END = 17;

export type DialQueueIntent = {
  batchKey: string;
  batchTitle: string;
  startMode: 'first' | 'resume';
  /** When set, call workspace selects this lead after loading the pack. */
  candidateId?: string;
};

const PICKUP_DISPOSITIONS = new Set([
  'booked',
  'connected',
  'callback requested',
  'interested – next step',
  'scheduled interview',
]);

export function emptyDispositionCounts(): HrDispositionCounts {
  return {
    booked: 0,
    no_answer: 0,
    voicemail_left: 0,
    callback_requested: 0,
    not_interested: 0,
    busy: 0,
    wrong_number: 0,
    connected: 0,
    other: 0,
  };
}

export function incrementDispositionCount(counts: HrDispositionCounts, disposition: string | null): void {
  const d = String(disposition || '').trim().toLowerCase();
  if (!d) return;
  if (d === 'booked') counts.booked += 1;
  else if (d === 'no answer') counts.no_answer += 1;
  else if (d === 'voicemail left') counts.voicemail_left += 1;
  else if (d === 'callback requested') counts.callback_requested += 1;
  else if (d === 'not interested' || d === 'do not call') counts.not_interested += 1;
  else if (d === 'busy / line busy') counts.busy += 1;
  else if (d === 'wrong number') counts.wrong_number += 1;
  else if (d === 'connected' || d === 'interested – next step' || d === 'scheduled interview') counts.connected += 1;
  else counts.other += 1;
}

export function latestRecordByCandidate(records: PipelineCallRecord[]): Map<string, PipelineCallRecord> {
  const map = new Map<string, PipelineCallRecord>();
  for (const row of records) {
    const current = map.get(row.candidate_id);
    if (!current || new Date(row.disposed_at).getTime() > new Date(current.disposed_at).getTime()) {
      map.set(row.candidate_id, row);
    }
  }
  return map;
}

export function callCountByCandidate(records: PipelineCallRecord[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of records) {
    map.set(row.candidate_id, (map.get(row.candidate_id) || 0) + 1);
  }
  return map;
}

export function isPickupDisposition(disposition: string | null | undefined): boolean {
  return PICKUP_DISPOSITIONS.has(String(disposition || '').trim().toLowerCase());
}

export type LeadPackStats = {
  key: string;
  title: string;
  subtitle: string;
  team: string;
  sourceFilename: string;
  sortTimestamp: number;
  assignedCount: number;
  notContactedCount: number;
  workedCount: number;
  bookedCount: number;
  pickupCount: number;
  contactRate: number;
  bookRate: number;
  pickupRate: number;
  noAnswerRate: number;
  dispositionCounts: HrDispositionCounts;
  priorityScore: number;
  recommendation: string;
  insightTone: 'emerald' | 'sky' | 'amber' | 'slate';
};

export function buildLeadPackStats(
  group: LeadBatchGroup<PipelineCandidate>,
  latestByCandidate: Map<string, PipelineCallRecord>,
): LeadPackStats {
  const dispositionCounts = emptyDispositionCounts();
  let notContactedCount = 0;
  let workedCount = 0;
  let bookedCount = 0;
  let pickupCount = 0;

  for (const candidate of group.items) {
    const latest = latestByCandidate.get(candidate.id);
    if (!latest?.disposition) {
      notContactedCount += 1;
      continue;
    }
    workedCount += 1;
    incrementDispositionCount(dispositionCounts, latest.disposition);
    if (String(latest.disposition).toLowerCase() === 'booked') bookedCount += 1;
    if (isPickupDisposition(latest.disposition)) pickupCount += 1;
  }

  const assignedCount = group.items.length;
  const contactRate = assignedCount ? Math.round((workedCount / assignedCount) * 100) : 0;
  const bookRate = workedCount ? Math.round((bookedCount / workedCount) * 100) : 0;
  const pickupRate = workedCount ? Math.round((pickupCount / workedCount) * 100) : 0;
  const noAnswerRate = workedCount
    ? Math.round((dispositionCounts.no_answer / workedCount) * 100)
    : 0;

  const first = group.items[0];
  const meta = first?.metadata && typeof first.metadata === 'object' ? (first.metadata as Record<string, unknown>) : {};
  const team = first ? readCandidateLeadTeam(meta) : '';
  const sourceFilename = first ? readCandidateSourceFilename(first) : '';

  const priorityScore =
    notContactedCount * 3 +
    group.newCount * 4 +
    bookRate * 0.5 +
    pickupRate * 0.3 -
    noAnswerRate * 0.4;

  let recommendation = 'Balanced pack — work through fresh leads at your steady pace.';
  let insightTone: LeadPackStats['insightTone'] = 'slate';

  if (notContactedCount >= assignedCount * 0.6 && notContactedCount >= 5) {
    recommendation = `Fresh pack — ${notContactedCount} leads untouched. Strong choice to start your day here.`;
    insightTone = 'emerald';
  } else if (bookRate >= 15 && workedCount >= 5) {
    recommendation = `High converter — ${bookRate}% book rate. Keep momentum on callbacks and follow-ups.`;
    insightTone = 'sky';
  } else if (noAnswerRate >= 55 && workedCount >= 8) {
    recommendation = `Tough pack — ${noAnswerRate}% no answer. Try different hours or rotate to another batch.`;
    insightTone = 'amber';
  } else if (dispositionCounts.callback_requested >= 3) {
    recommendation = `${dispositionCounts.callback_requested} callbacks waiting — prioritize warm returns before cold dials.`;
    insightTone = 'sky';
  } else if (notContactedCount > 0 && notContactedCount <= 4) {
    recommendation = 'Almost cleared — finish remaining leads, then move to a fresher pack.';
    insightTone = 'amber';
  }

  return {
    key: group.key,
    title: group.title,
    subtitle: group.subtitle,
    team,
    sourceFilename,
    sortTimestamp: group.sortTimestamp,
    assignedCount,
    notContactedCount,
    workedCount,
    bookedCount,
    pickupCount,
    contactRate,
    bookRate,
    pickupRate,
    noAnswerRate,
    dispositionCounts,
    priorityScore,
    recommendation,
    insightTone,
  };
}

export type DailyCallBar = {
  dateKey: string;
  label: string;
  totalCalls: number;
  pickups: number;
  booked: number;
};

export type HourlyCallBar = {
  hour: number;
  label: string;
  totalCalls: number;
  pickups: number;
  pickupRate: number;
};

export type PackCallAnalytics = {
  dailyBars: DailyCallBar[];
  hourlyBars: HourlyCallBar[];
  bestHourLabel: string | null;
  bestDayLabel: string | null;
  totalCalls: number;
  totalPickups: number;
  avgCallsPerDay: number;
};

function torontoParts(iso: string): { dateKey: string; hour: number; weekday: string } | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: DISPLAY_TIME_ZONE_CANADA_EASTERN,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    hour12: false,
    weekday: 'short',
  });
  const parts = formatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || '';
  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hour = Number(get('hour'));
  if (!year || !month || !day || !Number.isFinite(hour)) return null;
  return {
    dateKey: `${year}-${month}-${day}`,
    hour,
    weekday: get('weekday'),
  };
}

export function buildPackCallAnalytics(
  records: PipelineCallRecord[],
  candidateIds: Set<string>,
  days = 14,
): PackCallAnalytics {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days + 1);
  cutoff.setHours(0, 0, 0, 0);

  const dailyMap = new Map<string, DailyCallBar>();
  const hourlyMap = new Map<number, HourlyCallBar>();
  const weekdayPickups = new Map<string, number>();

  for (let hour = CALL_HOUR_START; hour <= CALL_HOUR_END; hour += 1) {
    const label =
      hour === 12 ? '12 PM' : hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
    hourlyMap.set(hour, { hour, label, totalCalls: 0, pickups: 0, pickupRate: 0 });
  }

  let totalCalls = 0;
  let totalPickups = 0;

  for (const record of records) {
    if (!candidateIds.has(record.candidate_id)) continue;
    const disposedAt = record.disposed_at || record.dial_started_at || record.created_at;
    if (!disposedAt) continue;
    const when = new Date(disposedAt);
    if (when < cutoff) continue;

    const parts = torontoParts(disposedAt);
    if (!parts) continue;

    totalCalls += 1;
    const pickup = isPickupDisposition(record.disposition);
    if (pickup) totalPickups += 1;

    let daily = dailyMap.get(parts.dateKey);
    if (!daily) {
      daily = {
        dateKey: parts.dateKey,
        label: formatDateCanadaEastern(disposedAt, { month: 'short', day: 'numeric' }),
        totalCalls: 0,
        pickups: 0,
        booked: 0,
      };
      dailyMap.set(parts.dateKey, daily);
    }
    daily.totalCalls += 1;
    if (pickup) daily.pickups += 1;
    if (String(record.disposition || '').toLowerCase() === 'booked') daily.booked += 1;

    if (parts.hour >= CALL_HOUR_START && parts.hour <= CALL_HOUR_END) {
      const hourly = hourlyMap.get(parts.hour)!;
      hourly.totalCalls += 1;
      if (pickup) hourly.pickups += 1;
    }

    if (pickup) {
      weekdayPickups.set(parts.weekday, (weekdayPickups.get(parts.weekday) || 0) + 1);
    }
  }

  const dailyBars = [...dailyMap.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  const hourlyBars = [...hourlyMap.values()].map((bar) => ({
    ...bar,
    pickupRate: bar.totalCalls ? Math.round((bar.pickups / bar.totalCalls) * 100) : 0,
  }));

  const bestHour = hourlyBars
    .filter((bar) => bar.totalCalls >= 2)
    .sort((a, b) => b.pickupRate - a.pickupRate || b.pickups - a.pickups)[0];
  const bestDay = dailyBars
    .filter((bar) => bar.totalCalls >= 2)
    .sort((a, b) => b.pickups - a.pickups || b.totalCalls - a.totalCalls)[0];
  const bestWeekday = [...weekdayPickups.entries()].sort((a, b) => b[1] - a[1])[0];

  return {
    dailyBars,
    hourlyBars,
    bestHourLabel: bestHour ? `${bestHour.label} (${bestHour.pickupRate}% pickup)` : null,
    bestDayLabel: bestDay
      ? `${bestDay.label} (${bestDay.pickups} pickups)`
      : bestWeekday
        ? `${bestWeekday[0]} (${bestWeekday[1]} pickups)`
        : null,
    totalCalls,
    totalPickups,
    avgCallsPerDay: dailyBars.length ? Math.round(totalCalls / dailyBars.length) : 0,
  };
}

export function saveDialQueueIntent(intent: DialQueueIntent): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(DIAL_QUEUE_INTENT_KEY, JSON.stringify(intent));
}

export function consumeDialQueueIntent(): DialQueueIntent | null {
  if (typeof window === 'undefined') return null;
  const raw = window.sessionStorage.getItem(DIAL_QUEUE_INTENT_KEY);
  if (!raw) return null;
  window.sessionStorage.removeItem(DIAL_QUEUE_INTENT_KEY);
  try {
    const parsed = JSON.parse(raw) as DialQueueIntent;
    if (!parsed?.batchKey || !parsed?.batchTitle) return null;
    const candidateId = String(parsed.candidateId || '').trim();
    return {
      batchKey: String(parsed.batchKey),
      batchTitle: String(parsed.batchTitle),
      startMode: parsed.startMode === 'resume' ? 'resume' : 'first',
      ...(candidateId ? { candidateId } : {}),
    };
  } catch {
    return null;
  }
}

export function saveActiveDialQueue(intent: DialQueueIntent): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(ACTIVE_DIAL_QUEUE_KEY, JSON.stringify(intent));
}

export function readActiveDialQueue(): DialQueueIntent | null {
  if (typeof window === 'undefined') return null;
  const raw = window.sessionStorage.getItem(ACTIVE_DIAL_QUEUE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DialQueueIntent;
    if (!parsed?.batchKey || !parsed?.batchTitle) return null;
    const candidateId = String(parsed.candidateId || '').trim();
    return {
      batchKey: String(parsed.batchKey),
      batchTitle: String(parsed.batchTitle),
      startMode: parsed.startMode === 'resume' ? 'resume' : 'first',
      ...(candidateId ? { candidateId } : {}),
    };
  } catch {
    return null;
  }
}

export function clearActiveDialQueue(): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(ACTIVE_DIAL_QUEUE_KEY);
}

export function filterRecordsForPack(
  records: PipelineCallRecord[],
  candidates: PipelineCandidate[],
  batchKey: string,
): PipelineCallRecord[] {
  const ids = new Set(
    candidates.filter((c) => getCandidateBatchGroupKey(c) === batchKey).map((c) => c.id),
  );
  return records.filter((r) => ids.has(r.candidate_id));
}

export function readPackTeamLabel(candidate: PipelineCandidate | undefined): string {
  if (!candidate) return '';
  const meta = candidate.metadata && typeof candidate.metadata === 'object' ? candidate.metadata : {};
  return readCandidateLeadTeam(meta as Record<string, unknown>) || readCandidateBatchLabel(candidate);
}

import { readCallRecordMeta, type PipelineCallRecord } from './pipelineService';

type CandidateEmailMap = Map<string, string>;
type RecruiterDirectory = Map<string, { fullName: string | null; email: string | null }>;

export type LeaderboardWindow = {
  fromIso: string;
  toIso: string;
  label: string;
};

export type LeaderboardPeriod = 'last7' | 'last30' | 'thisMonth';

export type RecruiterLeaderboardRow = {
  recruiterKey: string;
  recruiterUserId: string | null;
  displayName: string;
  calls: number;
  booked: number;
  webinarBooked: number;
  webinarShowed: number;
  showRatio: number;
  showRatioSmoothed: number;
  bookedNorm: number;
  callsNorm: number;
  lowSampleFactor: number;
  score: number;
  rank: number;
  previousRank: number | null;
  rankDelta: number;
  passedLabel: string | null;
  overtakenByLabel: string | null;
  badges: string[];
};

export type LeaderboardRecruiterSeed = {
  recruiterKey: string;
  recruiterUserId: string;
  displayName: string;
};

type Aggregate = {
  recruiterKey: string;
  recruiterUserId: string | null;
  displayName: string;
  calls: number;
  booked: number;
  webinarBooked: number;
  webinarShowed: number;
};

function startOfDayUtc(value: Date): Date {
  const copy = new Date(value);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

function endOfDayUtc(value: Date): Date {
  const copy = new Date(value);
  copy.setUTCHours(23, 59, 59, 999);
  return copy;
}

function periodBounds(period: LeaderboardPeriod, now: Date): { from: Date; to: Date; previousFrom: Date; previousTo: Date; label: string } {
  const today = startOfDayUtc(now);
  const to = endOfDayUtc(now);

  if (period === 'last30') {
    const from = new Date(today);
    from.setUTCDate(from.getUTCDate() - 29);
    const previousTo = new Date(from);
    previousTo.setUTCDate(previousTo.getUTCDate() - 1);
    const previousFrom = new Date(previousTo);
    previousFrom.setUTCDate(previousFrom.getUTCDate() - 29);
    return {
      from,
      to,
      previousFrom: startOfDayUtc(previousFrom),
      previousTo: endOfDayUtc(previousTo),
      label: 'Last 30 days',
    };
  }

  if (period === 'thisMonth') {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
    const monthLength = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000) + 1);
    const previousTo = new Date(from);
    previousTo.setUTCDate(previousTo.getUTCDate() - 1);
    const previousFrom = new Date(previousTo);
    previousFrom.setUTCDate(previousFrom.getUTCDate() - (monthLength - 1));
    return {
      from,
      to,
      previousFrom: startOfDayUtc(previousFrom),
      previousTo: endOfDayUtc(previousTo),
      label: 'This month',
    };
  }

  const from = new Date(today);
  from.setUTCDate(from.getUTCDate() - 6);
  const previousTo = new Date(from);
  previousTo.setUTCDate(previousTo.getUTCDate() - 1);
  const previousFrom = new Date(previousTo);
  previousFrom.setUTCDate(previousFrom.getUTCDate() - 6);
  return {
    from,
    to,
    previousFrom: startOfDayUtc(previousFrom),
    previousTo: endOfDayUtc(previousTo),
    label: 'Last 7 days',
  };
}

export function buildLeaderboardWindows(period: LeaderboardPeriod, now = new Date()): { current: LeaderboardWindow; previous: LeaderboardWindow } {
  const bounds = periodBounds(period, now);
  return {
    current: {
      fromIso: bounds.from.toISOString(),
      toIso: bounds.to.toISOString(),
      label: bounds.label,
    },
    previous: {
      fromIso: bounds.previousFrom.toISOString(),
      toIso: bounds.previousTo.toISOString(),
      label: `Previous ${bounds.label.toLowerCase()}`,
    },
  };
}

function showRatioFromCounts(webinarShowed: number, webinarBooked: number, booked: number, calls: number): number {
  if (webinarBooked > 0) return webinarShowed / webinarBooked;
  if (calls <= 0) return 0;
  return booked / calls;
}

function showRatioSmoothed(webinarShowed: number, webinarBooked: number, booked: number, calls: number): number {
  if (webinarBooked > 0) {
    return (webinarShowed + 2) / (webinarBooked + 4);
  }
  return (booked + 1) / (calls + 5);
}

function recruiterKeyForRecord(record: PipelineCallRecord): { recruiterKey: string; recruiterUserId: string | null } {
  const userId = String(record.recruiter_user_id || '').trim() || null;
  if (userId) return { recruiterKey: `uid:${userId}`, recruiterUserId: userId };
  const label = String(record.recruiter_label || '').trim() || 'Unknown Recruiter';
  return { recruiterKey: `label:${label.toLowerCase()}`, recruiterUserId: null };
}

function displayNameForRecord(
  record: PipelineCallRecord,
  directory: RecruiterDirectory,
): string {
  const nameFromEmail = (email: string): string | null => {
    const local = String(email || '').trim().toLowerCase().split('@')[0] || '';
    if (!local) return null;
    const parts = local.split(/[._-]+/g).filter(Boolean);
    if (!parts.length) return null;
    return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
  };
  const userId = String(record.recruiter_user_id || '').trim();
  if (userId && directory.has(userId)) {
    const row = directory.get(userId)!;
    const full = String(row.fullName || '').trim();
    if (full) return full;
    const fromEmail = row.email ? nameFromEmail(row.email) : null;
    return fromEmail || 'Unknown Recruiter';
  }
  const label = String(record.recruiter_label || '').trim();
  if (label && !label.includes('@')) return label;
  const fallbackEmail = label.includes('@') ? label : '';
  return (fallbackEmail ? nameFromEmail(fallbackEmail) : null) || 'Unknown Recruiter';
}

function aggregateRecords(
  records: PipelineCallRecord[],
  candidateEmailMap: CandidateEmailMap,
  classifyWebinarShow: (bookedSubtype: string | null, candidateEmail: string | null) => boolean,
  directory: RecruiterDirectory,
  recruiterSeeds?: LeaderboardRecruiterSeed[],
): Aggregate[] {
  const map = new Map<string, Aggregate>();
  for (const record of records) {
    const { recruiterKey, recruiterUserId } = recruiterKeyForRecord(record);
    if (!map.has(recruiterKey)) {
      map.set(recruiterKey, {
        recruiterKey,
        recruiterUserId,
        displayName: displayNameForRecord(record, directory),
        calls: 0,
        booked: 0,
        webinarBooked: 0,
        webinarShowed: 0,
      });
    }
    const row = map.get(recruiterKey)!;
    row.calls += 1;
    const disposition = String(record.disposition || '').trim().toLowerCase();
    if (disposition !== 'booked') continue;
    row.booked += 1;
    const meta = readCallRecordMeta(record);
    const bookedSubtype = String(record.booked_subtype || meta.bookedSubtype || '').trim().toLowerCase();
    if (bookedSubtype !== 'webinar') continue;
    row.webinarBooked += 1;
    const candidateEmail = candidateEmailMap.get(record.candidate_id) || null;
    if (classifyWebinarShow(bookedSubtype, candidateEmail)) {
      row.webinarShowed += 1;
    }
  }
  for (const seed of recruiterSeeds || []) {
    if (map.has(seed.recruiterKey)) continue;
    map.set(seed.recruiterKey, {
      recruiterKey: seed.recruiterKey,
      recruiterUserId: seed.recruiterUserId,
      displayName: seed.displayName,
      calls: 0,
      booked: 0,
      webinarBooked: 0,
      webinarShowed: 0,
    });
  }
  return [...map.values()];
}

function toRows(aggregates: Aggregate[]): RecruiterLeaderboardRow[] {
  if (aggregates.length === 0) return [];
  const maxBooked = Math.max(1, ...aggregates.map((a) => a.booked));
  const maxCalls = Math.max(1, ...aggregates.map((a) => a.calls));
  const rows = aggregates.map((agg) => {
    const showRatio = showRatioFromCounts(agg.webinarShowed, agg.webinarBooked, agg.booked, agg.calls);
    const smoothed = showRatioSmoothed(agg.webinarShowed, agg.webinarBooked, agg.booked, agg.calls);
    const lowSampleFactor = Math.min(1, agg.calls / 15);
    const qualityComponent = smoothed * (0.55 + 0.45 * lowSampleFactor);
    const bookedNorm = agg.booked / maxBooked;
    const callsNorm = agg.calls / maxCalls;
    const score = 100 * ((0.5 * qualityComponent) + (0.3 * bookedNorm) + (0.2 * callsNorm));
    return {
      recruiterKey: agg.recruiterKey,
      recruiterUserId: agg.recruiterUserId,
      displayName: agg.displayName,
      calls: agg.calls,
      booked: agg.booked,
      webinarBooked: agg.webinarBooked,
      webinarShowed: agg.webinarShowed,
      showRatio,
      showRatioSmoothed: smoothed,
      bookedNorm,
      callsNorm,
      lowSampleFactor,
      score,
      rank: 0,
      previousRank: null,
      rankDelta: 0,
      passedLabel: null,
      overtakenByLabel: null,
      badges: [],
    } satisfies RecruiterLeaderboardRow;
  });

  rows.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.booked !== a.booked) return b.booked - a.booked;
    if (b.calls !== a.calls) return b.calls - a.calls;
    return a.displayName.localeCompare(b.displayName);
  });

  rows.forEach((row, index) => {
    row.rank = index + 1;
  });
  return rows;
}

function labelsForRow(row: RecruiterLeaderboardRow): string[] {
  const badges: string[] = [];
  if (row.rank === 1) badges.push('Top Performer');
  if (row.rankDelta >= 2) badges.push('Fast Climber');
  if (row.showRatioSmoothed >= 0.65 && row.calls >= 15) badges.push('Consistent Closer');
  return badges;
}

function movementLabel(
  row: RecruiterLeaderboardRow,
  previousOrder: RecruiterLeaderboardRow[],
  currentOrder: RecruiterLeaderboardRow[],
): { passedLabel: string | null; overtakenByLabel: string | null } {
  if (!row.previousRank) return { passedLabel: null, overtakenByLabel: null };
  if (row.rank < row.previousRank) {
    const priorAbove = previousOrder[row.previousRank - 2];
    if (priorAbove && currentOrder.find((x) => x.recruiterKey === priorAbove.recruiterKey)?.rank! > row.rank) {
      return { passedLabel: priorAbove.displayName, overtakenByLabel: null };
    }
    return { passedLabel: null, overtakenByLabel: null };
  }
  if (row.rank > row.previousRank) {
    const priorBelow = previousOrder[row.previousRank];
    if (priorBelow && currentOrder.find((x) => x.recruiterKey === priorBelow.recruiterKey)?.rank! < row.rank) {
      return { passedLabel: null, overtakenByLabel: priorBelow.displayName };
    }
  }
  return { passedLabel: null, overtakenByLabel: null };
}

export function buildCompositeLeaderboard(input: {
  currentRecords: PipelineCallRecord[];
  previousRecords: PipelineCallRecord[];
  candidateEmailMap: CandidateEmailMap;
  recruiterDirectory: RecruiterDirectory;
  recruiterSeeds?: LeaderboardRecruiterSeed[];
  classifyWebinarShow: (bookedSubtype: string | null, candidateEmail: string | null) => boolean;
}): RecruiterLeaderboardRow[] {
  const currentRows = toRows(
    aggregateRecords(
      input.currentRecords,
      input.candidateEmailMap,
      input.classifyWebinarShow,
      input.recruiterDirectory,
      input.recruiterSeeds,
    ),
  );
  const previousRows = toRows(
    aggregateRecords(
      input.previousRecords,
      input.candidateEmailMap,
      input.classifyWebinarShow,
      input.recruiterDirectory,
      input.recruiterSeeds,
    ),
  );

  const previousRankByKey = new Map<string, number>();
  previousRows.forEach((row) => previousRankByKey.set(row.recruiterKey, row.rank));

  currentRows.forEach((row) => {
    row.previousRank = previousRankByKey.get(row.recruiterKey) ?? null;
    row.rankDelta = row.previousRank ? row.previousRank - row.rank : 0;
  });
  currentRows.forEach((row) => {
    const movement = movementLabel(row, previousRows, currentRows);
    row.passedLabel = movement.passedLabel;
    row.overtakenByLabel = movement.overtakenByLabel;
    row.badges = labelsForRow(row);
    row.score = Math.round(row.score * 100) / 100;
  });

  return currentRows;
}


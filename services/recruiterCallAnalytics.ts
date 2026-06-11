import { DISPLAY_TIME_ZONE_CANADA_EASTERN, formatDateCanadaEastern } from './dateDisplay';
import type { HrDispositionCounts } from './pipelineHrLeadsService';
import {
  getCandidateBatchGroupKey,
  readCandidateBatchLabel,
  readCandidateSourceFilename,
} from './pipelineLeadGrouping';
import type { PipelineCallRecord, PipelineCandidate } from './pipelineService';
import {
  CALL_HOUR_END,
  CALL_HOUR_START,
  emptyDispositionCounts,
  incrementDispositionCount,
  isPickupDisposition,
  type DailyCallBar,
  type HourlyCallBar,
  type PackCallAnalytics,
} from './recruiterLeadPackAnalytics';
export type WebinarFileAnalyticsRow = {
  customField: string;
  team: string;
  showed: boolean;
};

export type SourcePerformanceBar = {
  key: string;
  label: string;
  subtitle: string;
  sourceKind: 'lead_pack' | 'webinar_file';
  totalCalls: number;
  pickups: number;
  booked: number;
  pickupRate: number;
  bookRate: number;
};

export type RecruiterCallAnalytics = PackCallAnalytics & {
  dispositionCounts: HrDispositionCounts;
  workedCount: number;
  hourlyBookedBars: HourlyCallBar[];
  bestBookingHourLabel: string | null;
  leadPackBars: SourcePerformanceBar[];
  webinarFileBars: SourcePerformanceBar[];
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

function isoInRange(iso: string, fromIso: string | null, toIso: string | null): boolean {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return false;
  if (fromIso && ms < Date.parse(fromIso)) return false;
  if (toIso && ms > Date.parse(toIso)) return false;
  return true;
}

function recordTimestamp(record: PipelineCallRecord): string {
  return record.disposed_at || record.dial_started_at || record.created_at;
}

function upsertSourceBar(
  map: Map<string, SourcePerformanceBar>,
  key: string,
  label: string,
  subtitle: string,
  sourceKind: SourcePerformanceBar['sourceKind'],
): SourcePerformanceBar {
  let row = map.get(key);
  if (!row) {
    row = {
      key,
      label,
      subtitle,
      sourceKind,
      totalCalls: 0,
      pickups: 0,
      booked: 0,
      pickupRate: 0,
      bookRate: 0,
    };
    map.set(key, row);
  }
  return row;
}

function finalizeSourceBars(map: Map<string, SourcePerformanceBar>): SourcePerformanceBar[] {
  return [...map.values()]
    .map((row) => ({
      ...row,
      pickupRate: row.totalCalls ? Math.round((row.pickups / row.totalCalls) * 100) : 0,
      bookRate: row.totalCalls ? Math.round((row.booked / row.totalCalls) * 100) : 0,
    }))
    .filter((row) => row.totalCalls > 0 || row.booked > 0)
    .sort((a, b) => b.booked - a.booked || b.pickups - a.pickups || b.totalCalls - a.totalCalls);
}

export function buildLeadPackPerformanceBars(
  records: PipelineCallRecord[],
  candidates: PipelineCandidate[],
): SourcePerformanceBar[] {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const map = new Map<string, SourcePerformanceBar>();

  for (const record of records) {
    const candidate = byId.get(record.candidate_id);
    const key = candidate ? getCandidateBatchGroupKey(candidate) : `unknown:${record.candidate_id}`;
    const label = candidate
      ? readCandidateBatchLabel(candidate) || readCandidateSourceFilename(candidate) || 'Lead pack'
      : 'Unknown pack';
    const subtitle = candidate ? readCandidateSourceFilename(candidate) || label : '';
    const row = upsertSourceBar(map, key, label, subtitle, 'lead_pack');
    row.totalCalls += 1;
    if (isPickupDisposition(record.disposition)) row.pickups += 1;
    if (String(record.disposition || '').toLowerCase() === 'booked') row.booked += 1;
  }

  return finalizeSourceBars(map);
}

export function buildWebinarFilePerformanceBars(webinars: WebinarFileAnalyticsRow[]): SourcePerformanceBar[] {
  const map = new Map<string, SourcePerformanceBar>();

  for (const row of webinars) {
    const raw = String(row.customField || '').trim() || 'registration_page';
    const key = raw.toLowerCase();
    const label = raw.length > 36 ? `${raw.slice(0, 36)}…` : raw;
    const bucket = upsertSourceBar(map, key, label, row.team || '', 'webinar_file');
    bucket.totalCalls += 1;
    if (row.showed) bucket.pickups += 1;
    bucket.booked += 1;
  }

  return finalizeSourceBars(map);
}

export function buildRecruiterCallAnalytics(
  records: PipelineCallRecord[],
  range: { fromIso: string | null; toIso: string | null },
  candidates: PipelineCandidate[],
  webinarsBooked: WebinarFileAnalyticsRow[],
): RecruiterCallAnalytics {
  const dailyMap = new Map<string, DailyCallBar>();
  const hourlyMap = new Map<number, HourlyCallBar>();
  const hourlyBookedMap = new Map<number, HourlyCallBar>();
  const weekdayPickups = new Map<string, number>();
  const dispositionCounts = emptyDispositionCounts();

  for (let hour = CALL_HOUR_START; hour <= CALL_HOUR_END; hour += 1) {
    const label = hour === 12 ? '12 PM' : hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
    hourlyMap.set(hour, { hour, label, totalCalls: 0, pickups: 0, pickupRate: 0 });
    hourlyBookedMap.set(hour, { hour, label, totalCalls: 0, pickups: 0, pickupRate: 0 });
  }

  let totalCalls = 0;
  let totalPickups = 0;
  let workedCount = 0;

  const scoped = records.filter((record) => {
    const ts = recordTimestamp(record);
    return ts && isoInRange(ts, range.fromIso, range.toIso);
  });

  for (const record of scoped) {
    const disposedAt = recordTimestamp(record);
    if (!disposedAt) continue;
    const parts = torontoParts(disposedAt);
    if (!parts) continue;

    workedCount += 1;
    totalCalls += 1;
    incrementDispositionCount(dispositionCounts, record.disposition);
    const pickup = isPickupDisposition(record.disposition);
    const booked = String(record.disposition || '').toLowerCase() === 'booked';
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
    if (booked) daily.booked += 1;

    if (parts.hour >= CALL_HOUR_START && parts.hour <= CALL_HOUR_END) {
      const hourly = hourlyMap.get(parts.hour)!;
      hourly.totalCalls += 1;
      if (pickup) hourly.pickups += 1;

      if (booked) {
        const bookedHour = hourlyBookedMap.get(parts.hour)!;
        bookedHour.totalCalls += 1;
        bookedHour.pickups += 1;
      }
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
  const hourlyBookedBars = [...hourlyBookedMap.values()].map((bar) => ({
    ...bar,
    pickupRate: bar.totalCalls ? 100 : 0,
  }));

  const bestHour = hourlyBars
    .filter((bar) => bar.totalCalls >= 2)
    .sort((a, b) => b.pickupRate - a.pickupRate || b.pickups - a.pickups)[0];
  const bestBookingHour = hourlyBookedBars
    .filter((bar) => bar.pickups >= 1)
    .sort((a, b) => b.pickups - a.pickups)[0];
  const bestDay = dailyBars
    .filter((bar) => bar.totalCalls >= 2)
    .sort((a, b) => b.pickups - a.pickups || b.totalCalls - a.totalCalls)[0];
  const bestWeekday = [...weekdayPickups.entries()].sort((a, b) => b[1] - a[1])[0];

  return {
    dailyBars,
    hourlyBars,
    hourlyBookedBars,
    bestHourLabel: bestHour ? `${bestHour.label} (${bestHour.pickupRate}% pickup)` : null,
    bestBookingHourLabel: bestBookingHour
      ? `${bestBookingHour.label} (${bestBookingHour.pickups} booking${bestBookingHour.pickups === 1 ? '' : 's'})`
      : null,
    bestDayLabel: bestDay
      ? `${bestDay.label} (${bestDay.pickups} pickups)`
      : bestWeekday
        ? `${bestWeekday[0]} (${bestWeekday[1]} pickups)`
        : null,
    totalCalls,
    totalPickups,
    avgCallsPerDay: dailyBars.length ? Math.round(totalCalls / dailyBars.length) : 0,
    dispositionCounts,
    workedCount,
    leadPackBars: buildLeadPackPerformanceBars(scoped, candidates),
    webinarFileBars: buildWebinarFilePerformanceBars(webinarsBooked),
  };
}

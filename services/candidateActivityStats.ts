import { fridayWeekBoundsFromYmd, torontoYmdFromDate } from './webinarGeekDates';
import {
  matchLiveSessionForCallDisposition,
  type LiveSessionRegistrantRow,
} from './liveSessionBookedOutcomes';
import {
  readCallRecordLiveSessionOutcome,
  readCallRecordMeta,
  readPipelineCandidateEmail,
  readPipelineCandidatePhone,
  type PipelineCallRecord,
  type PipelineCandidate,
} from './pipelineService';
import { webinarShowedFromRow } from './recruiterCoins';

export type CandidateStatsPreset = 'all' | 'last7' | 'last30' | 'friday_week';

export type CandidateActivityStats = {
  totalCalls: number;
  bookedWebinar: number;
  showedWebinar: number;
  bookedLive: number;
  showedLive: number;
  emailsSent: number;
  label: string;
};

export type CandidateStatsRange = {
  sinceIso: string | null;
  untilIso: string | null;
  label: string;
};

function inRange(iso: string, range: CandidateStatsRange): boolean {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return false;
  if (range.sinceIso && ms < Date.parse(range.sinceIso)) return false;
  if (range.untilIso && ms > Date.parse(range.untilIso)) return false;
  return true;
}

function readBookedSubtype(record: PipelineCallRecord): string {
  const meta = readCallRecordMeta(record);
  return String(record.booked_subtype || meta.bookedSubtype || '').trim().toLowerCase();
}

function liveShowFromRecord(
  record: PipelineCallRecord,
  candidate: PipelineCandidate,
  registrants: LiveSessionRegistrantRow[],
): boolean {
  const persisted = readCallRecordLiveSessionOutcome(record);
  if (persisted.status === 'attended') return true;
  if (persisted.status === 'no_show' || persisted.status === 'scheduled') return false;

  const emailInfo = readPipelineCandidateEmail(candidate);
  const phoneInfo = readPipelineCandidatePhone(candidate);
  const disposedMs = Date.parse(record.disposed_at || record.created_at);
  const outcome = matchLiveSessionForCallDisposition({
    email: emailInfo.effectiveEmail,
    candidatePhone: phoneInfo.effectivePhone,
    candidateName: candidate.full_name,
    dialedNumber: record.dialed_number,
    disposedAtMs: Number.isFinite(disposedMs) ? disposedMs : Date.now(),
    registrants,
  });
  return outcome.status === 'attended';
}

export function buildCandidateStatsRange(preset: CandidateStatsPreset, now = new Date()): CandidateStatsRange {
  if (preset === 'all') {
    return { sinceIso: null, untilIso: null, label: 'All time' };
  }
  if (preset === 'last7') {
    const since = new Date(now);
    since.setDate(since.getDate() - 6);
    since.setHours(0, 0, 0, 0);
    return { sinceIso: since.toISOString(), untilIso: null, label: 'Last 7 days' };
  }
  if (preset === 'last30') {
    const since = new Date(now);
    since.setDate(since.getDate() - 29);
    since.setHours(0, 0, 0, 0);
    return { sinceIso: since.toISOString(), untilIso: null, label: 'Last 30 days' };
  }
  const week = fridayWeekBoundsFromYmd(torontoYmdFromDate(now));
  const since = new Date(`${week.since}T00:00:00`);
  const until = new Date(`${week.until}T23:59:59.999`);
  return { sinceIso: since.toISOString(), untilIso: until.toISOString(), label: `This week (${week.title})` };
}

export function computeCandidateActivityStats(input: {
  candidate: PipelineCandidate;
  records: PipelineCallRecord[];
  webinarRows?: Array<Record<string, unknown>>;
  registrants?: LiveSessionRegistrantRow[];
  emailsSent?: number;
  range: CandidateStatsRange;
}): CandidateActivityStats {
  const candidateRecords = input.records.filter((row) => row.candidate_id === input.candidate.id);
  const scopedRecords = candidateRecords.filter((row) =>
    inRange(row.disposed_at || row.created_at, input.range),
  );

  let bookedWebinar = 0;
  let showedWebinar = 0;
  let bookedLive = 0;
  let showedLive = 0;

  for (const record of scopedRecords) {
    const disposition = String(record.disposition || '').trim().toLowerCase();
    if (disposition !== 'booked') continue;
    const subtype = readBookedSubtype(record);
    if (subtype === 'live session') {
      bookedLive += 1;
      if (liveShowFromRecord(record, input.candidate, input.registrants || [])) {
        showedLive += 1;
      }
    } else {
      bookedWebinar += 1;
    }
  }

  const email = readPipelineCandidateEmail(input.candidate).effectiveEmail.toLowerCase();
  const webinarRows = (input.webinarRows || []).filter((row) => {
    const rowEmail = String(row.email || '').trim().toLowerCase();
    if (!email || rowEmail !== email) return false;
    if (!inRange(String(row.created_at || row.watched_true_set_at || ''), input.range)) return false;
    return webinarShowedFromRow(row);
  });
  showedWebinar += webinarRows.length;

  return {
    totalCalls: scopedRecords.length,
    bookedWebinar,
    showedWebinar,
    bookedLive,
    showedLive,
    emailsSent: input.emailsSent ?? 0,
    label: input.range.label,
  };
}

export function liveSessionStatusLabel(
  record: PipelineCallRecord,
  candidate: PipelineCandidate | null,
  registrants: LiveSessionRegistrantRow[],
): string {
  if (readBookedSubtype(record) !== 'live session') return '—';
  const persisted = readCallRecordLiveSessionOutcome(record);
  if (persisted.status === 'attended') return 'Live show';
  if (persisted.status === 'scheduled') return 'Live booked';
  if (persisted.status === 'no_show') return 'Live no-show';
  if (!candidate) return 'Pending match';
  const emailInfo = readPipelineCandidateEmail(candidate);
  const phoneInfo = readPipelineCandidatePhone(candidate);
  const disposedMs = Date.parse(record.disposed_at || record.created_at);
  const outcome = matchLiveSessionForCallDisposition({
    email: emailInfo.effectiveEmail,
    candidatePhone: phoneInfo.effectivePhone,
    candidateName: candidate.full_name,
    dialedNumber: record.dialed_number,
    disposedAtMs: Number.isFinite(disposedMs) ? disposedMs : Date.now(),
    registrants,
  });
  if (outcome.status === 'attended') return 'Live show';
  if (outcome.status === 'scheduled') return 'Live booked';
  if (outcome.status === 'no_show') return 'Live no-show';
  return 'Pending match';
}

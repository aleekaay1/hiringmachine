import type { UserProfile } from './accessControl';
import { listAllUserProfiles } from './accessControl';
import { filterRowsForRecruiterOwnership } from './recruiterDataScope';
import {
  candidateDisplayNameFromRow,
  fileTagNameFromRow,
  recruiterTeamFromRow,
} from './webinarGeekInviters';
import { fetchWebinarGeekDashboard } from './webinarGeekIntegrations';
import {
  loadWebinarGeekDashboardCache,
  saveWebinarGeekDashboardCache,
  subscriptionsFromDashboardData,
} from './webinarGeekDashboardCache';
import { fetchWindowBoundsWide, fridayWeekBoundsFromYmd, torontoYmdFromDate } from './webinarGeekDates';
import {
  fmtHrScheduledDateKey,
  fmtWebinarSessionDateKey,
} from './webinarGeekRecruiterAnalytics';
import { webinarShowedFromRow } from './recruiterCoins';
import {
  buildLiveSessionRowsByEmail,
  liveSessionAttendedFromRegistrant,
  loadCandidateEmailsById,
  loadLiveSessionRegistrantsForMatching,
  pickRegistrantForDisposition,
} from './liveSessionBookedOutcomes';
import {
  listPipelineCallRecords,
  listPipelineEmailSendLogsByCandidates,
  listPipelineIncomingEmailLogsByCandidates,
  type PipelineCallRecord,
} from './pipelineService';
import { loadRecruiterCoinBalanceMap } from './recruiterCoinService';
import { supabase } from './supabaseClient';

type AnyRow = Record<string, unknown>;

export type ReportDatePreset = 'all' | 'last7' | 'last30' | 'this_month' | 'friday_week' | 'custom';

export type ReportDateRange = {
  preset: ReportDatePreset;
  sinceYmd: string | null;
  untilYmd: string | null;
  fromIso: string | null;
  toIso: string | null;
  label: string;
};

export type ReportCallRow = {
  id: string;
  disposedAt: string;
  disposition: string;
  bookedSubtype: string;
  candidateId: string;
  dialedNumber: string;
  comment: string | null;
  recruiterLabel: string | null;
};

export type ReportWebinarRow = {
  id: string;
  candidateName: string;
  email: string;
  team: string;
  scheduledOnYmd: string;
  sessionYmd: string;
  watched: boolean;
  showed: boolean;
  watchMinutes: number;
  customField: string;
};

export type ReportLiveSessionRow = {
  callRecordId: string;
  candidateEmail: string;
  sessionDate: string;
  attended: boolean;
  disposedAt: string;
};

export type ReportEmailRow = {
  id: string;
  at: string;
  direction: 'sent' | 'received';
  subject: string;
  toOrFrom: string;
  status: string;
};

export type RecruiterReportSummary = {
  totalCalls: number;
  bookedCalls: number;
  emailsSent: number;
  emailReplies: number;
  webinarBooked: number;
  webinarShowed: number;
  liveBooked: number;
  liveShowed: number;
  pazCoins: number;
};

export type RecruiterReportBundle = {
  profile: UserProfile;
  generatedAt: string;
  range: ReportDateRange;
  summary: RecruiterReportSummary;
  calls: ReportCallRow[];
  webinarsBooked: ReportWebinarRow[];
  webinarShows: ReportWebinarRow[];
  liveSessions: ReportLiveSessionRow[];
  emails: ReportEmailRow[];
  dataSources: {
    webinarFromCache: boolean;
    webinarFetchedAt: string | null;
  };
};

export type StaffReportCard = {
  profile: UserProfile;
  summary: RecruiterReportSummary;
};

const REPORTABLE_ROLES = new Set(['recruiter', 'leadership', 'webinar', 'hr', 'viewer']);

export function isReportableRole(role: string | undefined | null): boolean {
  return REPORTABLE_ROLES.has(String(role || ''));
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function isoStartOfYmd(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0).toISOString();
}

function isoEndOfYmd(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 23, 59, 59, 999).toISOString();
}

export function buildReportDateRange(
  preset: ReportDatePreset,
  custom?: { sinceYmd: string; untilYmd: string },
  now = new Date(),
): ReportDateRange {
  const today = torontoYmdFromDate(now);

  if (preset === 'all') {
    return {
      preset,
      sinceYmd: null,
      untilYmd: null,
      fromIso: null,
      toIso: null,
      label: 'All time',
    };
  }

  if (preset === 'friday_week') {
    const week = fridayWeekBoundsFromYmd(today);
    return {
      preset,
      sinceYmd: week.since,
      untilYmd: week.until,
      fromIso: isoStartOfYmd(week.since),
      toIso: isoEndOfYmd(week.until),
      label: `This week (Fri–Thu) · ${week.title}`,
    };
  }

  if (preset === 'custom' && custom?.sinceYmd && custom?.untilYmd) {
    return {
      preset,
      sinceYmd: custom.sinceYmd,
      untilYmd: custom.untilYmd,
      fromIso: isoStartOfYmd(custom.sinceYmd),
      toIso: isoEndOfYmd(custom.untilYmd),
      label: `${custom.sinceYmd} → ${custom.untilYmd}`,
    };
  }

  if (preset === 'this_month') {
    const sinceYmd = `${today.slice(0, 7)}-01`;
    const [y, m] = today.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const untilYmd = `${y}-${pad2(m)}-${pad2(lastDay)}`;
    return {
      preset,
      sinceYmd,
      untilYmd,
      fromIso: isoStartOfYmd(sinceYmd),
      toIso: isoEndOfYmd(untilYmd),
      label: `This month · ${sinceYmd} → ${untilYmd}`,
    };
  }

  const daysBack = preset === 'last30' ? 29 : 6;
  const end = new Date(now);
  const start = new Date(now);
  start.setDate(end.getDate() - daysBack);
  const sinceYmd = torontoYmdFromDate(start);
  const untilYmd = today;
  return {
    preset,
    sinceYmd,
    untilYmd,
    fromIso: isoStartOfYmd(sinceYmd),
    toIso: isoEndOfYmd(untilYmd),
    label: preset === 'last30' ? 'Last 30 days' : 'Last 7 days',
  };
}

function ymdInRange(ymd: string, sinceYmd: string | null, untilYmd: string | null): boolean {
  const key = String(ymd || '').trim();
  if (!key || key === 'unknown') return !sinceYmd && !untilYmd;
  if (sinceYmd && key < sinceYmd) return false;
  if (untilYmd && key > untilYmd) return false;
  return true;
}

function isoInRange(iso: string, fromIso: string | null, toIso: string | null): boolean {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return false;
  if (fromIso && ms < Date.parse(fromIso)) return false;
  if (toIso && ms > Date.parse(toIso)) return false;
  return true;
}

function webinarRowKey(row: AnyRow): string {
  const id = String(row.id ?? row.subscription_id ?? '').trim();
  if (id) return id;
  return `${String(row.email || '')}|${String(row.custom_field || '')}`;
}

/** Booked in range: scheduled-on OR session date (matches Calls Analytics when invite date is missing). */
function webinarRowBookedInRange(
  row: AnyRow,
  sinceYmd: string | null,
  untilYmd: string | null,
): boolean {
  const scheduled = fmtHrScheduledDateKey(row);
  const session = fmtWebinarSessionDateKey(row);
  return ymdInRange(scheduled, sinceYmd, untilYmd) || ymdInRange(session, sinceYmd, untilYmd);
}

function countWebinarsBookedInRange(
  rows: AnyRow[],
  sinceYmd: string | null,
  untilYmd: string | null,
): number {
  const seen = new Set<string>();
  let count = 0;
  for (const row of rows) {
    if (!webinarRowBookedInRange(row, sinceYmd, untilYmd)) continue;
    const key = webinarRowKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    count += 1;
  }
  return count;
}

function filterWebinarsBookedInRange(
  rows: AnyRow[],
  sinceYmd: string | null,
  untilYmd: string | null,
): AnyRow[] {
  const seen = new Set<string>();
  const out: AnyRow[] = [];
  for (const row of rows) {
    if (!webinarRowBookedInRange(row, sinceYmd, untilYmd)) continue;
    const key = webinarRowKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function readBookedSubtype(record: PipelineCallRecord): string {
  const meta = record.threecx_metadata && typeof record.threecx_metadata === 'object' ? record.threecx_metadata : {};
  return String(
    record.booked_subtype ||
      (meta as Record<string, unknown>).booked_subtype ||
      (meta as Record<string, unknown>).bookedSubtype ||
      '',
  )
    .trim()
    .toLowerCase();
}

function mapWebinarRow(row: AnyRow): ReportWebinarRow {
  const sec = Number(row.watch_duration || 0);
  const watchMinutes = Number.isFinite(sec) && sec > 0 ? Math.round(sec / 60) : 0;
  return {
    id: String(row.id ?? row.subscription_id ?? ''),
    candidateName: candidateDisplayNameFromRow(row) || fileTagNameFromRow(row),
    email: String(row.email || ''),
    team: recruiterTeamFromRow(row),
    scheduledOnYmd: fmtHrScheduledDateKey(row),
    sessionYmd: fmtWebinarSessionDateKey(row),
    watched: row.watched === true,
    showed: webinarShowedFromRow(row),
    watchMinutes,
    customField: String(row.custom_field || ''),
  };
}

function summarizeCalls(calls: PipelineCallRecord[]): Pick<RecruiterReportSummary, 'totalCalls' | 'bookedCalls'> {
  return {
    totalCalls: calls.length,
    bookedCalls: calls.filter((r) => String(r.disposition || '').toLowerCase() === 'booked').length,
  };
}

function buildLiveSessionsForRecruiter(
  calls: PipelineCallRecord[],
  candidateEmailById: Map<string, string>,
  liveByEmail: ReturnType<typeof buildLiveSessionRowsByEmail>,
  range: ReportDateRange,
): { rows: ReportLiveSessionRow[]; booked: number; showed: number } {
  const rows: ReportLiveSessionRow[] = [];
  let booked = 0;
  let showed = 0;

  for (const record of calls) {
    if (String(record.disposition || '').toLowerCase() !== 'booked') continue;
    if (readBookedSubtype(record) !== 'live session') continue;
    booked += 1;
    const email = candidateEmailById.get(record.candidate_id);
    if (!email) continue;
    const liveRows = liveByEmail.get(email) || [];
    const disposedMs = Date.parse(record.disposed_at || record.created_at);
    const match = pickRegistrantForDisposition(liveRows, Number.isFinite(disposedMs) ? disposedMs : Date.now());
    const attended = match ? liveSessionAttendedFromRegistrant(match) : false;
    if (attended) showed += 1;
    if (!isoInRange(record.disposed_at || record.created_at, range.fromIso, range.toIso)) continue;
    rows.push({
      callRecordId: record.id,
      candidateEmail: email,
      sessionDate: match?.session_date || '—',
      attended,
      disposedAt: record.disposed_at || record.created_at,
    });
  }

  return { rows, booked, showed };
}

export async function listReportableStaff(): Promise<UserProfile[]> {
  const profiles = await listAllUserProfiles();
  return profiles.filter((p) => isReportableRole(p.role));
}

export async function refreshReportSourcesFromRemote(): Promise<{
  ok: boolean;
  webinarCount: number;
  fetchedAt?: string;
  error?: string;
}> {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;
  if (!session?.access_token) {
    return { ok: false, webinarCount: 0, error: 'Not signed in' };
  }

  let token = session.access_token;
  const expiresAtMs = (session.expires_at || 0) * 1000;
  if (expiresAtMs <= Date.now() + 60_000) {
    const { data: refreshed } = await supabase.auth.refreshSession();
    token = refreshed.session?.access_token || token;
  }

  const { since, until, label } = fetchWindowBoundsWide();
  const result = await fetchWebinarGeekDashboard(token, {
    perPage: 250,
    since,
    until,
    includeCatalog: false,
    maxPages: 36,
  });

  if (!result.ok) {
    return {
      ok: false,
      webinarCount: 0,
      error: 'error' in result ? result.error : 'WebinarGeek fetch failed',
    };
  }

  const rows = subscriptionsFromDashboardData(result.data);
  await saveWebinarGeekDashboardCache({
    subscriptions: rows,
    fetchSince: since,
    fetchUntil: until,
    fetchLabel: label,
  });

  return { ok: true, webinarCount: rows.length, fetchedAt: new Date().toISOString() };
}

async function loadWebinarRows(): Promise<{ rows: AnyRow[]; fetchedAt: string | null }> {
  const cached = await loadWebinarGeekDashboardCache();
  return {
    rows: cached.data?.subscriptions || [],
    fetchedAt: cached.data?.fetchedAt ?? null,
  };
}

export async function loadRecruiterReport(
  profile: UserProfile,
  range: ReportDateRange,
): Promise<RecruiterReportBundle> {
  const userId = profile.user_id;

  const [{ rows: webinarAll, fetchedAt }, callRecords, coinMap, liveRegs] = await Promise.all([
    loadWebinarRows(),
    listPipelineCallRecords({
      recruiterUserId: userId,
      fromIso: range.fromIso,
      toIso: range.toIso,
      limit: 8000,
    }),
    loadRecruiterCoinBalanceMap(),
    loadLiveSessionRegistrantsForMatching(),
  ]);

  const scopedWebinar = filterRowsForRecruiterOwnership(
    webinarAll,
    profile.email ?? null,
    profile.full_name ?? null,
  );

  const webinarsBooked = filterWebinarsBookedInRange(scopedWebinar, range.sinceYmd, range.untilYmd)
    .map(mapWebinarRow)
    .sort((a, b) => b.scheduledOnYmd.localeCompare(a.scheduledOnYmd));

  const webinarShows = scopedWebinar
    .filter((row) => webinarShowedFromRow(row))
    .filter((row) => {
      const showYmd = row.watched === true ? fmtWebinarSessionDateKey(row) : fmtHrScheduledDateKey(row);
      return ymdInRange(showYmd, range.sinceYmd, range.untilYmd);
    })
    .map(mapWebinarRow)
    .sort((a, b) => b.sessionYmd.localeCompare(a.sessionYmd));

  const calls: ReportCallRow[] = callRecords.map((row) => ({
    id: row.id,
    disposedAt: row.disposed_at || row.created_at,
    disposition: row.disposition,
    bookedSubtype: readBookedSubtype(row),
    candidateId: row.candidate_id,
    dialedNumber: row.dialed_number,
    comment: row.comment,
    recruiterLabel: row.recruiter_label,
  }));

  const candidateIds = [...new Set(callRecords.map((r) => r.candidate_id).filter(Boolean))];
  const candidateEmailById = await loadCandidateEmailsById(candidateIds);
  const liveByEmail = buildLiveSessionRowsByEmail(liveRegs);
  const live = buildLiveSessionsForRecruiter(callRecords, candidateEmailById, liveByEmail, range);

  const [emailSentLogs, inbound] = await Promise.all([
    listPipelineEmailSendLogsByCandidates(candidateIds, {
      fromIso: range.fromIso,
      toIso: range.toIso,
      limit: 3000,
    }),
    listPipelineIncomingEmailLogsByCandidates(candidateIds, {
      fromIso: range.fromIso,
      toIso: range.toIso,
    }),
  ]);

  const emails: ReportEmailRow[] = [
    ...emailSentLogs.map((row) => ({
      id: row.id,
      at: row.created_at,
      direction: 'sent' as const,
      subject: row.subject || 'Email sent',
      toOrFrom: row.to_email,
      status: row.status || 'sent',
    })),
    ...inbound.map((row) => ({
      id: row.id,
      at: row.received_at,
      direction: 'received' as const,
      subject: row.subject || '(no subject)',
      toOrFrom: row.from_email,
      status: row.candidate_id ? 'mapped' : 'unmapped',
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const callStats = summarizeCalls(callRecords);

  return {
    profile,
    generatedAt: new Date().toISOString(),
    range,
    summary: {
      totalCalls: callStats.totalCalls,
      bookedCalls: 0,
      emailsSent: emailSentLogs.length,
      emailReplies: inbound.length,
      webinarBooked: webinarsBooked.length,
      webinarShowed: webinarShows.length,
      liveBooked: 0,
      liveShowed: 0,
      pazCoins: coinMap.get(userId) ?? Number(profile.points || 0),
    },
    calls,
    webinarsBooked,
    webinarShows,
    liveSessions: live.rows,
    emails,
    dataSources: {
      webinarFromCache: webinarAll.length > 0,
      webinarFetchedAt: fetchedAt,
    },
  };
}

export async function loadTeamReportCards(
  profiles: UserProfile[],
  range: ReportDateRange,
): Promise<StaffReportCard[]> {
  const [{ rows: webinarAll }, coinMap] = await Promise.all([
    loadWebinarRows(),
    loadRecruiterCoinBalanceMap(),
  ]);

  return profiles.map((profile) => {
    const scopedWebinar = filterRowsForRecruiterOwnership(
      webinarAll,
      profile.email ?? null,
      profile.full_name ?? null,
    );
    const webinarsBookedCount = countWebinarsBookedInRange(
      scopedWebinar,
      range.sinceYmd,
      range.untilYmd,
    );
    const webinarShows = scopedWebinar.filter(
      (row) =>
        webinarShowedFromRow(row) &&
        ymdInRange(fmtWebinarSessionDateKey(row), range.sinceYmd, range.untilYmd),
    );

    return {
      profile,
      summary: {
        totalCalls: 0,
        bookedCalls: 0,
        emailsSent: 0,
        emailReplies: 0,
        webinarBooked: webinarsBookedCount,
        webinarShowed: webinarShows.length,
        liveBooked: 0,
        liveShowed: 0,
        pazCoins: coinMap.get(profile.user_id) ?? Number(profile.points || 0),
      },
    };
  });
}

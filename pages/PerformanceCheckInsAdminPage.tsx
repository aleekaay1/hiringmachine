import React from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart3,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Mail,
  RefreshCw,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import PipelineAuthShell from '../components/PipelineAuthShell';
import {
  DailyWeekBars,
  ImprovementLadderChart,
  MetricsBarChart,
  MonthActivityStrip,
  MonthlyWeekBars,
  PaceGauge,
  PaceRing,
  TeamPaceChart,
  WeekActivityStrip,
} from '../components/coaching/CoachingCharts';
import { Button } from '../components/UI';
import { formatDateTimeCanadaEastern } from '../services/dateDisplay';
import { getCurrentUserProfile } from '../services/accessControl';
import {
  loadFullCoachingHub,
  listRecentFridayWeeks,
  listRecentMonths,
  type CoachingBoardPerson,
  type CoachingEmailLogRow,
  type CoachingHubViewMode,
} from '../services/coachingBoardService';
import {
  canAccessPerformanceCheckInAdmin,
  currentFridayWeekBounds,
  deletePerformanceCheckIns,
  labelForBlocker,
  labelForHelp,
  labelForTroubleArea,
  PERFORMANCE_CHECKIN_AUTOMATION_ENABLED,
} from '../services/performanceCheckInService';
import { COACHING_WEEKLY_BOOKING_TARGET, monthlyBookingTarget } from '../services/coachingPace';
import {
  fridayWeekBoundsFromYmd,
  shiftYmdDays,
  torontoMonthStartToday,
  ymdToShortLabel,
} from '../services/webinarGeekDates';

function hintStyles(tone: CoachingBoardPerson['hint']['tone']): string {
  if (tone === 'positive') return 'border-emerald-200 bg-emerald-50 text-emerald-900';
  if (tone === 'critical') return 'border-rose-200 bg-rose-50 text-rose-900';
  if (tone === 'warning') return 'border-amber-200 bg-amber-50 text-amber-900';
  return 'border-[#d4e4f7] bg-[#f8fbff] text-[#0B1B34]';
}

function StatChip({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="min-w-[4.5rem] rounded-lg border border-[#e8f0fa] bg-[#f8fbff] px-2.5 py-1.5 text-center">
      <p className="text-[9px] font-semibold uppercase tracking-wide text-[#5c7594]">{label}</p>
      <p className={`text-sm font-semibold tabular-nums ${accent || 'text-[#0B1B34]'}`}>{value}</p>
    </div>
  );
}

function paceColor(pct: number | null): string {
  if (pct === null) return 'text-[#5c7594]';
  if (pct < 50) return 'text-rose-600';
  if (pct >= 85) return 'text-emerald-700';
  return 'text-[#0B1B34]';
}

function PersonCard({
  person,
  expanded,
  selected,
  onToggle,
  onSelectForm,
  elapsedDays,
  viewMode,
  ladderWeekFilter,
}: {
  person: CoachingBoardPerson;
  expanded: boolean;
  selected: boolean;
  onToggle: () => void;
  onSelectForm: (checked: boolean) => void;
  elapsedDays: number;
  viewMode: CoachingHubViewMode;
  ladderWeekFilter: Set<string>;
}) {
  const formId = person.form?.id;
  const ladderPoints = React.useMemo(() => {
    if (!ladderWeekFilter.size) return person.ladder;
    return person.ladder.filter((pt) => ladderWeekFilter.has(pt.weekSince));
  }, [person.ladder, ladderWeekFilter]);

  return (
    <article
      className={`overflow-hidden rounded-2xl border transition-all duration-200 ${
        person.belowThreshold
          ? 'border-rose-200/80 bg-gradient-to-br from-white to-rose-50/40 shadow-sm'
          : 'border-[#d4e4f7] bg-white'
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-start gap-3 px-4 py-3.5 text-left hover:bg-[#f8fbff]/80"
      >
        <ChevronDown
          size={18}
          className={`mt-0.5 shrink-0 text-[#5c7594] transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
        />
        {formId && (
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => {
              e.stopPropagation();
              onSelectForm(e.target.checked);
            }}
            onClick={(e) => e.stopPropagation()}
            className="mt-1 rounded border-[#c9d9ee]"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-[#0B1B34]">{person.displayName}</h3>
            <span className="rounded-full bg-[#eef6ff] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#4e79a9]">
              {person.role}
            </span>
            {person.belowThreshold && (
              <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-800">
                Below 50%
              </span>
            )}
            {person.emailSent && (
              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-800">Emailed</span>
            )}
            {person.form && (
              <span className="rounded-full bg-[#dbeafe] px-2 py-0.5 text-[10px] font-medium text-[#1d4ed8]">Form in</span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-[#5c7594]">{person.email}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
            <span className={`font-semibold tabular-nums ${paceColor(person.callsPacePct)}`}>
              Calls {person.callsPacePct ?? '—'}%
            </span>
            <span className="text-[#c9d9ee]">·</span>
            <span className={`font-semibold tabular-nums ${paceColor(person.bookingsPacePct)}`}>
              Bookings {person.bookingsPacePct ?? '—'}%
            </span>
            <span className="text-[#c9d9ee]">·</span>
            <span className="text-[#5c7594]">
              {person.actualCalls} calls · {person.actualBooked} booked
            </span>
          </div>
          {!expanded && (
            <p className={`mt-2 inline-block max-w-full truncate rounded-lg border px-2 py-1 text-[11px] ${hintStyles(person.hint.tone)}`}>
              {person.hint.title}
            </p>
          )}
        </div>
      </button>

      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          <div className="space-y-4 border-t border-[#e8f0fa] px-4 pb-5 pt-4">
            <div className={`rounded-xl border px-3 py-2 text-xs ${hintStyles(person.hint.tone)}`}>
              <p className="font-semibold">{person.hint.title}</p>
              <p className="mt-0.5 opacity-90">{person.hint.detail}</p>
            </div>

            <div className="flex flex-wrap items-center gap-6">
              <PaceRing pct={person.callsPacePct} label="Calls" />
              <PaceRing pct={person.bookingsPacePct} label="Bookings" />
              <div className="min-w-[200px] flex-1 space-y-3">
                <PaceGauge
                  label="Calls pace"
                  pct={person.callsPacePct}
                  actual={person.actualCalls}
                  expected={person.expectedCalls}
                  compact
                />
                <PaceGauge
                  label="Bookings pace"
                  pct={person.bookingsPacePct}
                  actual={person.actualBooked}
                  expected={person.expectedBookings}
                  compact
                />
              </div>
            </div>

            {viewMode === 'week' ? (
            <DailyWeekBars
              days={person.daily}
              highlightThroughDay={elapsedDays - 1}
              tall
            />
            ) : (
            <MonthlyWeekBars weeks={person.monthlyWeeks} tall />
            )}

            <div className="flex flex-wrap gap-2">
              <StatChip label="Calls" value={person.actualCalls} />
              <StatChip label="Webinar booked" value={person.webinarBooked} />
              <StatChip label="Webinar showed" value={person.webinarShowed} accent="text-emerald-700" />
              <StatChip label="Live booked" value={person.liveSessionBooked} />
              <StatChip label="Live showed" value={person.liveSessionShowed} accent="text-emerald-700" />
              <StatChip
                label="Show rate"
                value={person.showRatePct !== null ? `${person.showRatePct}%` : '—'}
                accent={
                  person.showRatePct !== null && person.showRatePct < 40
                    ? 'text-rose-600'
                    : person.showRatePct !== null && person.showRatePct >= 60
                      ? 'text-emerald-700'
                      : undefined
                }
              />
              <StatChip label="Rank" value={person.leaderboardRank ?? '—'} />
              <StatChip
                label="Score"
                value={person.leaderboardScore !== null ? Math.round(person.leaderboardScore) : '—'}
              />
              <span className="self-center rounded-full bg-[#eef6ff] px-2 py-1 text-[10px] font-medium text-[#4e79a9]">
                Target{' '}
                {viewMode === 'month'
                  ? `${monthlyBookingTarget(person.monthlyWeeks.length)} bookings/mo`
                  : `${COACHING_WEEKLY_BOOKING_TARGET} bookings/wk`}
              </span>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-[#e8f0fa] bg-[#f8fbff] p-4">
                <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#4e79a9]">
                  {viewMode === 'month' ? 'Month activity' : 'Week activity'}
                </p>
                {viewMode === 'month' ? (
                  <MonthActivityStrip
                    weeks={person.monthlyWeeks}
                    totalCalls={person.actualCalls}
                    totalBooked={person.actualBooked}
                  />
                ) : (
                  <WeekActivityStrip
                    days={person.daily}
                    totalCalls={person.actualCalls}
                    totalBooked={person.actualBooked}
                  />
                )}
              </div>
              <div className="rounded-xl border border-[#e8f0fa] bg-[#f8fbff] p-4">
                <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#4e79a9]">Outcomes</p>
                <MetricsBarChart
                  calls={person.actualCalls}
                  webinarBooked={person.webinarBooked}
                  webinarShowed={person.webinarShowed}
                  liveBooked={person.liveSessionBooked}
                  liveShowed={person.liveSessionShowed}
                />
              </div>
            </div>

            <div className="rounded-xl border border-[#e8f0fa] bg-[#f8fbff] p-4">
                <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#4e79a9]">
                  {viewMode === 'month' ? 'Bookings pace · this month' : 'Improvement ladder · week-over-week'}
                </p>
                <ImprovementLadderChart
                  points={ladderPoints.map((p) => ({
                    weekLabel: p.weekLabel,
                    shortLabel: ymdToShortLabel(p.weekSince),
                    combinedPacePct: p.combinedPacePct,
                    bookingsPacePct: p.bookingsPacePct,
                    belowThreshold: p.belowThreshold,
                    hasForm: p.hasForm,
                    actualCalls: p.actualCalls,
                    actualBooked: p.actualBooked,
                  }))}
                />
                {ladderPoints.length > 0 && (
                <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {ladderPoints.map((pt) => (
                    <div
                      key={pt.weekSince}
                      className={`rounded-xl border p-3 text-sm ${
                        pt.belowThreshold ? 'border-rose-200 bg-rose-50/50' : 'border-[#e8f0fa] bg-white'
                      }`}
                    >
                      <p className="font-medium text-[#0B1B34]">{ymdToShortLabel(pt.weekSince)}</p>
                      <p
                        className="text-lg font-bold tabular-nums"
                        style={{ color: (pt.bookingsPacePct ?? pt.combinedPacePct) !== null && (pt.bookingsPacePct ?? pt.combinedPacePct ?? 0) < 50 ? '#e11d48' : '#059669' }}
                      >
                        {pt.bookingsPacePct ?? pt.combinedPacePct ?? '—'}%
                      </p>
                      <p className="text-xs text-[#5c7594]">
                        {pt.actualCalls} calls · {pt.actualBooked} booked
                        {pt.hasForm ? ' · form ✓' : ''}
                      </p>
                    </div>
                  ))}
                </div>
                )}
            </div>

            {person.form ? (
              <>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#4e79a9]">Coaching form</p>
                <div className="grid gap-3 rounded-xl border border-[#e8f0fa] bg-[#f8fbff] p-3 text-sm sm:grid-cols-2">
                  <p>
                    <span className="text-[#5c7594]">Blocker:</span> {labelForBlocker(person.form.blocker_category)}
                  </p>
                  <p>
                    <span className="text-[#5c7594]">Help:</span> {labelForHelp(person.form.help_needed)}
                  </p>
                  <p className="sm:col-span-2">
                    <span className="text-[#5c7594]">Struggling with:</span>{' '}
                    {(person.form.trouble_areas || []).map(labelForTroubleArea).join(', ') || '—'}
                  </p>
                  <p className="whitespace-pre-wrap sm:col-span-2">
                    <span className="text-[#5c7594]">Notes:</span> {person.form.comments || '—'}
                  </p>
                  <p className="text-xs text-[#5c7594]">
                    Submitted {formatDateTimeCanadaEastern(person.form.submitted_at)}
                    {person.form.needs_coaching ? ' · wants follow-up' : ''}
                    {person.form.status === 'reviewed' ? ' · reviewed' : ''}
                  </p>
                </div>
              </>
            ) : person.belowThreshold ? (
              <p className="text-sm text-[#5c7594]">No form submitted yet for this week.</p>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

const PerformanceCheckInsAdminPage: React.FC = () => {
  const defaultWeek = currentFridayWeekBounds().since;
  const [viewMode, setViewMode] = React.useState<CoachingHubViewMode>('week');
  const [weekSince, setWeekSince] = React.useState(defaultWeek);
  const [monthFirstYmd, setMonthFirstYmd] = React.useState(torontoMonthStartToday());
  const [agentFilter, setAgentFilter] = React.useState<string>('all');
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [accessDenied, setAccessDenied] = React.useState(false);
  const [people, setPeople] = React.useState<CoachingBoardPerson[]>([]);
  const [summary, setSummary] = React.useState<Awaited<ReturnType<typeof loadFullCoachingHub>>['summary'] | null>(null);
  const [emailLogs, setEmailLogs] = React.useState<CoachingEmailLogRow[]>([]);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [selectedFormIds, setSelectedFormIds] = React.useState<Set<string>>(new Set());
  const [filter, setFilter] = React.useState<'all' | 'below' | 'forms'>('all');
  const [deleting, setDeleting] = React.useState(false);

  const weekOptions = React.useMemo(() => listRecentFridayWeeks(26), []);
  const monthOptions = React.useMemo(() => listRecentMonths(12), []);
  const defaultLadderWeeks = React.useMemo(
    () => weekOptions.slice(0, 6).map((w) => w.since),
    [weekOptions],
  );
  const [selectedLadderWeeks, setSelectedLadderWeeks] = React.useState<string[]>(defaultLadderWeeks);
  const ladderWeekFilter = React.useMemo(() => new Set(selectedLadderWeeks), [selectedLadderWeeks]);

  React.useEffect(() => {
    if (!selectedLadderWeeks.length && defaultLadderWeeks.length) {
      setSelectedLadderWeeks(defaultLadderWeeks);
    }
  }, [defaultLadderWeeks, selectedLadderWeeks.length]);

  const loadBoard = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const profile = await getCurrentUserProfile();
      if (!profile || !canAccessPerformanceCheckInAdmin(profile.role, profile.email)) {
        setAccessDenied(true);
        return;
      }
      const hub = await loadFullCoachingHub(
        viewMode === 'week' ? weekSince : monthFirstYmd,
        new Date(),
        {
          mode: viewMode,
          monthFirstYmd: viewMode === 'month' ? monthFirstYmd : undefined,
          historyWeeks: 26,
        },
      );
      setPeople(hub.people);
      setSummary(hub.summary);
      setEmailLogs(hub.emailLogs);
      setExpandedId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [weekSince, monthFirstYmd, viewMode]);

  React.useEffect(() => {
    setExpandedId(agentFilter !== 'all' ? agentFilter : null);
  }, [agentFilter]);

  React.useEffect(() => {
    void loadBoard();
  }, [loadBoard]);

  const filteredPeople = React.useMemo(() => {
    let rows = people;
    if (filter === 'below') rows = rows.filter((p) => p.belowThreshold);
    if (filter === 'forms') rows = rows.filter((p) => p.form);
    if (agentFilter !== 'all') rows = rows.filter((p) => p.userId === agentFilter);
    return rows;
  }, [people, filter, agentFilter]);

  const chartPeople = React.useMemo(() => {
    if (agentFilter === 'all') return people;
    return people.filter((p) => p.userId === agentFilter);
  }, [people, agentFilter]);

  const teamPaceRows = React.useMemo(
    () =>
      chartPeople.map((p) => ({
        userId: p.userId,
        name: p.displayName,
        pacePct: p.bookingsPacePct,
        belowThreshold: p.belowThreshold,
        calls: p.actualCalls,
        booked: p.actualBooked,
      })),
    [chartPeople],
  );

  const teamTotals = React.useMemo(
    () =>
      chartPeople.reduce(
        (acc, p) => ({
          calls: acc.calls + p.actualCalls,
          webinarBooked: acc.webinarBooked + p.webinarBooked,
          webinarShowed: acc.webinarShowed + p.webinarShowed,
          liveBooked: acc.liveBooked + p.liveSessionBooked,
          liveShowed: acc.liveShowed + p.liveSessionShowed,
        }),
        { calls: 0, webinarBooked: 0, webinarShowed: 0, liveBooked: 0, liveShowed: 0 },
      ),
    [chartPeople],
  );

  const shiftWeek = (delta: number) => {
    setWeekSince(shiftYmdDays(weekSince, delta * 7));
    setSelectedFormIds(new Set());
    setExpandedId(null);
  };

  const toggleFormSelect = (id: string, checked: boolean) => {
    setSelectedFormIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const deleteSelected = async () => {
    if (!selectedFormIds.size) return;
    if (!window.confirm(`Delete ${selectedFormIds.size} form submission(s)? This cannot be undone.`)) return;
    setDeleting(true);
    setError(null);
    try {
      await deletePerformanceCheckIns([...selectedFormIds]);
      setSelectedFormIds(new Set());
      await loadBoard();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  };

  const scrollToPerson = (userId: string) => {
    setExpandedId(userId);
    requestAnimationFrame(() => {
      document.getElementById(`coaching-person-${userId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  if (accessDenied) {
    return (
      <PipelineAuthShell title="Coaching" subtitle="Admin access required" redirectPath="/performance-check-ins">
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">
          You do not have access to the coaching hub.
        </div>
      </PipelineAuthShell>
    );
  }

  const weekBounds = fridayWeekBoundsFromYmd(weekSince);
  const periodLabel =
    summary?.weekLabel ??
    (viewMode === 'month'
      ? monthOptions.find((m) => m.firstYmd === monthFirstYmd)?.label
      : weekBounds.title);

  return (
    <PipelineAuthShell title="Coaching hub" subtitle="Mid-week performance & improvement" redirectPath="/performance-check-ins">
      <div className="mx-auto w-full max-w-[1240px] space-y-4 p-1">
        <div className="rounded-3xl border border-[#d4e4f7] bg-gradient-to-br from-[#0B1B34] via-[#12325c] to-[#1a4a7a] p-5 text-white shadow-lg">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-[0.28em] text-[#9ec5ea]">Leadership coaching</p>
              <h1 className="text-2xl font-semibold">Mid-week coaching hub</h1>
              <p className="mt-1 max-w-2xl text-sm text-[#c5daf0]">
                Below-50% callers get the automated email. One refresh loads everyone — click a caller to expand stats &
                history.
              </p>
            </div>
            <ClipboardList className="text-[#7ec0ff]" size={32} />
          </div>

          {summary && (
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {[
                { label: 'Team', value: summary.teamCount, color: 'text-white' },
                { label: 'Below 50%', value: summary.belowCount, color: 'text-rose-300' },
                { label: 'Forms in', value: summary.formCount, color: 'text-sky-300' },
                { label: 'Emails sent', value: summary.emailSentCount, color: 'text-emerald-300' },
                { label: 'Day of week', value: summary.elapsedDays, color: 'text-amber-300' },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-[#9ec5ea]">{item.label}</p>
                  <p className={`mt-1 text-2xl font-semibold tabular-nums ${item.color}`}>{item.value}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="overflow-x-auto rounded-2xl border border-[#d4e4f7] bg-white p-3">
          <div className="flex min-w-max flex-wrap items-center gap-2">
            <div className="flex rounded-xl border border-[#d4e4f7] p-0.5">
              {(['week', 'month'] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setViewMode(id);
                    setExpandedId(null);
                    setSelectedFormIds(new Set());
                  }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    viewMode === id ? 'bg-[#0B1B34] text-white' : 'text-[#5c7594] hover:bg-[#f8fbff]'
                  }`}
                >
                  {id === 'week' ? 'Week' : 'Month'}
                </button>
              ))}
            </div>

            {viewMode === 'week' ? (
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => shiftWeek(1)} className="rounded-lg p-2 hover:bg-[#f0f6ff]" aria-label="Previous week">
                <ChevronLeft size={18} />
              </button>
              <select
                className="rounded-xl border border-[#c9d9ee] px-3 py-2 text-sm"
                value={weekSince}
                onChange={(e) => {
                  setWeekSince(e.target.value);
                  setSelectedFormIds(new Set());
                  setExpandedId(null);
                }}
              >
                {weekOptions.map((w) => (
                  <option key={w.since} value={w.since}>
                    {w.label}
                  </option>
                ))}
              </select>
              <button type="button" onClick={() => shiftWeek(-1)} className="rounded-lg p-2 hover:bg-[#f0f6ff]" aria-label="Next week">
                <ChevronRight size={18} />
              </button>
            </div>
            ) : (
            <select
              className="rounded-xl border border-[#c9d9ee] px-3 py-2 text-sm"
              value={monthFirstYmd}
              onChange={(e) => {
                setMonthFirstYmd(e.target.value);
                setSelectedFormIds(new Set());
                setExpandedId(null);
              }}
            >
              {monthOptions.map((m) => (
                <option key={m.firstYmd} value={m.firstYmd}>
                  {m.label}
                </option>
              ))}
            </select>
            )}

            <select
              className="max-w-[220px] rounded-xl border border-[#c9d9ee] px-3 py-2 text-sm"
              value={agentFilter}
              onChange={(e) => {
                setAgentFilter(e.target.value);
                setExpandedId(e.target.value === 'all' ? null : e.target.value);
              }}
            >
              <option value="all">All agents</option>
              {people.map((p) => (
                <option key={p.userId} value={p.userId}>
                  {p.displayName}
                </option>
              ))}
            </select>

            <details className="relative">
              <summary className="cursor-pointer list-none rounded-xl border border-[#c9d9ee] px-3 py-2 text-sm text-[#0B1B34] marker:content-none">
                Ladder weeks ({selectedLadderWeeks.length})
              </summary>
              <div className="absolute left-0 z-20 mt-1 max-h-64 w-64 overflow-y-auto rounded-xl border border-[#d4e4f7] bg-white p-3 shadow-lg">
                <div className="mb-2 flex flex-wrap gap-1">
                  {[3, 4, 6, 8, 10, 12].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setSelectedLadderWeeks(weekOptions.slice(0, n).map((w) => w.since))}
                      className="rounded-lg border border-[#d4e4f7] px-2 py-1 text-[10px] font-medium text-[#4e79a9] hover:bg-[#f8fbff]"
                    >
                      Last {n}
                    </button>
                  ))}
                </div>
                {weekOptions.map((w) => {
                  const checked = selectedLadderWeeks.includes(w.since);
                  return (
                    <label key={w.since} className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1 text-xs hover:bg-[#f8fbff]">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          setSelectedLadderWeeks((prev) =>
                            e.target.checked
                              ? [...new Set([...prev, w.since])].sort((a, b) => b.localeCompare(a))
                              : prev.filter((v) => v !== w.since),
                          );
                        }}
                      />
                      <span>{w.label}</span>
                    </label>
                  );
                })}
              </div>
            </details>

            <div className="flex rounded-xl border border-[#d4e4f7] p-0.5">
              {(['all', 'below', 'forms'] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFilter(id)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    filter === id ? 'bg-[#0B1B34] text-white' : 'text-[#5c7594] hover:bg-[#f8fbff]'
                  }`}
                >
                  {id === 'all' ? 'Everyone' : id === 'below' ? 'Below 50%' : 'Has form'}
                </button>
              ))}
            </div>

            <Button variant="secondary" onClick={() => void loadBoard()} disabled={loading}>
              <RefreshCw size={14} className={`mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>

            {selectedFormIds.size > 0 && (
              <Button variant="secondary" onClick={() => void deleteSelected()} disabled={deleting}>
                <Trash2 size={14} className="mr-2" />
                Delete {selectedFormIds.size}
              </Button>
            )}

            {!PERFORMANCE_CHECKIN_AUTOMATION_ENABLED && (
              <span className="shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900">
                Email automation off (testing)
              </span>
            )}
          </div>
        </div>

        {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div>}

        {loading && (
          <div className="rounded-2xl border border-[#d4e4f7] bg-white p-10 text-center text-sm text-[#5c7594]">
            Loading coaching data for the full team…
          </div>
        )}

        {!loading && people.length > 0 && (
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-2xl border border-[#d4e4f7] bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <BarChart3 size={18} className="text-[#4e9ae8]" />
                <h2 className="text-sm font-semibold text-[#0B1B34]">
                  {agentFilter === 'all'
                    ? viewMode === 'month'
                      ? 'Team pace · this month'
                      : 'Team pace · this week'
                    : `${chartPeople[0]?.displayName ?? 'Agent'} pace`}
                </h2>
              </div>
              <p className="mb-3 text-xs text-[#5c7594]">
                {summary?.weekLabel ?? periodLabel}
                {agentFilter === 'all' ? ' · click a row to expand caller' : ' · single-agent view'}
              </p>
              <TeamPaceChart rows={teamPaceRows} onSelect={agentFilter === 'all' ? scrollToPerson : undefined} />
            </section>

            <section className="rounded-2xl border border-[#d4e4f7] bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <TrendingUp size={18} className="text-[#4e9ae8]" />
                <h2 className="text-sm font-semibold text-[#0B1B34]">
                  {agentFilter === 'all' ? 'Team activity' : 'Agent outcomes'}
                </h2>
              </div>
              {viewMode === 'month' && agentFilter !== 'all' && chartPeople[0] ? (
                <MonthActivityStrip
                  weeks={chartPeople[0].monthlyWeeks}
                  totalCalls={chartPeople[0].actualCalls}
                  totalBooked={chartPeople[0].actualBooked}
                />
              ) : (
              <MetricsBarChart
                calls={teamTotals.calls}
                webinarBooked={teamTotals.webinarBooked}
                webinarShowed={teamTotals.webinarShowed}
                liveBooked={teamTotals.liveBooked}
                liveShowed={teamTotals.liveShowed}
              />
              )}
            </section>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-xs text-[#5c7594]">
            {loading
              ? '…'
              : `${filteredPeople.length} caller${filteredPeople.length === 1 ? '' : 's'} · all collapsed · click to expand`}
          </p>
          {!loading && filteredPeople.length === 0 && (
            <div className="rounded-2xl border border-[#d4e4f7] bg-white p-8 text-center text-sm text-[#5c7594]">
              No callers match this filter.
            </div>
          )}
          {!loading &&
            filteredPeople.map((person) => (
              <div key={person.userId} id={`coaching-person-${person.userId}`}>
                <PersonCard
                  person={person}
                  expanded={expandedId === person.userId}
                  selected={Boolean(person.form && selectedFormIds.has(person.form.id))}
                  elapsedDays={summary?.elapsedDays ?? 7}
                  viewMode={viewMode}
                  ladderWeekFilter={ladderWeekFilter}
                  onToggle={() => setExpandedId((id) => (id === person.userId ? null : person.userId))}
                  onSelectForm={(checked) => {
                    if (person.form) toggleFormSelect(person.form.id, checked);
                  }}
                />
              </div>
            ))}
        </div>

        <div className="rounded-2xl border border-[#d4e4f7] bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Mail size={18} className="text-[#4e9ae8]" />
              <h2 className="text-sm font-semibold text-[#0B1B34]">Coaching emails</h2>
            </div>
            <Link to="/email-log" className="text-xs text-[#4e79a9] hover:underline">
              Full email log →
            </Link>
          </div>
          {emailLogs.length === 0 ? (
            <p className="text-sm text-[#5c7594]">No mid-week coaching emails logged yet.</p>
          ) : (
            <div className="max-h-48 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-[#5c7594]">
                    <th className="pb-2 pr-3">When</th>
                    <th className="pb-2 pr-3">To</th>
                    <th className="pb-2 pr-3">Subject</th>
                    <th className="pb-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {emailLogs.map((row) => (
                    <tr key={row.id} className="border-t border-[#eef4fb]">
                      <td className="py-2 pr-3 text-[#5c7594]">{formatDateTimeCanadaEastern(row.created_at)}</td>
                      <td className="py-2 pr-3">{row.to_email}</td>
                      <td className="py-2 pr-3">{row.subject}</td>
                      <td className="py-2">{row.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="flex items-center gap-2 text-xs text-[#5c7594]">
          <TrendingUp size={14} />
          Recruiters fill the form at{' '}
          <Link to="/performance-check-in" className="text-[#4e79a9] hover:underline">
            /performance-check-in
          </Link>
        </p>
      </div>
    </PipelineAuthShell>
  );
};

export default PerformanceCheckInsAdminPage;

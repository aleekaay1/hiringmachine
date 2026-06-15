import React from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Mail,
  RefreshCw,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import PipelineAuthShell from '../components/PipelineAuthShell';
import { DailyWeekBars, ImprovementLadderChart, PaceGauge } from '../components/coaching/CoachingCharts';
import { Button } from '../components/UI';
import { formatDateTimeCanadaEastern } from '../services/dateDisplay';
import { getCurrentUserProfile } from '../services/accessControl';
import {
  loadCoachingBoard,
  loadCoachingEmailLogs,
  loadUserImprovementLadder,
  listRecentFridayWeeks,
  type CoachingBoardPerson,
  type CoachingEmailLogRow,
  type CoachingWeekPoint,
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
import { fridayWeekBoundsFromYmd, shiftYmdDays, ymdToShortLabel } from '../services/webinarGeekDates';

type TabId = 'board' | 'ladder';

function hintStyles(tone: CoachingBoardPerson['hint']['tone']): string {
  if (tone === 'positive') return 'border-emerald-200 bg-emerald-50 text-emerald-900';
  if (tone === 'critical') return 'border-rose-200 bg-rose-50 text-rose-900';
  if (tone === 'warning') return 'border-amber-200 bg-amber-50 text-amber-900';
  return 'border-[#d4e4f7] bg-[#f8fbff] text-[#0B1B34]';
}

function PersonCard({
  person,
  expanded,
  selected,
  onToggle,
  onSelectForm,
  elapsedDays,
}: {
  person: CoachingBoardPerson;
  expanded: boolean;
  selected: boolean;
  onToggle: () => void;
  onSelectForm: (checked: boolean) => void;
  elapsedDays: number;
}) {
  const formId = person.form?.id;
  return (
    <article
      className={`rounded-2xl border transition-all duration-300 ${
        person.belowThreshold
          ? 'border-rose-200/80 bg-gradient-to-br from-white to-rose-50/40 shadow-sm'
          : 'border-[#d4e4f7] bg-white'
      }`}
    >
      <button type="button" onClick={onToggle} className="w-full px-4 py-4 text-left">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
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
            <div>
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
                  <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-800">
                    Emailed
                  </span>
                )}
                {person.form && (
                  <span className="rounded-full bg-[#dbeafe] px-2 py-0.5 text-[10px] font-medium text-[#1d4ed8]">
                    Form in
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-[#5c7594]">{person.email}</p>
            </div>
          </div>
          <div className={`max-w-xs rounded-xl border px-3 py-2 text-xs ${hintStyles(person.hint.tone)}`}>
            <p className="font-semibold">{person.hint.title}</p>
            <p className="mt-0.5 opacity-90">{person.hint.detail}</p>
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr_1.2fr]">
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
          <DailyWeekBars days={person.daily} highlightThroughDay={elapsedDays - 1} />
        </div>
      </button>

      {expanded && person.form && (
        <div className="border-t border-[#e8f0fa] px-4 pb-4 pt-3 animate-in fade-in duration-300">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#4e79a9]">Coaching form</p>
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
            <p className="sm:col-span-2 whitespace-pre-wrap">
              <span className="text-[#5c7594]">Notes:</span> {person.form.comments || '—'}
            </p>
            <p className="text-xs text-[#5c7594]">
              Submitted {formatDateTimeCanadaEastern(person.form.submitted_at)}
              {person.form.needs_coaching ? ' · wants follow-up' : ''}
              {person.form.status === 'reviewed' ? ' · reviewed' : ''}
            </p>
          </div>
        </div>
      )}
      {expanded && !person.form && person.belowThreshold && (
        <div className="border-t border-[#e8f0fa] px-4 pb-4 pt-3 text-sm text-[#5c7594]">
          No form submitted yet for this week.
        </div>
      )}
    </article>
  );
}

const PerformanceCheckInsAdminPage: React.FC = () => {
  const defaultWeek = currentFridayWeekBounds().since;
  const [tab, setTab] = React.useState<TabId>('board');
  const [weekSince, setWeekSince] = React.useState(defaultWeek);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [accessDenied, setAccessDenied] = React.useState(false);
  const [people, setPeople] = React.useState<CoachingBoardPerson[]>([]);
  const [summary, setSummary] = React.useState<Awaited<ReturnType<typeof loadCoachingBoard>>['summary'] | null>(null);
  const [emailLogs, setEmailLogs] = React.useState<CoachingEmailLogRow[]>([]);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [selectedFormIds, setSelectedFormIds] = React.useState<Set<string>>(new Set());
  const [filter, setFilter] = React.useState<'all' | 'below' | 'forms'>('all');
  const [deleting, setDeleting] = React.useState(false);

  const [ladderUserId, setLadderUserId] = React.useState<string>('');
  const [ladderPoints, setLadderPoints] = React.useState<CoachingWeekPoint[]>([]);
  const [ladderLoading, setLadderLoading] = React.useState(false);
  const [ladderPerson, setLadderPerson] = React.useState<CoachingBoardPerson | null>(null);

  const weekOptions = React.useMemo(() => listRecentFridayWeeks(16), []);

  const loadBoard = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const profile = await getCurrentUserProfile();
      if (!profile || !canAccessPerformanceCheckInAdmin(profile.role, profile.email)) {
        setAccessDenied(true);
        return;
      }
      const [board, logs] = await Promise.all([loadCoachingBoard(weekSince), loadCoachingEmailLogs(30)]);
      setPeople(board.people);
      setSummary(board.summary);
      setEmailLogs(logs);
      if (!ladderUserId && board.people[0]) setLadderUserId(board.people[0].userId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [weekSince, ladderUserId]);

  React.useEffect(() => {
    void loadBoard();
  }, [loadBoard]);

  React.useEffect(() => {
    if (!ladderUserId) return;
    let cancelled = false;
    setLadderLoading(true);
    void loadUserImprovementLadder(ladderUserId, 12)
      .then((pts) => {
        if (!cancelled) setLadderPoints(pts);
      })
      .catch(() => {
        if (!cancelled) setLadderPoints([]);
      })
      .finally(() => {
        if (!cancelled) setLadderLoading(false);
      });
    setLadderPerson(people.find((p) => p.userId === ladderUserId) ?? null);
    return () => {
      cancelled = true;
    };
  }, [ladderUserId, people]);

  const filteredPeople = React.useMemo(() => {
    if (filter === 'below') return people.filter((p) => p.belowThreshold);
    if (filter === 'forms') return people.filter((p) => p.form);
    return people;
  }, [people, filter]);

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

  return (
    <PipelineAuthShell title="Coaching hub" subtitle="Mid-week performance & improvement" redirectPath="/performance-check-ins">
      <div className="mx-auto w-full max-w-[1240px] space-y-4 p-1">
        <div className="rounded-3xl border border-[#d4e4f7] bg-gradient-to-br from-[#0B1B34] via-[#12325c] to-[#1a4a7a] p-5 text-white shadow-lg">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-[0.28em] text-[#9ec5ea]">Leadership coaching</p>
              <h1 className="text-2xl font-semibold">Mid-week coaching hub</h1>
              <p className="mt-1 max-w-2xl text-sm text-[#c5daf0]">
                Below-50% callers only get the automated email. Review live stats, forms, and week-over-week improvement
                in one place.
              </p>
            </div>
            <ClipboardList className="text-[#7ec0ff]" size={32} />
          </div>

          {summary && (
            <div className="mt-5 grid gap-3 sm:grid-cols-4">
              {[
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

        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#d4e4f7] bg-white p-3">
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => shiftWeek(1)} className="rounded-lg p-2 hover:bg-[#f0f6ff]" aria-label="Previous week">
              <ChevronLeft size={18} />
            </button>
            <select
              className="rounded-xl border border-[#c9d9ee] px-3 py-2 text-sm"
              value={weekSince}
              onChange={(e) => setWeekSince(e.target.value)}
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

          <div className="flex rounded-xl border border-[#d4e4f7] p-0.5">
            {(['board', 'ladder'] as TabId[]).map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  tab === id ? 'bg-[#0B1B34] text-white' : 'text-[#5c7594] hover:bg-[#f8fbff]'
                }`}
              >
                {id === 'board' ? 'This week' : 'Improvement ladder'}
              </button>
            ))}
          </div>

          <div className="flex rounded-xl border border-[#d4e4f7] p-0.5">
            {(['all', 'below', 'forms'] as const).map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  filter === id ? 'bg-[#eef6ff] text-[#0B1B34]' : 'text-[#5c7594]'
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
            <span className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900">
              Email automation off (testing)
            </span>
          )}
        </div>

        {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div>}

        {tab === 'board' && (
          <div className="space-y-3">
            <p className="text-xs text-[#5c7594]">
              Week {ymdToShortLabel(weekBounds.since)} → {ymdToShortLabel(weekBounds.until)} · sorted top performers first
            </p>
            {loading && <div className="rounded-2xl border border-[#d4e4f7] bg-white p-8 text-center text-sm text-[#5c7594]">Loading coaching data…</div>}
            {!loading && filteredPeople.length === 0 && (
              <div className="rounded-2xl border border-[#d4e4f7] bg-white p-8 text-center text-sm text-[#5c7594]">
                No callers with targets match this filter.
              </div>
            )}
            {filteredPeople.map((person) => (
              <PersonCard
                key={person.userId}
                person={person}
                expanded={expandedId === person.userId}
                selected={Boolean(person.form && selectedFormIds.has(person.form.id))}
                elapsedDays={summary?.elapsedDays ?? 7}
                onToggle={() => setExpandedId((id) => (id === person.userId ? null : person.userId))}
                onSelectForm={(checked) => {
                  if (person.form) toggleFormSelect(person.form.id, checked);
                }}
              />
            ))}
          </div>
        )}

        {tab === 'ladder' && (
          <div className="space-y-4 rounded-2xl border border-[#d4e4f7] bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[220px] flex-1">
                <label className="mb-1 block text-xs font-medium text-[#5c7594]">Caller</label>
                <select
                  className="w-full rounded-xl border border-[#c9d9ee] px-3 py-2 text-sm"
                  value={ladderUserId}
                  onChange={(e) => setLadderUserId(e.target.value)}
                >
                  {people.map((p) => (
                    <option key={p.userId} value={p.userId}>
                      {p.displayName}
                    </option>
                  ))}
                </select>
              </div>
              {ladderPerson && (
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full bg-[#eef6ff] px-2 py-1 text-[#0B1B34]">
                    Calls {ladderPerson.callsPacePct ?? '—'}%
                  </span>
                  <span className="rounded-full bg-[#eef6ff] px-2 py-1 text-[#0B1B34]">
                    Bookings {ladderPerson.bookingsPacePct ?? '—'}%
                  </span>
                </div>
              )}
            </div>

            {ladderLoading ? (
              <p className="text-sm text-[#5c7594]">Loading history…</p>
            ) : (
              <>
                <ImprovementLadderChart
                  points={ladderPoints.map((p) => ({
                    weekLabel: p.weekLabel,
                    combinedPacePct: p.combinedPacePct,
                    belowThreshold: p.belowThreshold,
                    hasForm: p.hasForm,
                  }))}
                />
                {ladderPerson && (
                  <DailyWeekBars days={ladderPerson.daily} highlightThroughDay={(summary?.elapsedDays ?? 7) - 1} />
                )}
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {ladderPoints.map((pt) => (
                    <div key={pt.weekSince} className="rounded-xl border border-[#e8f0fa] p-3 text-sm">
                      <p className="font-medium text-[#0B1B34]">{pt.weekLabel}</p>
                      <p className="text-[#5c7594]">Pace {pt.combinedPacePct ?? '—'}%</p>
                      <p className="text-xs text-[#5c7594]">
                        {pt.actualCalls} calls · {pt.actualBooked} booked
                        {pt.hasForm ? ' · form ✓' : ''}
                      </p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

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

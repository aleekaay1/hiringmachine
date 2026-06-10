import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  BarChart3,
  ChevronRight,
  Moon,
  Phone,
  RefreshCw,
  Sparkles,
  Sun,
  Target,
} from 'lucide-react';
import PipelineAuthShell from '../components/PipelineAuthShell';
import { Button } from '../components/UI';
import {
  DailyCallVolumeChart,
  DispositionBreakdownChart,
  HourlyPickupChart,
  PackInsightCard,
} from '../components/pipeline/RecruiterPackCharts';
import { formatHrLeadTeamDisplay, hrLeadTeamBadgeClass } from '../services/hrLeadTeamCategories';
import { groupPipelineCandidatesByBatch } from '../services/pipelineLeadGrouping';
import {
  buildLeadPackStats,
  buildPackCallAnalytics,
  callCountByCandidate,
  filterRecordsForPack,
  latestRecordByCandidate,
  saveDialQueueIntent,
  type LeadPackStats,
} from '../services/recruiterLeadPackAnalytics';
import {
  listPipelineCallRecords,
  listPipelineManualCandidates,
  type PipelineCandidate,
  type PipelineCallRecord,
} from '../services/pipelineService';
import { supabase } from '../services/supabaseClient';

type WorkspaceThemeMode = 'dark' | 'light';
type DetailTab = 'overview' | 'analysis';

const WORKSPACE_THEME_STORAGE_KEY = 'pipeline-recruiter-workspace-theme';

function StatBadge({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className={`rounded-xl border px-3 py-2 ${accent || 'border-[#e3edf8] bg-white'}`}>
      <p className="text-[10px] uppercase tracking-wide text-[#6b84a8]">{label}</p>
      <p className="text-lg font-bold text-[#0B1B34]">{value}</p>
      {sub && <p className="text-[10px] text-[#6b84a8]">{sub}</p>}
    </div>
  );
}

const LeadManagerPage: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [candidates, setCandidates] = React.useState<PipelineCandidate[]>([]);
  const [records, setRecords] = React.useState<PipelineCallRecord[]>([]);
  const [selectedPackKey, setSelectedPackKey] = React.useState<string | null>(null);
  const [detailTab, setDetailTab] = React.useState<DetailTab>('overview');
  const [themeMode, setThemeMode] = React.useState<WorkspaceThemeMode>('light');

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(WORKSPACE_THEME_STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') setThemeMode(stored);
  }, []);

  const loadData = React.useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'initial') setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id ?? null;
      const rows = await listPipelineManualCandidates();
      const sorted = [...rows].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
      setCandidates(sorted);
      const candidateIds = sorted.map((row) => row.id);
      const callRows =
        candidateIds.length && uid
          ? await listPipelineCallRecords({ candidateIds, recruiterUserId: uid, limit: 8000 })
          : [];
      setRecords(callRows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    void loadData('initial');
  }, [loadData]);

  const latestByCandidate = React.useMemo(() => latestRecordByCandidate(records), [records]);
  const callsByCandidate = React.useMemo(() => callCountByCandidate(records), [records]);

  const isCandidateNew = React.useCallback(
    (candidate: PipelineCandidate) => !latestByCandidate.get(candidate.id),
    [latestByCandidate],
  );

  const batchGroups = React.useMemo(
    () =>
      groupPipelineCandidatesByBatch(candidates, {
        isNew: isCandidateNew,
        isInProgress: (candidate) => !isCandidateNew(candidate),
        isDone: (candidate) => Boolean(latestByCandidate.get(candidate.id)),
      }),
    [candidates, isCandidateNew, latestByCandidate],
  );

  const packStats = React.useMemo(
    () =>
      batchGroups
        .map((group) => buildLeadPackStats(group, latestByCandidate))
        .sort((a, b) => b.priorityScore - a.priorityScore || b.sortTimestamp - a.sortTimestamp),
    [batchGroups, latestByCandidate],
  );

  React.useEffect(() => {
    if (!packStats.length) {
      setSelectedPackKey(null);
      return;
    }
    if (!selectedPackKey || !packStats.some((pack) => pack.key === selectedPackKey)) {
      setSelectedPackKey(packStats[0].key);
    }
  }, [packStats, selectedPackKey]);

  const selectedPack = React.useMemo(
    () => packStats.find((pack) => pack.key === selectedPackKey) ?? null,
    [packStats, selectedPackKey],
  );

  const selectedGroup = React.useMemo(
    () => batchGroups.find((group) => group.key === selectedPackKey) ?? null,
    [batchGroups, selectedPackKey],
  );

  const packAnalytics = React.useMemo(() => {
    if (!selectedPackKey || !selectedGroup) return null;
    const packRecords = filterRecordsForPack(records, candidates, selectedPackKey);
    const ids = new Set(selectedGroup.items.map((row) => row.id));
    return buildPackCallAnalytics(packRecords, ids, 14);
  }, [selectedPackKey, selectedGroup, records, candidates]);

  const startDialingPack = (pack: LeadPackStats, mode: 'first' | 'resume' = 'first') => {
    saveDialQueueIntent({
      batchKey: pack.key,
      batchTitle: pack.title,
      startMode: mode,
    });
    const params = new URLSearchParams({
      batch: pack.key,
      mode,
    });
    navigate(`/pipeline/call?${params.toString()}`);
  };

  const isDark = themeMode === 'dark';
  const tone = React.useMemo(
    () => ({
      page: isDark ? 'text-slate-100' : 'text-[#0B1B34]',
      pageTheme: isDark ? 'dark' : '',
      glassPanel: isDark
        ? 'border-white/10 bg-slate-900/70 backdrop-blur-xl'
        : 'border-[#cde0f4] bg-white/85 backdrop-blur-xl',
      panelTitle: isDark ? 'text-white' : 'text-[#0B1B34]',
      panelMuted: isDark ? 'text-slate-400' : 'text-[#6b84a8]',
      panelLabel: isDark ? 'text-slate-300' : 'text-[#4b6d95]',
      actionButton: isDark
        ? 'border-white/20 bg-white/10 text-white hover:bg-white/15'
        : 'border-[#bad4ee] bg-white/75 text-[#0B1B34] hover:bg-white',
      input: isDark
        ? 'border-white/15 bg-white/5 text-slate-100'
        : 'border-[#bfd6ee] bg-white text-[#13243f]',
      packCard: (active: boolean) =>
        active
          ? isDark
            ? 'border-cyan-400/50 bg-cyan-500/10'
            : 'border-[#7eb3e7] bg-[#e8f3ff]'
          : isDark
            ? 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'
            : 'border-[#e3edf8] bg-[#fafcff] hover:bg-[#f4f8ff]',
    }),
    [isDark],
  );

  const topPick = packStats[0] ?? null;

  return (
    <PipelineAuthShell
      title="Lead Manager"
      subtitle="Sign in to review your lead packs and calling analytics"
      redirectPath="/pipeline/lead-manager"
    >
      <div className={`mx-auto w-full max-w-[1320px] space-y-4 p-4 md:p-6 ${tone.page}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className={`text-[10px] uppercase tracking-[0.2em] ${tone.panelLabel}`}>Workstation</p>
            <h1 className={`text-2xl font-bold ${tone.panelTitle}`}>Lead Manager</h1>
            <p className={`mt-1 max-w-2xl text-sm ${tone.panelMuted}`}>
              See every lead pack with full stats, compare performance, and jump straight into the dialer on the pack you
              want to work today.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setThemeMode((prev) => (prev === 'dark' ? 'light' : 'dark'))}
              className={`inline-flex items-center gap-1 rounded-xl border px-3 py-2 text-xs font-semibold ${tone.actionButton}`}
            >
              {isDark ? <Sun size={13} /> : <Moon size={13} />}
              {isDark ? 'Light' : 'Dark'}
            </button>
            <Button
              variant="outline"
              className="!min-h-0 h-9 gap-1.5 text-xs"
              onClick={() => void loadData('refresh')}
              disabled={loading || refreshing}
            >
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
              Refresh
            </Button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {topPick && !loading && (
          <PackInsightCard
            title="Today's suggested pack"
            body={`${topPick.title} — ${topPick.recommendation}`}
            tone={tone}
            accent={topPick.insightTone}
          />
        )}

        <div className="grid gap-4 xl:grid-cols-[minmax(300px,380px)_1fr]">
          <section className={`rounded-2xl border p-4 ${tone.glassPanel}`}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className={`flex items-center gap-2 text-sm font-semibold ${tone.panelTitle}`}>
                <Target size={15} />
                Your lead packs ({packStats.length})
              </p>
            </div>

            {loading ? (
              <div className={`flex items-center justify-center gap-2 py-16 text-sm ${tone.panelMuted}`}>
                <RefreshCw size={16} className="animate-spin" />
                Loading packs…
              </div>
            ) : !packStats.length ? (
              <div className={`rounded-xl border border-dashed p-6 text-center text-sm ${tone.panelMuted}`}>
                No assigned leads yet. HR distributes packs through Lead distribution, or add your own from{' '}
                <Link to="/pipeline/call" className="font-semibold text-[#005EB8] hover:underline">
                  Call workspace
                </Link>
                .
              </div>
            ) : (
              <div className="max-h-[min(72vh,760px)] space-y-2 overflow-auto pr-1">
                {packStats.map((pack, index) => {
                  const active = pack.key === selectedPackKey;
                  return (
                    <button
                      key={pack.key}
                      type="button"
                      onClick={() => setSelectedPackKey(pack.key)}
                      className={`w-full rounded-xl border p-3 text-left transition ${tone.packCard(active)}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {index === 0 && (
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-semibold text-emerald-800">
                                Top pick
                              </span>
                            )}
                            {pack.team && (
                              <span
                                className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold ${hrLeadTeamBadgeClass(pack.team)}`}
                              >
                                {formatHrLeadTeamDisplay(pack.team)}
                              </span>
                            )}
                          </div>
                          <p className={`mt-1 truncate text-sm font-semibold ${tone.panelTitle}`}>{pack.title}</p>
                          <p className={`truncate text-[11px] ${tone.panelMuted}`}>{pack.subtitle}</p>
                        </div>
                        <ChevronRight size={14} className={`mt-1 shrink-0 ${tone.panelLabel}`} />
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <span className="rounded-full bg-[#edf5ff] px-2 py-0.5 text-[10px] font-semibold text-[#285082]">
                          {pack.assignedCount} leads
                        </span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                          {pack.notContactedCount} new
                        </span>
                        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-800">
                          {pack.bookedCount} booked
                        </span>
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                          {pack.pickupRate}% pickup
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section className={`rounded-2xl border p-4 ${tone.glassPanel}`}>
            {!selectedPack || !selectedGroup ? (
              <p className={`py-16 text-center text-sm ${tone.panelMuted}`}>Select a lead pack to see analytics.</p>
            ) : (
              <motion.div
                key={selectedPack.key}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className="space-y-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className={`text-[10px] uppercase tracking-[0.2em] ${tone.panelLabel}`}>Pack detail</p>
                    <h2 className={`text-xl font-semibold ${tone.panelTitle}`}>{selectedPack.title}</h2>
                    <p className={`text-xs ${tone.panelMuted}`}>{selectedPack.subtitle}</p>
                    {selectedPack.sourceFilename && (
                      <p className={`mt-1 text-[11px] ${tone.panelLabel}`}>File: {selectedPack.sourceFilename}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button className="!min-h-0 h-9 gap-1.5 text-xs" onClick={() => startDialingPack(selectedPack, 'first')}>
                      <Phone size={14} />
                      Start dialing
                    </Button>
                    <Button
                      variant="outline"
                      className="!min-h-0 h-9 text-xs"
                      onClick={() => startDialingPack(selectedPack, 'resume')}
                    >
                      Resume pack
                    </Button>
                  </div>
                </div>

                <PackInsightCard
                  title="Coach note"
                  body={selectedPack.recommendation}
                  tone={tone}
                  accent={selectedPack.insightTone}
                />

                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <StatBadge label="Assigned" value={selectedPack.assignedCount} />
                  <StatBadge
                    label="Not contacted"
                    value={selectedPack.notContactedCount}
                    accent="border-sky-200 bg-sky-50"
                  />
                  <StatBadge label="Contact rate" value={`${selectedPack.contactRate}%`} sub={`${selectedPack.workedCount} worked`} />
                  <StatBadge
                    label="Book rate"
                    value={`${selectedPack.bookRate}%`}
                    sub={`${selectedPack.bookedCount} booked`}
                    accent="border-violet-200 bg-violet-50"
                  />
                  <StatBadge
                    label="Pickup rate"
                    value={`${selectedPack.pickupRate}%`}
                    sub={`${selectedPack.pickupCount} conversations`}
                    accent="border-emerald-200 bg-emerald-50"
                  />
                  <StatBadge
                    label="No answer"
                    value={`${selectedPack.noAnswerRate}%`}
                    sub={`${selectedPack.dispositionCounts.no_answer} leads`}
                    accent="border-amber-200 bg-amber-50"
                  />
                  <StatBadge
                    label="Callbacks"
                    value={selectedPack.dispositionCounts.callback_requested}
                    accent="border-sky-200 bg-sky-50"
                  />
                  <StatBadge
                    label="Pack calls"
                    value={packAnalytics?.totalCalls ?? 0}
                    sub={packAnalytics?.avgCallsPerDay ? `~${packAnalytics.avgCallsPerDay}/day` : undefined}
                  />
                </div>

                <div className="flex gap-1 rounded-xl border border-[#e3edf8] bg-[#f8fbff] p-1">
                  {([
                    { id: 'overview' as const, label: 'Overview' },
                    { id: 'analysis' as const, label: 'Calling analysis' },
                  ]).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setDetailTab(tab.id)}
                      className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                        detailTab === tab.id
                          ? 'bg-white text-[#285082] shadow-sm'
                          : 'text-[#6b84a8] hover:text-[#285082]'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {detailTab === 'overview' ? (
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="rounded-xl border border-[#e3edf8] bg-white p-4">
                      <p className={`mb-3 flex items-center gap-1.5 text-xs font-semibold ${tone.panelTitle}`}>
                        <BarChart3 size={13} />
                        Disposition breakdown
                      </p>
                      <DispositionBreakdownChart
                        counts={selectedPack.dispositionCounts}
                        worked={selectedPack.workedCount}
                        tone={tone}
                      />
                    </div>
                    <div className="rounded-xl border border-[#e3edf8] bg-white p-4">
                      <p className={`mb-3 text-xs font-semibold ${tone.panelTitle}`}>Leads in this pack</p>
                      <div className="max-h-[42vh] space-y-1.5 overflow-auto">
                        {selectedGroup.items.map((lead) => {
                          const latest = latestByCandidate.get(lead.id);
                          const disposition = latest?.disposition || 'Not contacted';
                          return (
                            <div
                              key={lead.id}
                              className="flex items-center justify-between gap-2 rounded-lg border border-[#edf3fa] bg-[#fafcff] px-2.5 py-2 text-xs"
                            >
                              <div className="min-w-0">
                                <p className="truncate font-semibold text-[#0B1B34]">{lead.full_name || 'Unknown'}</p>
                                <p className="truncate text-[10px] text-[#6b84a8]">
                                  {lead.email || '—'} · {callsByCandidate.get(lead.id) || 0} calls
                                </p>
                              </div>
                              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                                {disposition}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      {packAnalytics?.bestHourLabel && (
                        <PackInsightCard
                          title="Best calling hour"
                          body={`Your highest pickup rate lands around ${packAnalytics.bestHourLabel}. Stack important dials in that window when you can.`}
                          tone={tone}
                          accent="emerald"
                        />
                      )}
                      {packAnalytics?.bestDayLabel && (
                        <PackInsightCard
                          title="Best recent day"
                          body={`${packAnalytics.bestDayLabel} — repeat what worked: shorter intros, confirm email early, book webinar while on the phone.`}
                          tone={tone}
                          accent="sky"
                        />
                      )}
                    </div>

                    <div className="rounded-xl border border-[#e3edf8] bg-white p-4">
                      <p className={`mb-1 flex items-center gap-1.5 text-xs font-semibold ${tone.panelTitle}`}>
                        <Sparkles size={13} />
                        Daily call volume (last 14 days)
                      </p>
                      <p className={`mb-3 text-[11px] ${tone.panelMuted}`}>
                        Dates along the bottom — taller bars mean more activity that day.
                      </p>
                      <DailyCallVolumeChart bars={packAnalytics?.dailyBars ?? []} tone={tone} />
                    </div>

                    <div className="rounded-xl border border-[#e3edf8] bg-white p-4">
                      <p className={`mb-1 text-xs font-semibold ${tone.panelTitle}`}>Pickup by hour (10 AM – 5 PM ET)</p>
                      <p className={`mb-3 text-[11px] ${tone.panelMuted}`}>
                        Find your personal power hours — green highlight marks your strongest pickup window for this pack.
                      </p>
                      <HourlyPickupChart bars={packAnalytics?.hourlyBars ?? []} tone={tone} />
                    </div>

                    <div className="rounded-xl border border-[#e3edf8] bg-white p-4">
                      <p className={`mb-3 text-xs font-semibold ${tone.panelTitle}`}>Disposition outcomes (this pack)</p>
                      <DispositionBreakdownChart
                        counts={selectedPack.dispositionCounts}
                        worked={selectedPack.workedCount}
                        tone={tone}
                      />
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </section>
        </div>
      </div>
    </PipelineAuthShell>
  );
};

export default LeadManagerPage;

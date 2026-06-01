import React from 'react';
import { motion } from 'framer-motion';
import { Moon, RefreshCw, Sun } from 'lucide-react';
import PipelineAuthShell from '../components/PipelineAuthShell';
import { Button } from '../components/UI';
import {
  listPipelineCallLogs,
  listPipelineCallRecords,
  listPipelineIncomingEmailLogsByCandidates,
} from '../services/pipelineService';
import { getCurrentUserProfile } from '../services/accessControl';
import { supabase } from '../services/supabaseClient';

type Preset = 'this_week' | 'last_7_days' | 'all';
type WorkspaceThemeMode = 'dark' | 'light';

const WORKSPACE_THEME_STORAGE_KEY = 'pipeline-recruiter-workspace-theme';

function isoStartOfDay(value: string): string | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isoEndOfDay(value: string): string | null {
  if (!value) return null;
  const date = new Date(`${value}T23:59:59.999`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function weekBuckets(fromIso: string | null, toIso: string | null): Array<{ week: string; calls: number; emails: number; booked: number }> {
  const rows: Array<{ week: string; calls: number; emails: number; booked: number }> = [];
  if (!fromIso || !toIso) return rows;
  let cursor = new Date(fromIso);
  while (cursor <= new Date(toIso)) {
    const start = new Date(cursor);
    const end = new Date(cursor);
    end.setDate(end.getDate() + 6);
    rows.push({
      week: `${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}`,
      calls: 0,
      emails: 0,
      booked: 0,
    });
    cursor.setDate(cursor.getDate() + 7);
  }
  return rows;
}

const PipelinePerformance: React.FC = () => {
  const [fromDate, setFromDate] = React.useState('');
  const [toDate, setToDate] = React.useState('');
  const [preset, setPreset] = React.useState<Preset>('this_week');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [callsMade, setCallsMade] = React.useState(0);
  const [emailsSent, setEmailsSent] = React.useState(0);
  const [emailReplies, setEmailReplies] = React.useState(0);
  const [bookedCount, setBookedCount] = React.useState(0);
  const [weeklyRows, setWeeklyRows] = React.useState<Array<{ week: string; calls: number; emails: number; booked: number }>>([]);
  const [recruiterRows, setRecruiterRows] = React.useState<
    Array<{ recruiterKey: string; label: string; calls: number; emails: number; booked: number }>
  >([]);
  const [isAdminView, setIsAdminView] = React.useState(false);
  const [themeMode, setThemeMode] = React.useState<WorkspaceThemeMode>('dark');

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(WORKSPACE_THEME_STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') {
      setThemeMode(stored);
    }
  }, []);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(WORKSPACE_THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  React.useEffect(() => {
    const now = new Date();
    if (preset === 'all') {
      setFromDate('');
      setToDate('');
      return;
    }
    if (preset === 'last_7_days') {
      const from = new Date();
      from.setDate(now.getDate() - 6);
      setFromDate(from.toISOString().slice(0, 10));
      setToDate(now.toISOString().slice(0, 10));
      return;
    }
    const day = now.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date();
    monday.setDate(now.getDate() + mondayOffset);
    setFromDate(monday.toISOString().slice(0, 10));
    setToDate(now.toISOString().slice(0, 10));
  }, [preset]);

  const loadMetrics = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) throw new Error('Not authenticated.');

      const profile = await getCurrentUserProfile();
      const adminView = profile?.role === 'admin';
      setIsAdminView(adminView);

      const fromIso = preset === 'all' ? null : isoStartOfDay(fromDate);
      const toIso = preset === 'all' ? null : isoEndOfDay(toDate);

      const [callRecords, emailLogs] = await Promise.all([
        listPipelineCallRecords({
          recruiterUserId: adminView ? undefined : userId,
          fromIso,
          toIso,
          limit: 5000,
        }),
        listPipelineCallLogs({
          createdByUserId: adminView ? undefined : userId,
          actions: ['email_sent'],
          fromIso,
          toIso,
          limit: 5000,
        }),
      ]);
      setCallsMade(callRecords.length);
      setEmailsSent(emailLogs.length);
      setBookedCount(callRecords.filter((row) => String(row.disposition || '').toLowerCase() === 'booked').length);

      const candidateIds = [...new Set(callRecords.map((row) => row.candidate_id).filter(Boolean))];
      const inbound = await listPipelineIncomingEmailLogsByCandidates(candidateIds, { fromIso, toIso });
      setEmailReplies(inbound.length);

      if (adminView) {
        const byRecruiter = new Map<string, { label: string; calls: number; emails: number; booked: number }>();
        const recruiterKeyFor = (userIdValue: string | null | undefined, label: string | null | undefined) =>
          userIdValue?.trim() || `label:${(label || 'unknown').trim().toLowerCase()}`;
        const ensureRecruiter = (key: string, label: string) => {
          if (!byRecruiter.has(key)) {
            byRecruiter.set(key, { label, calls: 0, emails: 0, booked: 0 });
          }
          return byRecruiter.get(key)!;
        };
        for (const row of callRecords) {
          const key = recruiterKeyFor(row.recruiter_user_id, row.recruiter_label);
          const label = String(row.recruiter_label || row.recruiter_user_id || 'Unknown recruiter').trim() || 'Unknown recruiter';
          const bucket = ensureRecruiter(key, label);
          bucket.calls += 1;
          if (String(row.disposition || '').toLowerCase() === 'booked') bucket.booked += 1;
        }
        for (const log of emailLogs) {
          const key = recruiterKeyFor(log.created_by_user_id, log.created_by_label);
          const label = String(log.created_by_label || log.created_by_user_id || 'Unknown recruiter').trim() || 'Unknown recruiter';
          ensureRecruiter(key, label).emails += 1;
        }
        setRecruiterRows(
          [...byRecruiter.entries()]
            .map(([recruiterKey, row]) => ({ recruiterKey, ...row }))
            .sort((a, b) => b.calls - a.calls || a.label.localeCompare(b.label)),
        );
      } else {
        setRecruiterRows([]);
      }

      if (preset === 'all' || !fromIso || !toIso) {
        setWeeklyRows([]);
        return;
      }
      const buckets = weekBuckets(fromIso, toIso);
      const weekIndexFor = (iso: string) => {
        const date = new Date(iso).getTime();
        const from = new Date(fromIso).getTime();
        const idx = Math.floor((date - from) / (1000 * 60 * 60 * 24 * 7));
        return Math.max(0, Math.min(buckets.length - 1, idx));
      };
      for (const row of callRecords) {
        buckets[weekIndexFor(row.disposed_at)].calls += 1;
        if (String(row.disposition || '').toLowerCase() === 'booked') buckets[weekIndexFor(row.disposed_at)].booked += 1;
      }
      for (const log of emailLogs) {
        buckets[weekIndexFor(log.created_at)].emails += 1;
      }
      setWeeklyRows(buckets);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, preset]);

  React.useEffect(() => {
    void loadMetrics();
  }, [loadMetrics]);

  const isDark = themeMode === 'dark';
  const tone = React.useMemo(
    () => ({
      page: 'relative overflow-hidden rounded-[30px] border p-4 md:p-5 shadow-[0_35px_100px_-45px_rgba(0,0,0,0.7)]',
      pageTheme: isDark
        ? 'border-white/10 bg-[#070b18] text-slate-100'
        : 'border-[#d4e4f7]/70 bg-[#f4f8ff]/80 text-slate-900',
      orbA: isDark
        ? 'from-violet-500/30 via-indigo-500/10 to-transparent'
        : 'from-violet-300/35 via-indigo-200/20 to-transparent',
      orbB: isDark
        ? 'from-cyan-500/25 via-sky-500/10 to-transparent'
        : 'from-cyan-300/35 via-sky-200/25 to-transparent',
      orbC: isDark
        ? 'from-fuchsia-500/15 via-blue-500/10 to-transparent'
        : 'from-fuchsia-200/35 via-blue-200/20 to-transparent',
      glassPanel: isDark
        ? 'border-white/12 bg-white/[0.045] backdrop-blur-xl shadow-[0_24px_60px_-42px_rgba(16,24,40,0.9)]'
        : 'border-white/70 bg-white/70 backdrop-blur-xl shadow-[0_22px_48px_-38px_rgba(37,99,235,0.45)]',
      panelMuted: isDark ? 'text-slate-300' : 'text-[#365274]',
      panelLabel: isDark ? 'text-slate-400' : 'text-[#4b6d95]',
      panelTitle: isDark ? 'text-white' : 'text-[#0B1B34]',
      input: isDark
        ? 'border-white/15 bg-white/5 text-slate-100 placeholder:text-slate-500'
        : 'border-[#bfd6ee] bg-white/70 text-[#13243f] placeholder:text-[#7392b8]',
      subtle: isDark ? 'bg-white/5 border-white/10' : 'bg-white/80 border-[#cde0f4]',
      actionButton: isDark
        ? 'border-white/20 bg-white/10 text-white hover:bg-white/15'
        : 'border-[#bad4ee] bg-white/75 text-[#0B1B34] hover:bg-white',
      progressTrack: isDark ? 'bg-white/10' : 'bg-[#e8f1fb]',
    }),
    [isDark],
  );

  return (
    <PipelineAuthShell
      title="Recruiter Performance"
      subtitle={isAdminView ? 'Sign in to view team KPI metrics' : 'Sign in to view your KPI metrics'}
      redirectPath="/pipeline/performance"
    >
      <div className={`mx-auto w-full max-w-[1320px] ${tone.page} ${tone.pageTheme}`}>
        <div className={`pointer-events-none absolute -top-24 left-[-10%] h-72 w-72 rounded-full bg-gradient-to-br blur-3xl ${tone.orbA}`} />
        <div className={`pointer-events-none absolute top-40 right-[-8%] h-80 w-80 rounded-full bg-gradient-to-br blur-3xl ${tone.orbB}`} />
        <div className={`pointer-events-none absolute bottom-[-6rem] left-1/3 h-72 w-72 rounded-full bg-gradient-to-tr blur-3xl ${tone.orbC}`} />

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className={`relative rounded-3xl border p-4 ${tone.glassPanel}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className={`text-[10px] uppercase tracking-[0.22em] ${tone.panelLabel}`}>Pipeline recruiter studio</p>
              <h1 className={`text-lg font-semibold ${tone.panelTitle}`}>Recruiter Performance</h1>
              <p className={`text-xs ${tone.panelMuted}`}>
                {isAdminView
                  ? 'All recruiters — calls, outbound email, replies, and booked outcomes by date range.'
                  : 'Calls, outbound email, replies, and booked outcomes by date range.'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setThemeMode((prev) => (prev === 'dark' ? 'light' : 'dark'))}
                className={`inline-flex items-center gap-1 rounded-xl border px-3 py-2 text-xs font-semibold ${tone.actionButton}`}
                aria-label="Toggle dark and light mode"
              >
                {isDark ? <Sun size={13} /> : <Moon size={13} />}
                {isDark ? 'Light mode' : 'Dark mode'}
              </button>
              <Button
                variant="outline"
                className={`!min-h-0 h-9 px-3 text-xs ${isDark ? '!border-white/20 !bg-white/10 !text-slate-100 hover:!bg-white/15' : ''}`}
                onClick={() => void loadMetrics()}
                disabled={loading}
              >
                <RefreshCw size={14} className={loading ? 'mr-1 animate-spin' : 'mr-1'} />
                Refresh
              </Button>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05 }}
          className={`mt-4 rounded-2xl border p-4 ${tone.glassPanel}`}
        >
          <p className={`mb-2 text-[10px] uppercase tracking-[0.18em] ${tone.panelLabel}`}>Date range controls</p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setPreset('this_week')}
                className={`rounded-lg border px-3 py-1.5 text-xs ${
                  preset === 'this_week'
                    ? (isDark ? 'border-cyan-300/45 bg-cyan-300/18 text-cyan-100' : 'border-[#9dc6ef] bg-[#e8f3ff] text-[#0B1B34]')
                    : tone.input
                }`}
              >
                This week
              </button>
              <button
                type="button"
                onClick={() => setPreset('last_7_days')}
                className={`rounded-lg border px-3 py-1.5 text-xs ${
                  preset === 'last_7_days'
                    ? (isDark ? 'border-cyan-300/45 bg-cyan-300/18 text-cyan-100' : 'border-[#9dc6ef] bg-[#e8f3ff] text-[#0B1B34]')
                    : tone.input
                }`}
              >
                Last 7 days
              </button>
              <button
                type="button"
                onClick={() => setPreset('all')}
                className={`rounded-lg border px-3 py-1.5 text-xs ${
                  preset === 'all'
                    ? (isDark ? 'border-cyan-300/45 bg-cyan-300/18 text-cyan-100' : 'border-[#9dc6ef] bg-[#e8f3ff] text-[#0B1B34]')
                    : tone.input
                }`}
              >
                All weeks
              </button>
            </div>
            <label className={`text-xs ${tone.panelMuted}`}>
              From
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                disabled={preset === 'all'}
                className={`ml-2 rounded-lg border px-2 py-1.5 text-xs ${tone.input}`}
              />
            </label>
            <label className={`text-xs ${tone.panelMuted}`}>
              To
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                disabled={preset === 'all'}
                className={`ml-2 rounded-lg border px-2 py-1.5 text-xs ${tone.input}`}
              />
            </label>
          </div>
          {error && (
            <p className={`mt-3 rounded-lg border px-2 py-1 text-xs ${isDark ? 'border-red-300/40 bg-red-500/12 text-red-200' : 'border-red-200 bg-red-50 text-red-700'}`}>
              {error}
            </p>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.1 }}
          className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4"
        >
          <div className={`rounded-2xl border p-4 ${tone.glassPanel} ${tone.subtle}`}>
            <p className={`text-[11px] uppercase tracking-wide ${tone.panelLabel}`}>Calls made</p>
            <p className={`text-2xl font-semibold ${tone.panelTitle}`}>{callsMade}</p>
            <div className={`mt-2 h-1.5 rounded-full ${tone.progressTrack}`} />
          </div>
          <div className={`rounded-2xl border p-4 ${tone.glassPanel} ${tone.subtle}`}>
            <p className={`text-[11px] uppercase tracking-wide ${tone.panelLabel}`}>Emails sent</p>
            <p className={`text-2xl font-semibold ${tone.panelTitle}`}>{emailsSent}</p>
            <div className={`mt-2 h-1.5 rounded-full ${tone.progressTrack}`} />
          </div>
          <div className={`rounded-2xl border p-4 ${tone.glassPanel} ${tone.subtle}`}>
            <p className={`text-[11px] uppercase tracking-wide ${tone.panelLabel}`}>Email replies</p>
            <p className={`text-2xl font-semibold ${tone.panelTitle}`}>{emailReplies}</p>
            <div className={`mt-2 h-1.5 rounded-full ${tone.progressTrack}`} />
          </div>
          <div className={`rounded-2xl border p-4 ${tone.glassPanel} ${tone.subtle}`}>
            <p className={`text-[11px] uppercase tracking-wide ${tone.panelLabel}`}>Booked</p>
            <p className={`text-2xl font-semibold ${tone.panelTitle}`}>{bookedCount}</p>
            <div className={`mt-2 h-1.5 rounded-full ${tone.progressTrack}`} />
          </div>
        </motion.div>

        {isAdminView && recruiterRows.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.11 }}
            className={`mt-4 rounded-2xl border p-4 ${tone.glassPanel}`}
          >
            <p className={`mb-2 text-sm font-semibold ${tone.panelTitle}`}>By recruiter</p>
            <div className="space-y-2">
              {recruiterRows.map((row) => (
                <div
                  key={row.recruiterKey}
                  className={`rounded-xl border px-3 py-2 text-xs flex flex-wrap items-center justify-between gap-2 ${tone.subtle}`}
                >
                  <p className={`font-semibold ${tone.panelTitle}`}>{row.label}</p>
                  <p className={tone.panelMuted}>Calls: {row.calls}</p>
                  <p className={tone.panelMuted}>Emails: {row.emails}</p>
                  <p className={tone.panelMuted}>Booked: {row.booked}</p>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {preset !== 'all' && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.12 }}
            className={`mt-4 rounded-2xl border p-4 ${tone.glassPanel}`}
          >
            <p className={`mb-2 text-sm font-semibold ${tone.panelTitle}`}>
              {isAdminView ? 'Weekly totals (all recruiters)' : 'Weekly totals'}
            </p>
            <div className="space-y-2">
              {weeklyRows.map((row) => (
                <div key={row.week} className={`rounded-xl border px-3 py-2 text-xs flex flex-wrap items-center justify-between gap-2 ${tone.subtle}`}>
                  <p className={`font-semibold ${tone.panelTitle}`}>{row.week}</p>
                  <p className={tone.panelMuted}>Calls: {row.calls}</p>
                  <p className={tone.panelMuted}>Emails: {row.emails}</p>
                  <p className={tone.panelMuted}>Booked: {row.booked}</p>
                </div>
              ))}
              {!weeklyRows.length && <p className={`text-xs ${tone.panelMuted}`}>No weekly data in selected range.</p>}
            </div>
          </motion.div>
        )}
      </div>
    </PipelineAuthShell>
  );
};

export default PipelinePerformance;

import React from 'react';
import { RefreshCw } from 'lucide-react';
import PipelineAuthShell from '../components/PipelineAuthShell';
import { Button } from '../components/UI';
import {
  listPipelineCallLogs,
  listPipelineCallRecords,
  listPipelineIncomingEmailLogsByCandidates,
} from '../services/pipelineService';
import { supabase } from '../services/supabaseClient';

type Preset = 'this_week' | 'last_7_days' | 'all';

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

      const fromIso = preset === 'all' ? null : isoStartOfDay(fromDate);
      const toIso = preset === 'all' ? null : isoEndOfDay(toDate);

      const [callRecords, emailLogs] = await Promise.all([
        listPipelineCallRecords({
          recruiterUserId: userId,
          fromIso,
          toIso,
          limit: 5000,
        }),
        listPipelineCallLogs({
          createdByUserId: userId,
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

  return (
    <PipelineAuthShell
      title="Recruiter Performance"
      subtitle="Sign in to view your KPI metrics"
      redirectPath="/pipeline/performance"
    >
      <div className="mx-auto w-full max-w-[1280px] p-4 space-y-4">
        <div className="rounded-3xl border border-[#d5e5f8] bg-white/80 backdrop-blur-xl p-4 shadow-[0_18px_45px_-28px_rgba(11,27,52,0.35)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold text-[#0B1B34]">Recruiter Performance</h1>
              <p className="text-xs text-[#365274]">Calls, outbound email, replies, and booked outcomes by date range.</p>
            </div>
            <Button variant="outline" className="!min-h-0 h-9 px-3 text-xs" onClick={() => void loadMetrics()} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'mr-1 animate-spin' : 'mr-1'} />
              Refresh
            </Button>
          </div>
        </div>

        <div className="rounded-2xl border border-[#d8e8fa] bg-white p-4 space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex gap-2">
              <button type="button" onClick={() => setPreset('this_week')} className={`rounded-lg border px-3 py-1.5 text-xs ${preset === 'this_week' ? 'border-[#8cbbe8] bg-[#e8f3ff] text-[#0B1B34]' : 'border-slate-300 text-slate-600'}`}>This week</button>
              <button type="button" onClick={() => setPreset('last_7_days')} className={`rounded-lg border px-3 py-1.5 text-xs ${preset === 'last_7_days' ? 'border-[#8cbbe8] bg-[#e8f3ff] text-[#0B1B34]' : 'border-slate-300 text-slate-600'}`}>Last 7 days</button>
              <button type="button" onClick={() => setPreset('all')} className={`rounded-lg border px-3 py-1.5 text-xs ${preset === 'all' ? 'border-[#8cbbe8] bg-[#e8f3ff] text-[#0B1B34]' : 'border-slate-300 text-slate-600'}`}>All weeks</button>
            </div>
            <label className="text-xs text-[#365274]">
              From
              <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} disabled={preset === 'all'} className="ml-2 rounded-lg border border-[#c7ddf5] px-2 py-1.5 text-xs" />
            </label>
            <label className="text-xs text-[#365274]">
              To
              <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} disabled={preset === 'all'} className="ml-2 rounded-lg border border-[#c7ddf5] px-2 py-1.5 text-xs" />
            </label>
          </div>
          {error && <p className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>}
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-[#d8e8fa] bg-white p-4">
            <p className="text-xs text-[#4c6c92]">Calls made</p>
            <p className="text-2xl font-semibold text-[#0B1B34]">{callsMade}</p>
          </div>
          <div className="rounded-2xl border border-[#d8e8fa] bg-white p-4">
            <p className="text-xs text-[#4c6c92]">Emails sent</p>
            <p className="text-2xl font-semibold text-[#0B1B34]">{emailsSent}</p>
          </div>
          <div className="rounded-2xl border border-[#d8e8fa] bg-white p-4">
            <p className="text-xs text-[#4c6c92]">Email replies</p>
            <p className="text-2xl font-semibold text-[#0B1B34]">{emailReplies}</p>
          </div>
          <div className="rounded-2xl border border-[#d8e8fa] bg-white p-4">
            <p className="text-xs text-[#4c6c92]">Booked</p>
            <p className="text-2xl font-semibold text-[#0B1B34]">{bookedCount}</p>
          </div>
        </div>

        {preset !== 'all' && (
          <div className="rounded-2xl border border-[#d8e8fa] bg-white p-4">
            <p className="text-sm font-semibold text-[#0B1B34] mb-2">Weekly totals</p>
            <div className="space-y-2">
              {weeklyRows.map((row) => (
                <div key={row.week} className="rounded-xl border border-slate-200 bg-[#f8fbff] px-3 py-2 text-xs flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-[#0B1B34]">{row.week}</p>
                  <p className="text-[#365274]">Calls: {row.calls}</p>
                  <p className="text-[#365274]">Emails: {row.emails}</p>
                  <p className="text-[#365274]">Booked: {row.booked}</p>
                </div>
              ))}
              {!weeklyRows.length && <p className="text-xs text-slate-500">No weekly data in selected range.</p>}
            </div>
          </div>
        )}
      </div>
    </PipelineAuthShell>
  );
};

export default PipelinePerformance;

import React from 'react';
import { supabase } from '../services/supabaseClient';
import { groupPipelineCandidatesByBatch } from '../services/pipelineLeadGrouping';
import {
  buildLeadPackStats,
  callCountByCandidate,
  latestRecordByCandidate,
} from '../services/recruiterLeadPackAnalytics';
import {
  listPipelineCallRecords,
  listPipelineManualCandidates,
  type PipelineCandidate,
  type PipelineCallRecord,
} from '../services/pipelineService';

export type LeadManagerTone = {
  page: string;
  pageTheme: string;
  glassPanel: string;
  panelTitle: string;
  panelMuted: string;
  panelLabel: string;
  actionButton: string;
  input: string;
  packCard: (active: boolean) => string;
};

export function useLeadManagerTone(themeMode: 'dark' | 'light'): LeadManagerTone {
  const isDark = themeMode === 'dark';
  return React.useMemo(
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
}

export function useLeadManagerData() {
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [candidates, setCandidates] = React.useState<PipelineCandidate[]>([]);
  const [records, setRecords] = React.useState<PipelineCallRecord[]>([]);

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
      const callRows = uid
          ? await listPipelineCallRecords({ recruiterUserId: uid, limit: 8000 })
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

  return {
    loading,
    refreshing,
    error,
    candidates,
    records,
    latestByCandidate,
    callsByCandidate,
    batchGroups,
    packStats,
    loadData,
  };
}

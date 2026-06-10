import React from 'react';
import { motion } from 'framer-motion';
import { FileUp, Moon, RefreshCw, Search, Sun, Trash2 } from 'lucide-react';
import LeadBatchAccordion from '../components/pipeline/LeadBatchAccordion';
import PipelineAuthShell from '../components/PipelineAuthShell';
import { Button } from '../components/UI';
import {
  bulkDeletePipelineCandidates,
  bulkUploadPipelineResumes,
  deletePipelineCandidate,
  getPipelineUserCallSettings,
  listPipelineManualCandidates,
  savePipelineUserCallSettings,
  type PipelineCandidate,
  type PipelineUploadProgress,
} from '../services/pipelineService';
import { canAccessResumeUploads, getCurrentUserProfile } from '../services/accessControl';
import { supabase } from '../services/supabaseClient';
import { formatDateTimeCanadaEastern } from '../services/dateDisplay';
import { Link } from 'react-router-dom';
import {
  defaultExpandedGroupKeys,
  groupPipelineCandidatesByBatch,
} from '../services/pipelineLeadGrouping';

type WorkspaceThemeMode = 'dark' | 'light';
const WORKSPACE_THEME_STORAGE_KEY = 'pipeline-recruiter-workspace-theme';

function candidateDisplayName(candidate: PipelineCandidate): string {
  return candidate.full_name?.trim() || 'Unknown Candidate';
}

function candidateFileLabel(candidate: PipelineCandidate): string {
  const metadata = candidate.metadata && typeof candidate.metadata === 'object' ? candidate.metadata : {};
  return String((metadata as Record<string, unknown>).original_file_name || '').trim();
}

function stageLabel(stage: PipelineUploadProgress['stage']): string {
  switch (stage) {
    case 'starting':
      return 'Preparing';
    case 'extracting':
      return 'Extracting';
    case 'saving_candidate':
      return 'Saving candidate';
    case 'uploading_file':
      return 'Uploading';
    case 'creating_resume':
      return 'Creating resume';
    case 'queueing_conversion':
      return 'Queueing conversion';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    default:
      return 'Processing';
  }
}

const PipelineUploadsWorkspace: React.FC = () => {
  const [loading, setLoading] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [dailyTarget, setDailyTarget] = React.useState<number | ''>('');
  const [savingTarget, setSavingTarget] = React.useState(false);
  const [progressByIndex, setProgressByIndex] = React.useState<Record<number, PipelineUploadProgress>>({});
  const [candidates, setCandidates] = React.useState<PipelineCandidate[]>([]);
  const [search, setSearch] = React.useState('');
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(() => new Set());
  const [deleting, setDeleting] = React.useState(false);
  const [themeMode, setThemeMode] = React.useState<WorkspaceThemeMode>('dark');
  const [allowed, setAllowed] = React.useState<boolean | null>(null);
  const [activeBatchKey, setActiveBatchKey] = React.useState<string | 'all'>('all');
  const [expandedBatchKeys, setExpandedBatchKeys] = React.useState<Set<string>>(() => new Set());

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

  const loadData = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [settings, rows] = await Promise.all([
        getPipelineUserCallSettings().catch(() => null),
        listPipelineManualCandidates(),
      ]);
      setDailyTarget(settings?.daily_upload_target ?? '');
      setCandidates(rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!allowed) return;
    void loadData();
  }, [allowed, loadData]);

  React.useEffect(() => {
    void getCurrentUserProfile().then((profile) => {
      setAllowed(canAccessResumeUploads(profile?.role ?? null, profile?.email));
    });
  }, []);

  const saveTarget = async () => {
    setSavingTarget(true);
    setMessage(null);
    try {
      await savePipelineUserCallSettings({
        dailyUploadTarget: dailyTarget === '' ? null : Number(dailyTarget),
      });
      setMessage('Daily target saved. Auto call workspace queue cap will follow this target.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingTarget(false);
    }
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setError(null);
    setMessage(null);
    setProgressByIndex({});
    try {
      const { data } = await supabase.auth.getUser();
      const actorLabel = String(data.user?.user_metadata?.full_name || data.user?.user_metadata?.name || data.user?.email || '').trim() || undefined;
      const result = await bulkUploadPipelineResumes(Array.from(files), actorLabel, (progress) => {
        setProgressByIndex((prev) => ({ ...prev, [progress.index]: progress }));
      });
      if (result.failed.length) {
        setMessage(`Uploaded ${result.created.length}. Failed ${result.failed.length}.`);
      } else {
        setMessage(`Uploaded ${result.created.length} candidates.`);
      }
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  const filteredCandidates = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((candidate) => {
      const fileLabel = candidateFileLabel(candidate).toLowerCase();
      return (
        candidateDisplayName(candidate).toLowerCase().includes(q) ||
        String(candidate.phone || '').toLowerCase().includes(q) ||
        String(candidate.email || '').toLowerCase().includes(q) ||
        fileLabel.includes(q)
      );
    });
  }, [candidates, search]);

  const uploadBatchGroups = React.useMemo(
    () =>
      groupPipelineCandidatesByBatch(filteredCandidates, {
        isNew: (candidate) =>
          String(candidate.journey_stage || '').toLowerCase() === 'new' &&
          String(candidate.status || '').toLowerCase() === 'open',
      }),
    [filteredCandidates],
  );

  const visibleUploadBatchGroups = React.useMemo(() => {
    if (activeBatchKey === 'all') return uploadBatchGroups;
    return uploadBatchGroups.filter((group) => group.key === activeBatchKey);
  }, [uploadBatchGroups, activeBatchKey]);

  React.useEffect(() => {
    if (!uploadBatchGroups.length) return;
    setExpandedBatchKeys((prev) => (prev.size ? prev : defaultExpandedGroupKeys(uploadBatchGroups)));
  }, [uploadBatchGroups]);

  const toggleUploadBatch = (key: string) => {
    setExpandedBatchKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSelectedId = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelectedIds(new Set(filteredCandidates.map((row) => row.id)));
  };

  const clearSelection = () => setSelectedIds(new Set());

  const deleteOne = async (candidate: PipelineCandidate) => {
    const label = candidateDisplayName(candidate);
    const fileLabel = candidateFileLabel(candidate);
    const detail = fileLabel ? `${label} (${fileLabel})` : label;
    const ok = window.confirm(`Delete upload for ${detail}? This removes the resume file and related pipeline data.`);
    if (!ok) return;
    setDeleting(true);
    setError(null);
    setMessage(null);
    try {
      await deletePipelineCandidate(candidate.id);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(candidate.id);
        return next;
      });
      setMessage(`Deleted ${detail}.`);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  };

  const bulkDeleteSelected = async () => {
    if (!selectedIds.size) return;
    const ok = window.confirm(`Delete ${selectedIds.size} selected upload(s) and related data? This cannot be undone.`);
    if (!ok) return;
    const count = selectedIds.size;
    setDeleting(true);
    setError(null);
    setMessage(null);
    try {
      await bulkDeletePipelineCandidates(Array.from(selectedIds));
      setSelectedIds(new Set());
      setMessage(`Deleted ${count} upload(s).`);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  };

  const todayIso = new Date().toISOString().slice(0, 10);
  const uploadedToday = candidates.filter((row) => row.created_at.slice(0, 10) === todayIso).length;
  const busy = loading || uploading || deleting;
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
      progressTrack: isDark ? 'bg-slate-700/60' : 'bg-slate-200',
      progressFill: isDark ? 'bg-cyan-400' : 'bg-[#005EB8]',
      listCard: isDark ? 'border-white/10 bg-white/[0.04]' : 'border-slate-200 bg-[#f8fbff]',
    }),
    [isDark],
  );

  if (allowed === false) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <h1 className="text-xl font-semibold text-slate-900">Resume uploads</h1>
        <p className="mt-2 text-sm text-slate-600">Resume uploads are managed by HR. Use Call workspace for your assigned leads.</p>
        <Link to="/pipeline/call" className="mt-4 inline-block text-sm font-semibold text-[#005EB8] hover:underline">
          Open call workspace
        </Link>
      </div>
    );
  }

  return (
    <PipelineAuthShell
      title="Resume Upload Workspace"
      subtitle="Sign in to manage HR resume uploads"
      redirectPath="/pipeline/uploads"
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
              <h1 className={`text-lg font-semibold ${tone.panelTitle}`}>Resume Upload Workspace</h1>
              <p className={`text-xs ${tone.panelMuted}`}>
                HR bulk resume upload, or use Lead distribution for weekly CSV imports.
              </p>
              <Link to="/hr/lead-distribution" className="mt-1 inline-block text-xs font-semibold text-[#005EB8] hover:underline">
                Open lead distribution →
              </Link>
            </div>
            <button
              type="button"
              onClick={() => setThemeMode((prev) => (prev === 'dark' ? 'light' : 'dark'))}
              className={`inline-flex items-center gap-1 rounded-xl border px-3 py-2 text-xs font-semibold ${tone.actionButton}`}
              aria-label="Toggle dark and light mode"
            >
              {isDark ? <Sun size={13} /> : <Moon size={13} />}
              {isDark ? 'Light mode' : 'Dark mode'}
            </button>
          </div>
        </motion.div>

        {error && <div className={`mt-4 rounded-xl border px-3 py-2 text-sm ${isDark ? 'border-red-300/40 bg-red-500/12 text-red-200' : 'border-red-200 bg-red-50 text-red-700'}`}>{error}</div>}
        {message && <div className={`mt-4 rounded-xl border px-3 py-2 text-xs ${isDark ? 'border-cyan-300/30 bg-cyan-500/10 text-cyan-100' : 'border-[#cfe3f9] bg-[#f3f8ff] text-[#365274]'}`}>{message}</div>}

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05 }}
          className="mt-4 grid gap-4 xl:grid-cols-[380px_1fr]"
        >
          <section className={`rounded-2xl border p-4 space-y-3 ${tone.glassPanel}`}>
            <label className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs cursor-pointer ${tone.actionButton}`}>
              <FileUp size={14} />
              {uploading ? 'Uploading...' : 'Bulk upload resumes'}
              <input
                type="file"
                className="hidden"
                multiple
                accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.rtf,.txt"
                onChange={(e) => void uploadFiles(e.target.files)}
                disabled={uploading}
              />
            </label>

            <div className={`rounded-xl border p-3 space-y-2 ${tone.subtle}`}>
              <p className={`text-xs font-semibold ${tone.panelTitle}`}>Daily upload target</p>
              <div className="flex items-center gap-2">
                {[100, 150].map((preset) => (
                  <button key={preset} type="button" onClick={() => setDailyTarget(preset)} className={`rounded-lg border px-2 py-1 text-xs ${tone.input}`}>{preset}</button>
                ))}
                <input
                  type="number"
                  min={0}
                  placeholder="Custom"
                  value={dailyTarget}
                  onChange={(e) => setDailyTarget(e.target.value ? Number(e.target.value) : '')}
                  className={`w-full rounded-lg border px-2 py-1.5 text-xs ${tone.input}`}
                />
              </div>
              <Button
                variant="outline"
                className={`!min-h-0 h-8 text-xs ${isDark ? '!border-white/20 !bg-white/10 !text-slate-100 hover:!bg-white/15' : ''}`}
                onClick={() => void saveTarget()}
                disabled={savingTarget}
              >
                {savingTarget ? 'Saving...' : 'Save target'}
              </Button>
              <p className={`text-[11px] ${tone.panelLabel}`}>Uploaded today: {uploadedToday} {dailyTarget !== '' ? ` / target ${dailyTarget}` : ''}</p>
            </div>

            {!!Object.keys(progressByIndex).length && (
              <div className="space-y-1">
                {Object.values(progressByIndex).sort((a, b) => a.index - b.index).map((progress) => (
                  <div key={`${progress.index}-${progress.fileName}`} className={`rounded-lg border px-2 py-2 ${tone.listCard}`}>
                    <div className="flex items-center justify-between gap-2">
                      <p className={`text-[11px] truncate ${tone.panelMuted}`}>{progress.fileName}</p>
                      <span className={`text-[10px] ${tone.panelLabel}`}>{stageLabel(progress.stage)}</span>
                    </div>
                    <div className={`mt-1 h-1.5 rounded-full overflow-hidden ${tone.progressTrack}`}>
                      <div className={`h-full ${tone.progressFill}`} style={{ width: `${Math.max(0, Math.min(100, progress.percent))}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className={`rounded-2xl border p-4 ${tone.glassPanel}`}>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <p className={`text-sm font-semibold ${tone.panelTitle}`}>Uploaded resumes</p>
              <Button
                variant="outline"
                className={`!min-h-0 h-8 px-3 text-xs ${isDark ? '!border-white/20 !bg-white/10 !text-slate-100 hover:!bg-white/15' : ''}`}
                onClick={() => void loadData()}
                disabled={busy}
              >
                <RefreshCw size={13} className={loading ? 'mr-1 animate-spin' : 'mr-1'} />
                Refresh
              </Button>
            </div>

            <div className="mb-3 space-y-2">
              <div className="relative">
                <Search size={14} className={`absolute left-2.5 top-1/2 -translate-y-1/2 ${tone.panelLabel}`} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name, file, phone, email"
                  className={`w-full rounded-lg border pl-8 pr-3 py-2 text-xs ${tone.input}`}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <p className={`text-[11px] ${tone.panelMuted}`}>
                  Showing {filteredCandidates.length} of {candidates.length}
                </p>
                <button
                  type="button"
                  onClick={selectAllVisible}
                  disabled={!filteredCandidates.length || busy}
                  className={`rounded-lg border px-2 py-1 text-[11px] font-medium disabled:opacity-50 ${tone.actionButton}`}
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={clearSelection}
                  disabled={!selectedIds.size || busy}
                  className={`rounded-lg border px-2 py-1 text-[11px] font-medium disabled:opacity-50 ${tone.actionButton}`}
                >
                  Clear
                </button>
                <Button
                  variant="outline"
                  className={`!min-h-0 h-7 px-2 text-[11px] ${isDark ? '!border-red-300/40 !bg-red-500/10 !text-red-100 hover:!bg-red-500/20' : '!border-red-200 !text-red-700 hover:!bg-red-50'}`}
                  onClick={() => void bulkDeleteSelected()}
                  disabled={!selectedIds.size || busy}
                >
                  <Trash2 size={12} className="mr-1" />
                  Delete {selectedIds.size || 'selected'}
                </Button>
              </div>
            </div>

            {uploadBatchGroups.length > 1 && (
              <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
                <button
                  type="button"
                  onClick={() => setActiveBatchKey('all')}
                  className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
                    activeBatchKey === 'all'
                      ? isDark
                        ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-100'
                        : 'border-[#7eb3e7] bg-[#e8f3ff] text-[#285082]'
                      : tone.actionButton
                  }`}
                >
                  All batches ({filteredCandidates.length})
                </button>
                {uploadBatchGroups.map((group) => (
                  <button
                    key={group.key}
                    type="button"
                    onClick={() => setActiveBatchKey(group.key)}
                    className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
                      activeBatchKey === group.key
                        ? isDark
                          ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-100'
                          : 'border-[#7eb3e7] bg-[#e8f3ff] text-[#285082]'
                        : tone.actionButton
                    }`}
                  >
                    {group.batchNumber ? `Batch ${group.batchNumber}` : group.title}
                    {group.newCount > 0 ? ` · ${group.newCount} new` : ''}
                  </button>
                ))}
              </div>
            )}

            <div className="max-h-[72vh] overflow-auto">
              <LeadBatchAccordion
                groups={visibleUploadBatchGroups}
                expandedKeys={expandedBatchKeys}
                onToggle={toggleUploadBatch}
                emptyMessage={search ? 'No leads match your search.' : 'No assigned leads yet.'}
                tone={{
                  header: tone.panelTitle,
                  headerMuted: tone.panelMuted,
                  panel: tone.listCard,
                  badgeNew: isDark ? 'bg-cyan-500/15 text-cyan-100' : 'bg-[#edf5ff] text-[#285082]',
                  badgeMuted: isDark ? 'bg-white/10 text-slate-300' : 'bg-slate-100 text-slate-600',
                }}
                renderItem={(candidate) => {
                const fileLabel = candidateFileLabel(candidate);
                const checked = selectedIds.has(candidate.id);
                return (
                  <div
                    key={candidate.id}
                    className={`rounded-lg border px-3 py-2 ${tone.listCard} ${checked ? (isDark ? 'ring-1 ring-cyan-400/50' : 'ring-1 ring-[#8bc3ff]') : ''}`}
                  >
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSelectedId(candidate.id)}
                        disabled={busy}
                        className="mt-1 rounded border-slate-300"
                        aria-label={`Select ${candidateDisplayName(candidate)}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className={`text-xs font-semibold truncate ${tone.panelTitle}`}>{candidateDisplayName(candidate)}</p>
                        {fileLabel && (
                          <p className={`text-[11px] truncate ${tone.panelMuted}`} title={fileLabel}>
                            {fileLabel}
                          </p>
                        )}
                        <p className={`text-[10px] ${tone.panelLabel}`}>
                          {candidate.phone || candidate.email || 'No contact info'} ·{' '}
                          {formatDateTimeCanadaEastern(candidate.assigned_at || candidate.created_at)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void deleteOne(candidate)}
                        disabled={busy}
                        className={`shrink-0 inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium disabled:opacity-50 ${
                          isDark
                            ? 'border-red-300/40 bg-red-500/10 text-red-100 hover:bg-red-500/20'
                            : 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                        }`}
                        title="Delete this upload"
                      >
                        <Trash2 size={12} />
                        Delete
                      </button>
                    </div>
                  </div>
                );
              }}
              />
            </div>
          </section>
        </motion.div>
      </div>
    </PipelineAuthShell>
  );
};

export default PipelineUploadsWorkspace;

import React from 'react';
import { Link } from 'react-router-dom';
import { FileSpreadsheet, History, RefreshCw, Trash2, Upload, UserPlus, Users } from 'lucide-react';
import Layout from '../components/Layout';
import HomeLoadingScreen from '../components/dashboard/HomeLoadingScreen';
import { Button } from '../components/UI';
import {
  canAccessHrLeadDistribution,
  getCurrentUserProfile,
  listAllUserProfiles,
  type UserProfile,
} from '../services/accessControl';
import { parseHrLeadCsv } from '../services/pipelineCsvParse';
import {
  assignHrLeads,
  deleteHrBatchPool,
  deleteHrPoolLeads,
  fetchHrLeadBatches,
  fetchHrLeadPool,
  fetchHrLeadSummary,
  fetchHrRecruiterLeads,
  fetchHrRecruiterOverview,
  importHrLeadCsvWithProgress,
  type HrPoolLead,
  type HrRecruiterOverview,
  type PipelineLeadBatch,
} from '../services/pipelineHrLeadsService';
import { formatDateTimeCanadaEastern } from '../services/dateDisplay';
import HrRecruiterTrackingPanel from '../components/pipeline/HrRecruiterTrackingPanel';
import LeadBatchAccordion from '../components/pipeline/LeadBatchAccordion';
import { uploadResumeForPipelineCandidate } from '../services/pipelineService';
import {
  defaultExpandedGroupKeys,
  groupHrLeadsByBatchId,
  type LeadBatchGroup,
} from '../services/pipelineLeadGrouping';

const CHUNK_SIZE = 40;

const HrLeadDistributionPage: React.FC = () => {
  const [allowed, setAllowed] = React.useState<boolean | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [summary, setSummary] = React.useState<{ pool_count: number; assigned_count: number; recent_batches: PipelineLeadBatch[] } | null>(null);
  const [pool, setPool] = React.useState<HrPoolLead[]>([]);
  const [recruiterOverview, setRecruiterOverview] = React.useState<HrRecruiterOverview[]>([]);
  const [recruiters, setRecruiters] = React.useState<UserProfile[]>([]);
  const [selectedBatchId, setSelectedBatchId] = React.useState('');
  const [selectedPoolIds, setSelectedPoolIds] = React.useState<Set<string>>(() => new Set());
  const [assignToUserId, setAssignToUserId] = React.useState('');
  const [assignCount, setAssignCount] = React.useState<number | ''>(10);
  const [importLabel, setImportLabel] = React.useState('');
  const [importSourceFilename, setImportSourceFilename] = React.useState('');
  const [uploadHistory, setUploadHistory] = React.useState<PipelineLeadBatch[]>([]);
  const [deleting, setDeleting] = React.useState(false);
  const [parsedPreview, setParsedPreview] = React.useState<ReturnType<typeof parseHrLeadCsv> | null>(null);
  const [importing, setImporting] = React.useState(false);
  const [importProgress, setImportProgress] = React.useState<{ pct: number; label: string } | null>(null);
  const [assigning, setAssigning] = React.useState(false);
  const [resumeUploading, setResumeUploading] = React.useState(false);
  const [resumeProgress, setResumeProgress] = React.useState<{ pct: number; label: string } | null>(null);
  const [expandedPoolBatchKeys, setExpandedPoolBatchKeys] = React.useState<Set<string>>(() => new Set());

  React.useEffect(() => {
    void getCurrentUserProfile().then((profile) => {
      setAllowed(canAccessHrLeadDistribution(profile?.role ?? null, profile?.email));
    });
  }, []);

  const loadData = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryRes, poolRes, overviewRes, historyRes, profiles] = await Promise.all([
        fetchHrLeadSummary(),
        fetchHrLeadPool(selectedBatchId || undefined),
        fetchHrRecruiterOverview(selectedBatchId || undefined),
        fetchHrLeadBatches(30),
        listAllUserProfiles(),
      ]);
      if (!summaryRes.ok) throw new Error(summaryRes.error);
      setSummary({
        pool_count: summaryRes.data.pool_count,
        assigned_count: summaryRes.data.assigned_count,
        recent_batches: summaryRes.data.recent_batches || [],
      });
      if (!poolRes.ok) throw new Error(poolRes.error);
      if (!overviewRes.ok) throw new Error(overviewRes.error);
      if (!historyRes.ok) throw new Error(historyRes.error);
      setPool(poolRes.pool);
      setRecruiterOverview(overviewRes.recruiters);
      setUploadHistory(historyRes.batches);
      setRecruiters(
        profiles.filter((p) => p.role === 'recruiter' || p.role === 'leadership' || p.role === 'admin'),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedBatchId]);

  React.useEffect(() => {
    if (!allowed) return;
    void loadData();
  }, [allowed, loadData]);

  const poolBatchGroups = React.useMemo((): LeadBatchGroup<HrPoolLead>[] => {
    const rows = selectedBatchId ? pool.filter((lead) => lead.lead_batch_id === selectedBatchId) : pool;
    const batchCatalog = uploadHistory.length ? uploadHistory : summary?.recent_batches || [];
    return groupHrLeadsByBatchId(rows, batchCatalog).map((group) => ({
      key: group.key,
      kind: 'hr_batch' as const,
      batchNumber: null,
      title: group.title,
      subtitle: `${group.items.length} leads`,
      sortTimestamp: group.sortTimestamp,
      items: group.items,
      newCount: group.items.length,
      inProgressCount: 0,
      doneCount: 0,
    }));
  }, [pool, selectedBatchId, summary?.recent_batches, uploadHistory]);

  React.useEffect(() => {
    if (!poolBatchGroups.length) return;
    setExpandedPoolBatchKeys((prev) => (prev.size ? prev : defaultExpandedGroupKeys(poolBatchGroups)));
  }, [poolBatchGroups]);

  const loadRecruiterLeads = React.useCallback(
    async (userId: string) => {
      const result = await fetchHrRecruiterLeads(userId, selectedBatchId || undefined);
      if (!result.ok) throw new Error(result.error);
      return result.leads;
    },
    [selectedBatchId],
  );

  const onCsvFile = async (file: File) => {
    setError(null);
    setMessage(null);
    const text = await file.text();
    const parsed = parseHrLeadCsv(text);
    setParsedPreview(parsed);
    setImportSourceFilename(file.name);
    setImportLabel(file.name.replace(/\.[^.]+$/, ''));
    if (parsed.errors.length) {
      setError(parsed.errors.slice(0, 5).join(' '));
    }
  };

  const runImport = async () => {
    if (!parsedPreview?.rows.length) {
      setError('Upload a CSV with at least one valid row first.');
      return;
    }
    setImporting(true);
    setImportProgress({ pct: 4, label: 'Starting import…' });
    setError(null);
    setMessage(null);
    try {
      const result = await importHrLeadCsvWithProgress({
        label: importLabel || 'Weekly HR import',
        sourceFilename: importSourceFilename || importLabel,
        rows: parsedPreview.rows,
        chunkSize: CHUNK_SIZE,
        onProgress: (progress) => setImportProgress({ pct: progress.pct, label: progress.label }),
      });
      setMessage(
        `Imported ${result.imported} leads. Skipped ${result.skipped} duplicates. Failed ${result.failed}.`,
      );
      if (result.batchId) setSelectedBatchId(result.batchId);
      setParsedPreview(null);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  };

  const runAssign = async () => {
    const recruiter = recruiters.find((row) => row.user_id === assignToUserId);
    if (!recruiter) {
      setError('Select a recruiter to assign leads to.');
      return;
    }
    setAssigning(true);
    setError(null);
    setMessage(null);
    try {
      const selectedIds = [...selectedPoolIds];
      const result = await assignHrLeads({
        assignToUserId: recruiter.user_id,
        assignToLabel: recruiter.full_name || recruiter.email || recruiter.user_id,
        candidateIds: selectedIds.length ? selectedIds : undefined,
        count: selectedIds.length ? undefined : Number(assignCount || 0) || undefined,
        batchId: selectedBatchId || undefined,
      });
      if (!result.ok) throw new Error(result.error);
      const errCount = (result.data.errors || []).length;
      setMessage(
        `Assigned ${result.data.assigned_count} lead(s) to ${recruiter.full_name || recruiter.email}.${errCount ? ` ${errCount} could not be assigned.` : ''}`,
      );
      setSelectedPoolIds(new Set());
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAssigning(false);
    }
  };

  const deletePoolLeads = async (candidateIds: string[], confirmText: string) => {
    if (!candidateIds.length) return;
    if (!window.confirm(confirmText)) return;
    setDeleting(true);
    setError(null);
    setMessage(null);
    try {
      const result = await deleteHrPoolLeads(candidateIds);
      if (!result.ok) throw new Error(result.error);
      const errCount = (result.data.errors || []).length;
      setMessage(
        `Deleted ${result.data.deleted_count} lead(s).${errCount ? ` ${errCount} could not be deleted.` : ''}`,
      );
      setSelectedPoolIds(new Set());
      if (result.data.removed_batch_ids?.includes(selectedBatchId)) {
        setSelectedBatchId('');
      }
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  };

  const deleteBatchPool = async (batch: PipelineLeadBatch) => {
    const poolCount = batch.pool_count ?? 0;
    if (!poolCount) {
      setError('No unassigned leads in this batch.');
      return;
    }
    const label = batch.source_filename || batch.label;
    if (!window.confirm(`Delete ${poolCount} unassigned lead(s) from ${label}?`)) return;
    setDeleting(true);
    setError(null);
    setMessage(null);
    try {
      const result = await deleteHrBatchPool(batch.id);
      if (!result.ok) throw new Error(result.error);
      const errCount = (result.data.errors || []).length;
      setMessage(
        `Deleted ${result.data.deleted_count} lead(s) from batch.${result.data.batch_removed ? ' Batch removed from history.' : ''}${errCount ? ` ${errCount} could not be deleted.` : ''}`,
      );
      if (selectedBatchId === batch.id) setSelectedBatchId('');
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  };

  const attachResumes = async (files: FileList | null) => {
    if (!files?.length) return;
    setResumeUploading(true);
    setError(null);
    setMessage(null);
    const fileArr = [...files];
    let attached = 0;
    let missed = 0;
    try {
      for (let index = 0; index < fileArr.length; index += 1) {
        const file = fileArr[index];
        setResumeProgress({
          pct: Math.round((index / fileArr.length) * 100),
          label: `Attaching ${file.name}…`,
        });
        const emailGuess = String(file.name.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0] || '').toLowerCase();
        const match = pool.find((lead) => {
          if (emailGuess && lead.email?.toLowerCase() === emailGuess) return true;
          const base = file.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
          const name = String(lead.full_name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          return base.length > 4 && name.includes(base.slice(0, Math.min(base.length, 8)));
        });
        if (!match) {
          missed += 1;
          continue;
        }
        await uploadResumeForPipelineCandidate(match.id, file);
        attached += 1;
      }
      setMessage(`Attached ${attached} resume(s) to pool leads.${missed ? ` ${missed} file(s) had no email/name match in the pool.` : ''}`);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setResumeUploading(false);
      setResumeProgress(null);
    }
  };

  if (allowed === false) {
    return (
      <Layout isAdmin>
        <div className="mx-auto max-w-2xl p-8">
          <h1 className="text-xl font-semibold text-slate-900">Lead distribution</h1>
          <p className="mt-2 text-sm text-slate-600">You do not have access to HR lead distribution.</p>
          <Link to="/home" className="mt-4 inline-block text-sm font-semibold text-[#005EB8] hover:underline">Back to home</Link>
        </div>
      </Layout>
    );
  }

  return (
    <Layout isAdmin>
      <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[#0B1B34]">Lead distribution</h1>
          </div>
          <Button variant="outline" className="!min-h-0 h-9 gap-1.5 text-xs" onClick={() => void loadData()} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </Button>
        </div>

        {summary && (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-[#cde0f4] bg-white p-4">
              <p className="text-xs text-[#4b6d95]">Unassigned pool</p>
              <p className="text-2xl font-bold text-[#0B1B34]">{summary.pool_count}</p>
            </div>
            <div className="rounded-2xl border border-[#cde0f4] bg-white p-4">
              <p className="text-xs text-[#4b6d95]">Assigned leads</p>
              <p className="text-2xl font-bold text-[#0B1B34]">{summary.assigned_count}</p>
            </div>
            <div className="rounded-2xl border border-[#cde0f4] bg-white p-4">
              <p className="text-xs text-[#4b6d95]">Recent batches</p>
              <p className="text-2xl font-bold text-[#0B1B34]">{summary.recent_batches.length}</p>
            </div>
          </div>
        )}

        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {message && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div>}

        <section className="relative rounded-2xl border border-[#cde0f4] bg-white p-5">
          {(importing && importProgress) && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-white/95 p-4">
              <div className="w-full max-w-md">
                <HomeLoadingScreen progress={importProgress} title="Importing leads" compact />
              </div>
            </div>
          )}
          <div className="flex items-center gap-2 text-sm font-semibold text-[#0B1B34]">
            <FileSpreadsheet size={16} />
            Import CSV
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex-1 text-xs font-medium text-[#365274]">
              CSV file
              <input
                type="file"
                accept=".csv,text/csv"
                className="mt-1 block w-full text-sm"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void onCsvFile(file);
                }}
              />
            </label>
            <label className="flex-1 text-xs font-medium text-[#365274]">
              Batch label
              <input
                value={importLabel}
                onChange={(e) => setImportLabel(e.target.value)}
                className="mt-1 w-full rounded-xl border border-[#c8ddf4] px-3 py-2 text-sm"
                placeholder="Batch name"
              />
            </label>
            <Button className="!min-h-0 h-10 shrink-0" onClick={() => void runImport()} disabled={importing || !parsedPreview?.rows.length}>
              <Upload size={14} className="mr-1.5" />
              Import leads
            </Button>
          </div>
          {parsedPreview && (
            <div className="mt-4 overflow-auto rounded-xl border border-[#e3edf8]">
              <table className="min-w-full text-xs">
                <thead className="bg-[#f4f8ff] text-left text-[#4b6d95]">
                  <tr>
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Lead age</th>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">Phone</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedPreview.rows.slice(0, 8).map((row) => (
                    <tr key={row.rowNumber} className="border-t border-[#edf3fa]">
                      <td className="px-3 py-2">{row.rowNumber}</td>
                      <td className="px-3 py-2">{row.leadAge || '—'}</td>
                      <td className="px-3 py-2">{row.fullName}</td>
                      <td className="px-3 py-2">{row.email || '—'}</td>
                      <td className="px-3 py-2">{row.phone || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-[#cde0f4] bg-white p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#0B1B34]">
            <History size={16} />
            Upload history
          </div>
          <div className="overflow-auto rounded-xl border border-[#e3edf8]">
            <table className="min-w-full text-xs">
              <thead className="bg-[#f4f8ff] text-left text-[#4b6d95]">
                <tr>
                  <th className="px-3 py-2">Uploaded</th>
                  <th className="px-3 py-2">File</th>
                  <th className="px-3 py-2">Batch</th>
                  <th className="px-3 py-2">Imported</th>
                  <th className="px-3 py-2">Assigned</th>
                  <th className="px-3 py-2">Pool</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {uploadHistory.map((batch) => (
                  <tr key={batch.id} className="border-t border-[#edf3fa]">
                    <td className="px-3 py-2 whitespace-nowrap">{formatDateTimeCanadaEastern(batch.created_at)}</td>
                    <td className="px-3 py-2 max-w-[220px] truncate" title={batch.source_filename || undefined}>
                      {batch.source_filename || '—'}
                    </td>
                    <td className="px-3 py-2 max-w-[180px] truncate">{batch.label}</td>
                    <td className="px-3 py-2">{batch.imported_count}</td>
                    <td className="px-3 py-2">{batch.assigned_count}</td>
                    <td className="px-3 py-2">{batch.pool_count ?? 0}</td>
                    <td className="px-3 py-2 text-right">
                      {(batch.pool_count ?? 0) > 0 ? (
                        <button
                          type="button"
                          onClick={() => void deleteBatchPool(batch)}
                          disabled={deleting}
                          className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          <Trash2 size={12} />
                          Delete pool
                        </button>
                      ) : (
                        <span className="text-[#6b84a8]">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!uploadHistory.length && !loading && (
              <p className="px-3 py-6 text-center text-xs text-[#6b84a8]">No uploads yet.</p>
            )}
          </div>
        </section>

        <section className="relative rounded-2xl border border-[#cde0f4] bg-white p-5">
          {(resumeUploading && resumeProgress) && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-white/95 p-4">
              <div className="w-full max-w-md">
                <HomeLoadingScreen progress={resumeProgress} title="Attaching resumes" compact />
              </div>
            </div>
          )}
          <div className="flex items-center gap-2 text-sm font-semibold text-[#0B1B34]">
            <Upload size={16} />
            Attach resumes
          </div>
          <input
            type="file"
            multiple
            accept=".pdf,.doc,.docx,image/*"
            className="mt-3 block w-full text-sm"
            onChange={(e) => void attachResumes(e.target.files)}
            disabled={!pool.length || resumeUploading}
          />
        </section>

        <section className="rounded-2xl border border-[#cde0f4] bg-white p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#0B1B34]">
            <UserPlus size={16} />
            Assign to recruiter
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <label className="text-xs font-medium text-[#365274] md:col-span-2">
              Recruiter
              <select
                value={assignToUserId}
                onChange={(e) => setAssignToUserId(e.target.value)}
                className="mt-1 w-full rounded-xl border border-[#c8ddf4] px-3 py-2 text-sm"
              >
                <option value="">Select recruiter…</option>
                {recruiters.map((row) => (
                  <option key={row.user_id} value={row.user_id}>
                    {row.full_name || row.email || row.user_id}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-[#365274]">
              Count
              <input
                type="number"
                min={1}
                value={assignCount}
                onChange={(e) => setAssignCount(e.target.value === '' ? '' : Number(e.target.value))}
                className="mt-1 w-full rounded-xl border border-[#c8ddf4] px-3 py-2 text-sm"
              />
            </label>
            <div className="flex items-end">
              <Button className="!min-h-0 h-10 w-full" onClick={() => void runAssign()} disabled={assigning || !assignToUserId}>
                {assigning ? 'Assigning…' : 'Assign leads'}
              </Button>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="rounded-2xl border border-[#cde0f4] bg-white p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-[#0B1B34]">Unassigned pool ({pool.length})</p>
              <div className="flex flex-wrap items-center gap-2">
                {selectedPoolIds.size > 0 && (
                  <button
                    type="button"
                    onClick={() => void deletePoolLeads([...selectedPoolIds], `Delete ${selectedPoolIds.size} selected lead(s)?`)}
                    disabled={deleting}
                    className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    <Trash2 size={12} />
                    Delete selected ({selectedPoolIds.size})
                  </button>
                )}
              <select
                value={selectedBatchId}
                onChange={(e) => setSelectedBatchId(e.target.value)}
                className="rounded-lg border border-[#c8ddf4] px-2 py-1 text-xs"
              >
                <option value="">All batches</option>
                {(uploadHistory.length ? uploadHistory : summary?.recent_batches || []).map((batch) => (
                  <option key={batch.id} value={batch.id}>
                    {batch.label} ({batch.pool_count ?? batch.imported_count})
                  </option>
                ))}
              </select>
              </div>
            </div>
            <div className="max-h-[42vh] overflow-auto">
              <LeadBatchAccordion
                groups={poolBatchGroups}
                expandedKeys={expandedPoolBatchKeys}
                onToggle={(key) => {
                  setExpandedPoolBatchKeys((prev) => {
                    const next = new Set(prev);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  });
                }}
                emptyMessage="No unassigned leads."
                compact
                renderItem={(lead) => {
                  const checked = selectedPoolIds.has(lead.id);
                  return (
                    <div
                      key={lead.id}
                      className={`flex items-start gap-2 rounded-lg border px-2 py-2 text-xs ${checked ? 'border-sky-300 bg-sky-50' : 'border-[#edf3fa]'}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setSelectedPoolIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(lead.id)) next.delete(lead.id);
                            else next.add(lead.id);
                            return next;
                          });
                        }}
                        className="mt-0.5"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="font-semibold text-[#0B1B34]">{lead.full_name}</span>
                        <span className="mt-0.5 block text-[#4b6d95]">{lead.email || '—'} · {lead.phone || '—'}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => void deletePoolLeads([lead.id], `Delete ${lead.full_name || 'this lead'}?`)}
                        disabled={deleting}
                        className="shrink-0 rounded-lg border border-red-200 p-1 text-red-700 hover:bg-red-50 disabled:opacity-50"
                        title="Delete lead"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  );
                }}
              />
            </div>
          </div>

          <div className="rounded-2xl border border-[#cde0f4] bg-white p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm font-semibold text-[#0B1B34]">
                <Users size={15} />
                Recruiter performance ({recruiterOverview.length})
              </p>
              <select
                value={selectedBatchId}
                onChange={(e) => setSelectedBatchId(e.target.value)}
                className="rounded-lg border border-[#c8ddf4] px-2 py-1 text-xs"
              >
                <option value="">All batches</option>
                {(summary?.recent_batches || []).map((batch) => (
                  <option key={batch.id} value={batch.id}>
                    {batch.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="max-h-[min(72vh,720px)] overflow-auto">
              <HrRecruiterTrackingPanel
                recruiters={recruiterOverview}
                batches={uploadHistory.length ? uploadHistory : summary?.recent_batches || []}
                selectedBatchId={selectedBatchId}
                loading={loading}
                onLoadRecruiterLeads={loadRecruiterLeads}
              />
            </div>
          </div>
        </section>
      </div>
    </Layout>
  );
};

export default HrLeadDistributionPage;

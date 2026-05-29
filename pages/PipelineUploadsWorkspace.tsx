import React from 'react';
import { FileUp, RefreshCw } from 'lucide-react';
import PipelineAuthShell from '../components/PipelineAuthShell';
import { Button } from '../components/UI';
import {
  bulkUploadPipelineResumes,
  getPipelineUserCallSettings,
  listPipelineManualCandidates,
  savePipelineUserCallSettings,
  type PipelineCandidate,
  type PipelineUploadProgress,
} from '../services/pipelineService';
import { supabase } from '../services/supabaseClient';
import { formatDateTimeCanadaEastern } from '../services/dateDisplay';

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
    void loadData();
  }, [loadData]);

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

  const todayIso = new Date().toISOString().slice(0, 10);
  const uploadedToday = candidates.filter((row) => row.created_at.slice(0, 10) === todayIso).length;

  return (
    <PipelineAuthShell
      title="Resume Upload Workspace"
      subtitle="Sign in to manage recruiter uploads"
      redirectPath="/pipeline/uploads"
    >
      <div className="mx-auto w-full max-w-[1320px] p-4 space-y-4">
        <div className="rounded-3xl border border-[#d5e5f8] bg-white/80 backdrop-blur-xl p-4 shadow-[0_18px_45px_-28px_rgba(11,27,52,0.35)]">
          <h1 className="text-lg font-semibold text-[#0B1B34]">Resume Upload Workspace</h1>
          <p className="text-xs text-[#365274]">Bulk upload resumes + monitor uploaded queue for recruiter workflow.</p>
        </div>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        {message && <div className="rounded-xl border border-[#cfe3f9] bg-[#f3f8ff] px-3 py-2 text-xs text-[#365274]">{message}</div>}

        <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
          <section className="rounded-2xl border border-[#d8e8fa] bg-white p-4 space-y-3">
            <label className="inline-flex items-center gap-2 rounded-xl border border-[#b8d2ef] bg-white px-3 py-2 text-xs cursor-pointer hover:bg-[#f2f8ff] text-[#0B1B34]">
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

            <div className="rounded-xl border border-[#dce9f8] bg-[#f8fbff] p-3 space-y-2">
              <p className="text-xs font-semibold text-[#0B1B34]">Daily upload target</p>
              <div className="flex items-center gap-2">
                {[100, 150].map((preset) => (
                  <button key={preset} type="button" onClick={() => setDailyTarget(preset)} className="rounded-lg border border-[#c7ddf5] bg-white px-2 py-1 text-xs text-[#365274]">{preset}</button>
                ))}
                <input
                  type="number"
                  min={0}
                  placeholder="Custom"
                  value={dailyTarget}
                  onChange={(e) => setDailyTarget(e.target.value ? Number(e.target.value) : '')}
                  className="w-full rounded-lg border border-[#c7ddf5] px-2 py-1.5 text-xs"
                />
              </div>
              <Button variant="outline" className="!min-h-0 h-8 text-xs" onClick={() => void saveTarget()} disabled={savingTarget}>
                {savingTarget ? 'Saving...' : 'Save target'}
              </Button>
              <p className="text-[11px] text-[#4b6f98]">Uploaded today: {uploadedToday} {dailyTarget !== '' ? ` / target ${dailyTarget}` : ''}</p>
            </div>

            {!!Object.keys(progressByIndex).length && (
              <div className="space-y-1">
                {Object.values(progressByIndex).sort((a, b) => a.index - b.index).map((progress) => (
                  <div key={`${progress.index}-${progress.fileName}`} className="rounded-lg border border-slate-200 bg-white px-2 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] text-slate-700 truncate">{progress.fileName}</p>
                      <span className="text-[10px] text-slate-500">{stageLabel(progress.stage)}</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                      <div className="h-full bg-[#005EB8]" style={{ width: `${Math.max(0, Math.min(100, progress.percent))}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-[#d8e8fa] bg-white p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-[#0B1B34]">Uploaded list summary</p>
              <Button variant="outline" className="!min-h-0 h-8 px-3 text-xs" onClick={() => void loadData()} disabled={loading}>
                <RefreshCw size={13} className={loading ? 'mr-1 animate-spin' : 'mr-1'} />
                Refresh
              </Button>
            </div>
            <div className="space-y-1.5 max-h-[72vh] overflow-auto">
              {candidates.map((candidate) => (
                <div key={candidate.id} className="rounded-lg border border-slate-200 bg-[#f8fbff] px-3 py-2">
                  <p className="text-xs font-semibold text-slate-800">{candidate.full_name || 'Unknown Candidate'}</p>
                  <p className="text-[10px] text-slate-500">
                    {candidate.phone || candidate.email || 'No contact info'} · {formatDateTimeCanadaEastern(candidate.created_at)}
                  </p>
                </div>
              ))}
              {!candidates.length && <p className="text-xs text-slate-500">No uploads found yet.</p>}
            </div>
          </section>
        </div>
      </div>
    </PipelineAuthShell>
  );
};

export default PipelineUploadsWorkspace;

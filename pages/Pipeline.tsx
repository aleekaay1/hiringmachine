import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Layout from '../components/Layout';
import { CandidateMailbox } from '../components/CandidateMailbox';
import { Button } from '../components/UI';
import { supabase } from '../services/supabaseClient';
import mammoth from 'mammoth';
import {
  addPipelineNote,
  bulkDeletePipelineCandidates,
  bulkUploadPipelineResumes,
  deletePipelineCandidate,
  getPipelineCandidateBundle,
  getPipelineResumeDisplayUrl,
  getPipelineResumeViewerKind,
  listPipelineCandidates,
  listPipelineIncomingEmailLogs,
  listPipelineEmailSendLogs,
  logPipelineCallAction,
  savePipelineCallDisposition,
  savePipelineEvaluation,
  syncPipelineIncomingEmails,
  triggerPipelineResumeConversion,
  type PipelineCandidate,
  type PipelineCandidateBundle,
  type PipelineEmailSendLog,
  type PipelineIncomingEmailLog,
  type PipelineCandidateProfile,
  type PipelineUploadProgress,
  type PipelineResume,
  updatePipelineCandidateProfile,
  updatePipelineCandidateSchedule,
} from '../services/pipelineService';
import { buildThreeCxWebclientUrl } from '../services/threeCxService';
import {
  PIPELINE_CALL_DISPOSITIONS,
  PIPELINE_PENDING_CALL_STORAGE_KEY,
  type PipelineCallDisposition,
  type PipelinePendingCallSession,
} from '../services/pipelineCallDispositions';
import { formatDateTimeCanadaEastern } from '../services/dateDisplay';
import { sendEmail } from '../services/emailService';
import { normalizeMessageIdForHeader, subjectForReply } from '../services/inboundEmailFormat';
import { appendEmailSignatureToHtml } from '../services/emailSignatureHtml';
import { ExternalLink, FileUp, Phone, RefreshCw, Search, Trash2, Volume2 } from 'lucide-react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

const JOURNEY_OPTIONS = ['new', 'queued_for_call', 'attempted', 'connected', 'follow_up', 'qualified', 'not_interested', 'hired'];
const DISPOSITION_OPTIONS = ['Need callback', 'No answer', 'Connected', 'Not interested', 'Qualified', 'Close'];
const DIAL_PAD = [
  { d: '1', s: '' },
  { d: '2', s: 'ABC' },
  { d: '3', s: 'DEF' },
  { d: '4', s: 'GHI' },
  { d: '5', s: 'JKL' },
  { d: '6', s: 'MNO' },
  { d: '7', s: 'PQRS' },
  { d: '8', s: 'TUV' },
  { d: '9', s: 'WXYZ' },
  { d: '*', s: '' },
  { d: '0', s: '+' },
  { d: '#', s: '' },
];

const PIPELINE_EMAIL_TEMPLATES = [
  {
    id: 'no_answer_followup',
    label: 'No answer follow-up',
    subject: 'Quick follow-up from Globe Life AIL – Paz Organization',
    body: `Hi {{candidateName}},

We tried reaching you regarding your resume and wanted to quickly follow up.

Your profile looks aligned with one of our current opportunities, and we would like to connect for a short introductory call.

Please reply with a convenient time, or you can join our career session link shared by our team.

Best regards,`,
  },
  {
    id: 'invite_session',
    label: 'Invite to career session',
    subject: 'Invitation: Live Career Overview Session',
    body: `Hi {{candidateName}},

Thank you for your interest in opportunities with Globe Life AIL Division – Paz Organization.

We would like to invite you to our Live Career Overview Session where we explain the role, growth path, and expectations in detail.

Reply to this email and our team will share the session schedule and next steps.

Best regards,`,
  },
  {
    id: 'post_call_next_step',
    label: 'Post-call next steps',
    subject: 'Next step after our conversation',
    body: `Hi {{candidateName}},

Thank you for speaking with us today.

As discussed, your profile is moving to the next step. Please keep an eye on your email for scheduling and assessment instructions.

If you have any questions, you can reply directly to this email.

Best regards,`,
  },
  {
    id: 'declined_polite',
    label: 'Polite close / not moving',
    subject: 'Update regarding your application',
    body: `Hi {{candidateName}},

Thank you for taking the time to connect with our team.

At this stage, we are moving forward with candidates whose current profile is more closely aligned with this opening. We appreciate your interest and professionalism throughout the process.

We wish you success and may reconnect for future roles that match your background.

Best regards,`,
  },
  {
    id: 'inbox_reply',
    label: 'Inbox / custom reply',
    subject: '',
    body: `Hi {{candidateName}},

`,
  },
] as const;

function latestNoteText(bundle: PipelineCandidateBundle | null): string {
  const n = bundle?.notes?.[0];
  if (!n) return 'No notes yet';
  return n.body;
}

function safeName(candidate: PipelineCandidate): string {
  return candidate.full_name?.trim() || 'Unknown Candidate';
}

function normalizeDialDestination(raw: string): string {
  const cleaned = raw.replace(/[^\d+]/g, '').trim();
  if (!cleaned) return '';
  if (cleaned.startsWith('+1')) return cleaned.slice(1);
  if (cleaned.startsWith('+')) return cleaned.slice(1);
  return cleaned;
}

function readCandidateProfile(candidate: PipelineCandidate | null): PipelineCandidateProfile {
  const meta = candidate?.metadata && typeof candidate.metadata === 'object' ? candidate.metadata : {};
  const p = (meta as Record<string, unknown>).ocr_profile;
  const obj = p && typeof p === 'object' ? p as Record<string, unknown> : {};
  return {
    current_title: typeof obj.current_title === 'string' ? obj.current_title : null,
    location: typeof obj.location === 'string' ? obj.location : null,
    total_experience_years: typeof obj.total_experience_years === 'string' ? obj.total_experience_years : null,
    education_highest: typeof obj.education_highest === 'string' ? obj.education_highest : null,
    skills_summary: typeof obj.skills_summary === 'string' ? obj.skills_summary : null,
    work_summary: typeof obj.work_summary === 'string' ? obj.work_summary : null,
  };
}

function readCandidateTextExcerpt(candidate: PipelineCandidate | null): string {
  const meta = candidate?.metadata && typeof candidate.metadata === 'object' ? candidate.metadata : {};
  const raw = (meta as Record<string, unknown>).ocr_text_excerpt;
  return typeof raw === 'string' ? raw : '';
}

function getResumeExt(name: string): string {
  const clean = name.trim().toLowerCase();
  const dot = clean.lastIndexOf('.');
  if (dot < 0) return '';
  return clean.slice(dot + 1);
}

function stripRtf(raw: string): string {
  return raw
    .replace(/\\par[d]?/g, '\n')
    .replace(/\\'[0-9a-fA-F]{2}/g, ' ')
    .replace(/\\[a-z]+\d* ?/g, '')
    .replace(/[{}]/g, '')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function readPendingCallSession(): PipelinePendingCallSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PIPELINE_PENDING_CALL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PipelinePendingCallSession;
    if (!parsed?.sessionId || !parsed?.candidateId || !parsed?.dialedNumber || !parsed?.startedAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writePendingCallSession(session: PipelinePendingCallSession | null): void {
  if (typeof window === 'undefined') return;
  if (!session) {
    window.localStorage.removeItem(PIPELINE_PENDING_CALL_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(PIPELINE_PENDING_CALL_STORAGE_KEY, JSON.stringify(session));
}

type CallDispositionPanelProps = {
  pendingCall: PipelinePendingCallSession;
  callDisposition: PipelineCallDisposition | '';
  onSelectDisposition: (d: PipelineCallDisposition) => void;
  callDispositionComment: string;
  onCommentChange: (value: string) => void;
  callDispositionError: string | null;
  callDispositionSaving: boolean;
  dialLogWarning: string | null;
  onSave: () => void;
  compact?: boolean;
};

function CallDispositionPanel({
  pendingCall,
  callDisposition,
  onSelectDisposition,
  callDispositionComment,
  onCommentChange,
  callDispositionError,
  callDispositionSaving,
  dialLogWarning,
  onSave,
  compact = false,
}: CallDispositionPanelProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="call-disposition-title"
      className={`rounded-2xl border border-amber-200 bg-white shadow-lg ${compact ? 'p-3 space-y-3' : 'p-5 space-y-4'}`}
    >
      <div>
        <p id="call-disposition-title" className={`font-semibold text-slate-900 ${compact ? 'text-sm' : 'text-base'}`}>
          Log call disposition
        </p>
        <p className={`text-slate-600 mt-1 ${compact ? 'text-[11px]' : 'text-xs'}`}>
          Required before you can dial again. Complete this for{' '}
          <span className="font-semibold text-slate-800">{pendingCall.candidateName}</span>
          {' · '}
          <span className="font-mono">{pendingCall.dialedNumber}</span>
        </p>
        <p className="text-[10px] text-slate-500 mt-1">
          Started {formatDateTimeCanadaEastern(pendingCall.startedAt)}
        </p>
        {dialLogWarning && (
          <p className="text-[10px] text-amber-900 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1 mt-2">
            {dialLogWarning}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {PIPELINE_CALL_DISPOSITIONS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => onSelectDisposition(d)}
            className={`rounded-xl border px-3 py-2 text-left text-xs font-medium transition ${
              callDisposition === d
                ? 'border-[#005EB8] bg-blue-50 text-[#005EB8] ring-2 ring-[#005EB8]/20'
                : 'border-slate-200 bg-slate-50 text-slate-800 hover:border-slate-300 hover:bg-white'
            }`}
          >
            {d}
          </button>
        ))}
      </div>

      <label className="block text-xs text-slate-600">
        Comment (optional)
        <textarea
          value={callDispositionComment}
          onChange={(e) => onCommentChange(e.target.value)}
          rows={compact ? 2 : 3}
          placeholder="Notes about the conversation, callback time, etc."
          className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
        />
      </label>

      {callDispositionError && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{callDispositionError}</p>
      )}

      <div className="flex items-center justify-between gap-3 pt-1">
        <p className="text-[10px] text-amber-800">Dialer locked until you save.</p>
        <Button onClick={() => onSave()} disabled={!callDisposition || callDispositionSaving}>
          {callDispositionSaving ? 'Saving…' : 'Save disposition'}
        </Button>
      </div>
    </div>
  );
}

function uploadStageLabel(stage: PipelineUploadProgress['stage']): string {
  switch (stage) {
    case 'starting':
      return 'Preparing';
    case 'extracting':
      return 'Extracting OCR';
    case 'saving_candidate':
      return 'Saving candidate';
    case 'uploading_file':
      return 'Uploading file';
    case 'creating_resume':
      return 'Saving resume';
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

const Pipeline: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [email, setEmail] = useState('admin@globelife-paz.com');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [candidates, setCandidates] = useState<PipelineCandidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [selectedBundle, setSelectedBundle] = useState<PipelineCandidateBundle | null>(null);
  const [selectedResumeId, setSelectedResumeId] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [newNote, setNewNote] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);

  const [fitScore, setFitScore] = useState<number | null>(null);
  const [disposition, setDisposition] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [journeyStage, setJourneyStage] = useState('new');
  const [evaluationComments, setEvaluationComments] = useState('');
  const [evalSaving, setEvalSaving] = useState(false);

  const [scheduledForInput, setScheduledForInput] = useState('');
  const [scheduleSaving, setScheduleSaving] = useState(false);

  const [dialTarget, setDialTarget] = useState('');
  const [callActionMsg, setCallActionMsg] = useState<string | null>(null);
  const [pendingCall, setPendingCall] = useState<PipelinePendingCallSession | null>(null);
  const [callDisposition, setCallDisposition] = useState<PipelineCallDisposition | ''>('');
  const [callDispositionComment, setCallDispositionComment] = useState('');
  const [callDispositionSaving, setCallDispositionSaving] = useState(false);
  const [callDispositionError, setCallDispositionError] = useState<string | null>(null);
  const [dialLogWarning, setDialLogWarning] = useState<string | null>(null);
  const [toneEnabled, setToneEnabled] = useState(true);
  const [emailTemplateId, setEmailTemplateId] = useState<string>('no_answer_followup');
  const [emailTo, setEmailTo] = useState('');
  const [emailCc, setEmailCc] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [emailMsg, setEmailMsg] = useState<string | null>(null);
  const [incomingEmailLogs, setIncomingEmailLogs] = useState<PipelineIncomingEmailLog[]>([]);
  const [emailSendLogs, setEmailSendLogs] = useState<PipelineEmailSendLog[]>([]);
  const [incomingSyncing, setIncomingSyncing] = useState(false);
  const [incomingMsg, setIncomingMsg] = useState<string | null>(null);
  const [emailInReplyTo, setEmailInReplyTo] = useState<string | null>(null);
  const [emailReferences, setEmailReferences] = useState<string | null>(null);
  const [profileFullName, setProfileFullName] = useState('');
  const [profileEmail, setProfileEmail] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [profileTitle, setProfileTitle] = useState('');
  const [profileLocation, setProfileLocation] = useState('');
  const [profileExperience, setProfileExperience] = useState('');
  const [profileEducation, setProfileEducation] = useState('');
  const [profileSkills, setProfileSkills] = useState('');
  const [profileSummary, setProfileSummary] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [uploadProgressByIndex, setUploadProgressByIndex] = useState<Record<number, PipelineUploadProgress>>({});
  const [uploadTotalCount, setUploadTotalCount] = useState(0);
  const [uploadCurrentMessage, setUploadCurrentMessage] = useState<string>('Starting upload...');
  const [docPreviewText, setDocPreviewText] = useState('');
  const [docPreviewLoading, setDocPreviewLoading] = useState(false);
  const [numPdfPages, setNumPdfPages] = useState<number>(0);
  const toneCtxRef = useRef<AudioContext | null>(null);
  const emailBodyRef = useRef<HTMLTextAreaElement | null>(null);

  const loadCandidates = async () => {
    setError(null);
    setLoading(true);
    try {
      const rows = await listPipelineCandidates();
      setCandidates(rows);
      if (!selectedCandidateId && rows.length > 0) setSelectedCandidateId(rows[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const loadSelectedBundle = async (candidateId: string) => {
    setError(null);
    setLoading(true);
    try {
      const bundle = await getPipelineCandidateBundle(candidateId);
      setSelectedBundle(bundle);
      if (bundle?.resumes?.length) setSelectedResumeId((prev) => prev ?? bundle.resumes[0].id);
      setJourneyStage(bundle?.candidate.journey_stage || 'new');
      setScheduledForInput(
        bundle?.candidate.scheduled_for ? new Date(bundle.candidate.scheduled_for).toISOString().slice(0, 16) : ''
      );
      setDialTarget(bundle?.candidate.phone || '');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setIsAuthenticated(true);
        const restored = readPendingCallSession();
        if (restored) setPendingCall(restored);
      }
    });
  }, []);

  const dialerLocked = Boolean(pendingCall);

  useEffect(() => {
    if (isAuthenticated) void loadCandidates();
  }, [isAuthenticated]);

  useEffect(() => {
    if (selectedCandidateId && isAuthenticated) void loadSelectedBundle(selectedCandidateId);
  }, [selectedCandidateId, isAuthenticated]);

  useEffect(() => {
    const c = selectedBundle?.candidate;
    if (!c) return;
    setEmailTo(String(c.email || '').trim());
    setEmailCc('');
    setEmailMsg(null);
    setEmailInReplyTo(null);
    setEmailReferences(null);
    applyTemplate('no_answer_followup');
    const profile = readCandidateProfile(c);
    setProfileFullName(c.full_name || '');
    setProfileEmail(c.email || '');
    setProfilePhone(c.phone || '');
    setProfileTitle(profile.current_title || '');
    setProfileLocation(profile.location || '');
    setProfileExperience(profile.total_experience_years || '');
    setProfileEducation(profile.education_highest || '');
    setProfileSkills(profile.skills_summary || '');
    setProfileSummary(profile.work_summary || '');
    setProfileMsg(null);
    void listPipelineIncomingEmailLogs(c.id)
      .then(setIncomingEmailLogs)
      .catch((e) => setIncomingMsg(e instanceof Error ? e.message : String(e)));
    void listPipelineEmailSendLogs(c.id)
      .then(setEmailSendLogs)
      .catch(() => setEmailSendLogs([]));
  }, [selectedBundle?.candidate.id]);

  const selectedResume: PipelineResume | null = useMemo(() => {
    if (!selectedBundle?.resumes?.length) return null;
    return selectedBundle.resumes.find((r) => r.id === selectedResumeId) || selectedBundle.resumes[0];
  }, [selectedBundle, selectedResumeId]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const resume = selectedResume;
      if (!resume || !selectedBundle?.candidate) {
        setDocPreviewText('');
        setDocPreviewLoading(false);
        return;
      }
      const kind = getPipelineResumeViewerKind(resume);
      const url = getPipelineResumeDisplayUrl(resume);
      if (!url || kind === 'pdf' || kind === 'image') {
        setDocPreviewText('');
        setDocPreviewLoading(false);
        return;
      }
      const excerpt = readCandidateTextExcerpt(selectedBundle.candidate);
      if (excerpt.trim()) {
        setDocPreviewText(excerpt);
      } else {
        setDocPreviewText('');
      }
      setDocPreviewLoading(true);
      try {
        const ext = getResumeExt(resume.original_filename);
        const response = await fetch(url, { method: 'GET' });
        if (!response.ok) throw new Error(`Preview fetch failed (${response.status})`);
        if (ext === 'docx') {
          const arr = await response.arrayBuffer();
          const result = await mammoth.extractRawText({ arrayBuffer: arr });
          if (!cancelled) setDocPreviewText(String(result.value || '').trim() || excerpt || 'No preview text found.');
        } else if (ext === 'rtf' || ext === 'txt' || ext === 'doc') {
          const text = await response.text();
          const preview = ext === 'rtf' ? stripRtf(text) : text;
          if (!cancelled) setDocPreviewText(preview.trim() || excerpt || 'No preview text found.');
        } else if (!excerpt.trim()) {
          if (!cancelled) setDocPreviewText('Preview is not available for this file type without external conversion.');
        }
      } catch {
        if (!cancelled && !excerpt.trim()) {
          setDocPreviewText('Unable to render this document inline. Upload DOCX/PDF/Image for best inline viewing.');
        }
      } finally {
        if (!cancelled) setDocPreviewLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [selectedResume?.id, selectedBundle?.candidate?.id]);

  const filteredCandidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return candidates.filter((c) => {
      if (stageFilter && c.journey_stage !== stageFilter) return false;
      if (statusFilter && c.status !== statusFilter) return false;
      if (!q) return true;
      return (
        safeName(c).toLowerCase().includes(q) ||
        String(c.phone || '').toLowerCase().includes(q) ||
        String(c.email || '').toLowerCase().includes(q)
      );
    });
  }, [candidates, search, stageFilter, statusFilter]);

  const uploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const fileArray = Array.from(files);
    setUploading(true);
    setUploadTotalCount(fileArray.length);
    setUploadCurrentMessage('Preparing upload...');
    const initialProgress: Record<number, PipelineUploadProgress> = {};
    fileArray.forEach((file, index) => {
      initialProgress[index] = {
        index,
        total: fileArray.length,
        fileName: file.name,
        stage: 'starting',
        percent: 0,
        processed: 0,
        succeeded: 0,
        failed: 0,
        message: 'Queued',
      };
    });
    setUploadProgressByIndex(initialProgress);
    setError(null);
    try {
      const { data } = await supabase.auth.getUser();
      const actorLabel = String(data.user?.user_metadata?.full_name || data.user?.user_metadata?.name || data.user?.email || '').trim() || undefined;
      const result = await bulkUploadPipelineResumes(fileArray, actorLabel, (progress) => {
        setUploadProgressByIndex((prev) => ({ ...prev, [progress.index]: progress }));
        setUploadCurrentMessage(`${uploadStageLabel(progress.stage)}: ${progress.fileName}`);
      });
      if (result.failed.length > 0) {
        setError(`Uploaded ${result.created.length}, failed ${result.failed.length}. First error: ${result.failed[0].error}`);
      }
      await loadCandidates();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      setUploadCurrentMessage('Upload finished.');
      setTimeout(() => {
        setUploadProgressByIndex({});
        setUploadTotalCount(0);
      }, 900);
    }
  };

  const toggleSelectedId = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const deleteCurrentCandidate = async () => {
    if (!selectedBundle?.candidate.id) return;
    const ok = window.confirm(`Delete ${safeName(selectedBundle.candidate)} and all related resume/call/note data?`);
    if (!ok) return;
    try {
      setLoading(true);
      await deletePipelineCandidate(selectedBundle.candidate.id);
      setSelectedBundle(null);
      setSelectedCandidateId(null);
      setSelectedResumeId(null);
      setSelectedIds(new Set());
      await loadCandidates();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const bulkDeleteSelected = async () => {
    if (!selectedIds.size) return;
    const ok = window.confirm(`Delete ${selectedIds.size} selected candidate(s) and related data?`);
    if (!ok) return;
    try {
      setLoading(true);
      await bulkDeletePipelineCandidates(Array.from(selectedIds));
      if (selectedCandidateId && selectedIds.has(selectedCandidateId)) {
        setSelectedBundle(null);
        setSelectedCandidateId(null);
        setSelectedResumeId(null);
      }
      setSelectedIds(new Set());
      await loadCandidates();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const addNote = async () => {
    if (!selectedBundle?.candidate.id || !newNote.trim()) return;
    setNoteSaving(true);
    try {
      const { data } = await supabase.auth.getUser();
      const actorLabel = String(data.user?.user_metadata?.full_name || data.user?.user_metadata?.name || data.user?.email || '').trim() || undefined;
      await addPipelineNote(selectedBundle.candidate.id, newNote, actorLabel);
      setNewNote('');
      await loadSelectedBundle(selectedBundle.candidate.id);
      await loadCandidates();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setNoteSaving(false);
    }
  };

  const saveEvaluation = async () => {
    if (!selectedBundle?.candidate.id) return;
    setEvalSaving(true);
    try {
      const { data } = await supabase.auth.getUser();
      const actorLabel = String(data.user?.user_metadata?.full_name || data.user?.user_metadata?.name || data.user?.email || '').trim() || undefined;
      await savePipelineEvaluation({
        candidateId: selectedBundle.candidate.id,
        fitScore,
        disposition,
        nextAction,
        journeyStage,
        comments: evaluationComments,
        actorLabel,
      });
      await loadSelectedBundle(selectedBundle.candidate.id);
      await loadCandidates();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEvalSaving(false);
    }
  };

  const saveSchedule = async () => {
    if (!selectedBundle?.candidate.id) return;
    setScheduleSaving(true);
    try {
      await updatePipelineCandidateSchedule(
        selectedBundle.candidate.id,
        scheduledForInput ? new Date(scheduledForInput).toISOString() : null
      );
      await loadSelectedBundle(selectedBundle.candidate.id);
      await loadCandidates();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScheduleSaving(false);
    }
  };

  const mediaSessionUrl = useMemo(
    () => buildThreeCxWebclientUrl(dialTarget || selectedBundle?.candidate.phone || ''),
    [dialTarget, selectedBundle?.candidate.phone],
  );

  const selectedTemplate = useMemo(
    () => PIPELINE_EMAIL_TEMPLATES.find((t) => t.id === emailTemplateId) ?? PIPELINE_EMAIL_TEMPLATES[0],
    [emailTemplateId],
  );
  const emailLogs = useMemo(
    () => (selectedBundle?.callLogs || []).filter((x) => x.action === 'email_sent' || x.action === 'email_send_failed'),
    [selectedBundle?.callLogs],
  );
  const applyTemplate = (templateId: string) => {
    const t = PIPELINE_EMAIL_TEMPLATES.find((x) => x.id === templateId);
    if (!t) return;
    const name = (selectedBundle?.candidate.full_name || '').trim() || 'there';
    setEmailTemplateId(templateId);
    setEmailSubject(t.subject.replaceAll('{{candidateName}}', name));
    setEmailBody(t.body.replaceAll('{{candidateName}}', name));
    setEmailInReplyTo(null);
    setEmailReferences(null);
  };

  const fillComposeFromIncomingReply = (log: PipelineIncomingEmailLog) => {
    const name = (selectedBundle?.candidate.full_name || '').trim() || 'there';
    const t = PIPELINE_EMAIL_TEMPLATES.find((x) => x.id === 'inbox_reply');
    setEmailTemplateId('inbox_reply');
    setEmailTo(String(log.from_email || '').trim());
    setEmailCc('');
    setEmailSubject(subjectForReply(log.subject));
    setEmailBody((t?.body || `Hi {{candidateName}},\n\n`).replaceAll('{{candidateName}}', name));
    const mid = normalizeMessageIdForHeader(log.message_id);
    setEmailInReplyTo(mid);
    setEmailReferences(mid);
    setEmailMsg(null);
    emailBodyRef.current?.focus();
  };

  const plainToHtml = (text: string) => text
    .split('\n')
    .map((line) => `<p>${line || '&nbsp;'}</p>`)
    .join('');

  const playDialTone = () => {
    if (!toneEnabled || typeof window === 'undefined') return;
    const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    if (!toneCtxRef.current) toneCtxRef.current = new Ctx();
    const ctx = toneCtxRef.current;
    if (ctx.state === 'suspended') void ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.value = 0.03;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.06);
  };

  const dialViaWebclient = async () => {
    if (!selectedBundle?.candidate.id) return;
    if (dialerLocked) {
      setCallActionMsg('Save the call disposition before placing another call.');
      return;
    }
    const normalizedDestination = normalizeDialDestination(dialTarget.trim());
    if (!normalizedDestination) {
      setCallActionMsg('Enter a destination number to dial.');
      return;
    }
    const url = buildThreeCxWebclientUrl(normalizedDestination);
    if (!url) {
      setCallActionMsg('Set VITE_3CX_WEBCLIENT_URL in Vercel and redeploy.');
      return;
    }

    setDialTarget(normalizedDestination || dialTarget);
    const session: PipelinePendingCallSession = {
      sessionId: crypto.randomUUID(),
      candidateId: selectedBundle.candidate.id,
      candidateName: safeName(selectedBundle.candidate),
      resumeId: selectedResume?.id ?? null,
      dialedNumber: normalizedDestination,
      dialLogId: null,
      webclientUrl: url,
      startedAt: new Date().toISOString(),
    };
    setPendingCall(session);
    writePendingCallSession(session);
    setCallDisposition('');
    setCallDispositionComment('');
    setCallDispositionError(null);
    setDialLogWarning(null);
    setCallActionMsg('Opened 3CX webclient — log the disposition below (or in the popup).');

    window.open(url, '_blank', 'noopener,noreferrer');

    try {
      const { data } = await supabase.auth.getUser();
      const actorLabel = String(data.user?.user_metadata?.full_name || data.user?.user_metadata?.name || data.user?.email || '').trim() || undefined;
      const dialLog = await logPipelineCallAction({
        candidateId: selectedBundle.candidate.id,
        resumeId: selectedResume?.id ?? null,
        action: 'dial_webclient_popup',
        outcome: 'ok',
        agentExtension: null,
        requestPayload: { destination: normalizedDestination },
        responsePayload: { mode: 'webclient_popup', url },
        actorLabel,
      });
      const withLog: PipelinePendingCallSession = { ...session, dialLogId: dialLog.id };
      setPendingCall(withLog);
      writePendingCallSession(withLog);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setDialLogWarning(`Dial was logged locally, but the server audit row failed: ${msg}. You can still save the disposition.`);
      setCallActionMsg('Disposition required — see panel below.');
    }
  };

  const saveCallDisposition = async () => {
    if (!pendingCall) return;
    if (!callDisposition) {
      setCallDispositionError('Select a disposition to continue.');
      return;
    }
    setCallDispositionSaving(true);
    setCallDispositionError(null);
    try {
      const { data } = await supabase.auth.getUser();
      const actorLabel = String(data.user?.user_metadata?.full_name || data.user?.user_metadata?.name || data.user?.email || '').trim() || undefined;
      await savePipelineCallDisposition({
        candidateId: pendingCall.candidateId,
        resumeId: pendingCall.resumeId,
        dialLogId: pendingCall.dialLogId,
        disposition: callDisposition,
        comment: callDispositionComment,
        dialedNumber: pendingCall.dialedNumber,
        dialStartedAt: pendingCall.startedAt,
        threecxMetadata: {
          mode: 'webclient_popup',
          url: pendingCall.webclientUrl,
          session_id: pendingCall.sessionId,
        },
        actorLabel,
      });
      setPendingCall(null);
      writePendingCallSession(null);
      setCallDisposition('');
      setCallDispositionComment('');
      setDialLogWarning(null);
      setCallActionMsg('Call disposition saved. Dialer unlocked.');
      const refreshId = selectedBundle?.candidate.id || pendingCall.candidateId;
      if (refreshId) {
        await loadSelectedBundle(refreshId);
        await loadCandidates();
      }
    } catch (e) {
      setCallDispositionError(e instanceof Error ? e.message : String(e));
    } finally {
      setCallDispositionSaving(false);
    }
  };

  const openWebClientHome = () => {
    const url = buildThreeCxWebclientUrl('');
    if (!url) {
      setCallActionMsg('Set VITE_3CX_WEBCLIENT_URL in Vercel and redeploy.');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
    setCallActionMsg('Opened 3CX webclient.');
  };

  const sendPipelineEmail = async () => {
    if (!selectedBundle?.candidate.id) return;
    if (!emailTo.trim() || !emailSubject.trim() || !emailBody.trim()) {
      setEmailMsg('Email, subject, and body are required.');
      return;
    }
    setEmailSending(true);
    setEmailMsg(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setEmailMsg('You are not signed in.');
        return;
      }
      const html = appendEmailSignatureToHtml(plainToHtml(emailBody));
      const result = await sendEmail(token, {
        to: emailTo.trim(),
        cc: emailCc.trim() || undefined,
        subject: emailSubject.trim(),
        bodyHtml: html,
        trigger: `pipeline_${emailTemplateId}`,
        candidateId: selectedBundle.candidate.id,
        inReplyTo: emailInReplyTo?.trim() || undefined,
        references: emailReferences?.trim() || undefined,
      });
      const { data: u } = await supabase.auth.getUser();
      const actorLabel = String(u.user?.user_metadata?.full_name || u.user?.user_metadata?.name || u.user?.email || '').trim() || undefined;
      if (!('ok' in result)) {
        setEmailMsg(result.error || 'Failed to send email.');
        await logPipelineCallAction({
          candidateId: selectedBundle.candidate.id,
          resumeId: selectedResume?.id ?? null,
          action: 'email_send_failed',
          outcome: 'failed',
          requestPayload: {
            to: emailTo.trim(),
            cc: emailCc.trim() || '',
            subject: emailSubject.trim(),
            templateId: emailTemplateId,
          },
          responsePayload: { error: result.error || 'Failed to send email.' },
          actorLabel,
        });
        await loadSelectedBundle(selectedBundle.candidate.id);
        return;
      }
      setEmailMsg('Email sent successfully.');
      setEmailInReplyTo(null);
      setEmailReferences(null);
      await logPipelineCallAction({
        candidateId: selectedBundle.candidate.id,
        resumeId: selectedResume?.id ?? null,
        action: 'email_sent',
        outcome: 'ok',
        requestPayload: {
          to: emailTo.trim(),
          cc: emailCc.trim() || '',
          subject: emailSubject.trim(),
          templateId: emailTemplateId,
        },
        responsePayload: { trigger: `pipeline_${emailTemplateId}` },
        actorLabel,
      });
      await loadSelectedBundle(selectedBundle.candidate.id);
      try {
        const out = await listPipelineEmailSendLogs(selectedBundle.candidate.id);
        setEmailSendLogs(out);
      } catch {
        /* ignore */
      }
    } catch (e) {
      setEmailMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setEmailSending(false);
    }
  };

  const syncIncomingEmails = async () => {
    if (!selectedBundle?.candidate.id) return;
    setIncomingSyncing(true);
    setIncomingMsg(null);
    try {
      const result = await syncPipelineIncomingEmails(14, 120);
      const rows = await listPipelineIncomingEmailLogs(selectedBundle.candidate.id);
      setIncomingEmailLogs(rows);
      setIncomingMsg(`Inbox synced: ${result.synced} messages checked, ${result.mapped} mapped.`);
    } catch (e) {
      setIncomingMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setIncomingSyncing(false);
    }
  };

  const saveCandidateProfile = async () => {
    if (!selectedBundle?.candidate.id) return;
    setProfileSaving(true);
    setProfileMsg(null);
    try {
      await updatePipelineCandidateProfile({
        candidateId: selectedBundle.candidate.id,
        fullName: profileFullName,
        email: profileEmail || null,
        phone: profilePhone || null,
        profile: {
          current_title: profileTitle || null,
          location: profileLocation || null,
          total_experience_years: profileExperience || null,
          education_highest: profileEducation || null,
          skills_summary: profileSkills || null,
          work_summary: profileSummary || null,
        },
      });
      setProfileMsg('Candidate profile saved.');
      if (selectedBundle.candidate.id) {
        await loadSelectedBundle(selectedBundle.candidate.id);
      }
      await loadCandidates();
    } catch (e) {
      setProfileMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setProfileSaving(false);
    }
  };

  const keypadPress = (digit: string) => {
    if (dialerLocked) return;
    playDialTone();
    setDialTarget((prev) => `${prev}${digit}`);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isTypingField = tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable;
      if (isTypingField) return;
      if (event.key >= '0' && event.key <= '9') {
        event.preventDefault();
        keypadPress(event.key);
        return;
      }
      if (event.key === '*' || event.key === '#') {
        event.preventDefault();
        keypadPress(event.key);
        return;
      }
      if (event.key === 'Backspace' && !dialerLocked) {
        event.preventDefault();
        setDialTarget((prev) => prev.slice(0, -1));
        return;
      }
      if (event.key === 'Enter' && selectedBundle?.candidate.id && !dialerLocked) {
        event.preventDefault();
        void dialViaWebclient();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedBundle?.candidate.id, dialTarget, dialerLocked]);

  useEffect(() => () => {
    if (toneCtxRef.current) {
      void toneCtxRef.current.close();
      toneCtxRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!pendingCall) return;
    const blockEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('keydown', blockEscape, true);
    return () => window.removeEventListener('keydown', blockEscape, true);
  }, [pendingCall]);

  const refreshConversion = async () => {
    if (!selectedResume) return;
    try {
      await triggerPipelineResumeConversion(selectedResume.id);
      if (selectedBundle?.candidate.id) await loadSelectedBundle(selectedBundle.candidate.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#f7fbff] to-[#eef6ff] flex items-center justify-center p-4">
        <div className="bg-white border border-[#d9e9fb] p-8 rounded-[24px] shadow w-full max-w-sm">
          <h2 className="text-xl font-bold text-[#0B1B34] mb-1 text-center">Pipeline</h2>
          <p className="text-sm text-[#6f7b8d] text-center mb-6">Sign in with your admin account</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setAuthError(null);
              const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
              if (signInError) {
                setAuthError('Invalid email or password.');
                return;
              }
              setIsAuthenticated(true);
            }}
            className="space-y-4"
          >
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-4 py-2.5 rounded-xl border border-[#cfe3f9]" />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-4 py-2.5 rounded-xl border border-[#cfe3f9]" />
            <Button fullWidth type="submit">Sign in</Button>
            {authError && <p className="text-sm text-red-600 text-center">{authError}</p>}
          </form>
        </div>
      </div>
    );
  }

  return (
    <Layout isAdmin>
      <div className="w-full max-w-[1400px] mx-auto p-4 space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Pipeline</h1>
            <p className="text-xs text-slate-500">Bulk resume intake, inline review, 3CX call controls, and candidate progression.</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-xs cursor-pointer hover:bg-slate-50">
              <FileUp size={14} />
              {uploading ? 'Uploading…' : 'Bulk upload resumes'}
              <input
                type="file"
                className="hidden"
                multiple
                accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.rtf,.txt"
                onChange={(e) => void uploadFiles(e.target.files)}
                disabled={uploading}
              />
            </label>
            <Button variant="outline" onClick={() => void loadCandidates()} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'mr-1 animate-spin' : 'mr-1'} />
              Refresh
            </Button>
          </div>
        </div>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">{error}</div>}

        <div className="grid grid-cols-1 xl:grid-cols-[340px_1fr] gap-4">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="p-3 border-b border-slate-100 space-y-2">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, phone, email" className="w-full rounded-lg border border-slate-200 pl-8 pr-3 py-2 text-xs" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-2 text-xs">
                  <option value="">All stages</option>
                  {JOURNEY_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-2 text-xs">
                  <option value="">All status</option>
                  <option value="open">open</option>
                  <option value="in_progress">in_progress</option>
                  <option value="closed">closed</option>
                </select>
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-slate-500">Showing {filteredCandidates.length} / {candidates.length}</p>
                <Button variant="outline" className="!min-h-0 h-7 px-2 text-[11px]" onClick={() => void bulkDeleteSelected()} disabled={!selectedIds.size || loading}>
                  <Trash2 size={12} className="mr-1" /> Delete {selectedIds.size || ''}
                </Button>
              </div>
            </div>
            <div className="max-h-[calc(100vh-250px)] overflow-auto">
              <div className="sticky top-0 z-10 grid grid-cols-[1fr_1.2fr_90px] gap-2 bg-slate-50 border-b border-slate-200 px-3 py-1.5 text-[10px] uppercase tracking-wide text-slate-500">
                <span>Name</span>
                <span>Contact</span>
                <span className="text-right">Stage</span>
              </div>
              {filteredCandidates.map((c) => (
                <div key={c.id} className={`w-full px-3 py-1.5 border-b border-slate-100 ${selectedCandidateId === c.id ? 'bg-slate-100' : 'hover:bg-slate-50'}`}>
                  <div className="flex items-start gap-2">
                    <input type="checkbox" checked={selectedIds.has(c.id)} onChange={() => toggleSelectedId(c.id)} className="mt-1 rounded border-slate-300" />
                    <button type="button" onClick={() => setSelectedCandidateId(c.id)} className="flex-1 text-left min-w-0">
                      <div className="grid grid-cols-[1fr_1.2fr_90px] gap-2 items-center">
                        <p className="text-xs font-medium text-slate-900 truncate">{safeName(c)}</p>
                        <p className="text-[11px] text-slate-600 truncate">{c.phone || 'No phone'} {c.email ? `· ${c.email}` : ''}</p>
                        <span className="text-[10px] rounded-full bg-slate-100 px-2 py-0.5 text-slate-700 text-right">{c.journey_stage}</span>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        {c.scheduled_for ? `Scheduled ${formatDateTimeCanadaEastern(c.scheduled_for)}` : 'No schedule'} · {c.status}
                      </p>
                    </button>
                  </div>
                </div>
              ))}
              {!loading && filteredCandidates.length === 0 && (
                <div className="p-6 text-center text-sm text-slate-500">No pipeline candidates yet.</div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            {!selectedBundle ? (
              <div className="p-8 text-sm text-slate-500">Select a candidate to open resume + call controls.</div>
            ) : (
              <div className="min-h-[calc(100vh-250px)] flex flex-col">
                <div className="px-3 py-2.5 border-b border-slate-100 flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-slate-900 flex-1 truncate">{safeName(selectedBundle.candidate)}</p>
                  <select value={selectedResume?.id || ''} onChange={(e) => setSelectedResumeId(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs">
                    {selectedBundle.resumes.map((r) => (
                      <option key={r.id} value={r.id}>{r.original_filename}</option>
                    ))}
                  </select>
                  <Button variant="outline" className="!min-h-0 h-8 px-2 text-xs" onClick={() => void deleteCurrentCandidate()} disabled={loading}>
                    <Trash2 size={13} className="mr-1" /> Delete
                  </Button>
                </div>

                <div className="flex-1 min-h-[62vh] bg-slate-50 border-b border-slate-200">
                  {selectedResume ? (() => {
                    const kind = getPipelineResumeViewerKind(selectedResume);
                    const url = getPipelineResumeDisplayUrl(selectedResume);
                    if (!url) {
                      return (
                        <div className="p-4 text-sm text-slate-600">
                          <p>No display URL available.</p>
                          {selectedResume.conversion_status !== 'ready' && selectedResume.conversion_status !== 'not_required' && (
                            <Button className="mt-2" onClick={() => void refreshConversion()} variant="outline">Retry conversion</Button>
                          )}
                        </div>
                      );
                    }
                    if (kind === 'image') {
                      return <img src={url} alt={selectedResume.original_filename} className="w-full h-full object-contain" />;
                    }
                    if (kind === 'pdf') {
                      return (
                        <div className="h-full overflow-auto px-2 py-2">
                          <Document file={url} onLoadSuccess={(d) => setNumPdfPages(d.numPages)} loading={<div className="p-4 text-sm">Loading PDF…</div>}>
                            {Array.from({ length: numPdfPages || 1 }, (_, i) => (
                              <div key={`p-${i + 1}`} className="mb-2 flex justify-center">
                                <Page pageNumber={i + 1} width={Math.min(window.innerWidth - 460, 920)} renderTextLayer renderAnnotationLayer />
                              </div>
                            ))}
                          </Document>
                        </div>
                      );
                    }
                    return (
                      <div className="p-4 text-sm text-slate-600 space-y-2">
                        <p>Document preview</p>
                        {docPreviewLoading && <p className="text-xs text-slate-500">Extracting text preview...</p>}
                        {docPreviewText && (
                          <pre className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700 max-h-[45vh] overflow-auto">
                            {docPreviewText}
                          </pre>
                        )}
                        <a href={url} target="_blank" rel="noreferrer" className="block text-blue-700 underline">Open source file</a>
                      </div>
                    );
                  })() : (
                    <div className="p-4 text-sm text-slate-500">No resume uploaded for this candidate.</div>
                  )}
                </div>

                <div className="p-3 space-y-3">
                  <section className="rounded-xl border border-slate-200 p-3 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide flex items-center gap-1"><Phone size={13} /> Softphone dialer</h3>
                      <div className="flex items-center gap-1.5">
                        <button type="button" onClick={() => setToneEnabled((v) => !v)} className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] ${toneEnabled ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-500'}`}>
                          <Volume2 size={12} /> Key tones
                        </button>
                        <Button variant="outline" className="!min-h-0 h-7 px-2 text-[11px]" onClick={openWebClientHome}>
                          <ExternalLink size={12} className="mr-1" /> Pop out
                        </Button>
                      </div>
                    </div>

                    <div className={`rounded-xl border px-3 py-2 text-[11px] ${dialerLocked ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-indigo-100 bg-indigo-50/50 text-slate-600'}`}>
                      {dialerLocked
                        ? 'Call in progress — save a disposition below to unlock the dialer for the next call.'
                        : 'Calls use the 3CX WebClient popup. Enter a number and Dial; you must log a disposition before placing another call.'}
                    </div>

                    {pendingCall && (
                      <CallDispositionPanel
                        pendingCall={pendingCall}
                        callDisposition={callDisposition}
                        onSelectDisposition={(d) => {
                          setCallDisposition(d);
                          setCallDispositionError(null);
                        }}
                        callDispositionComment={callDispositionComment}
                        onCommentChange={setCallDispositionComment}
                        callDispositionError={callDispositionError}
                        callDispositionSaving={callDispositionSaving}
                        dialLogWarning={dialLogWarning}
                        onSave={() => void saveCallDisposition()}
                        compact
                      />
                    )}

                    <div className="flex flex-wrap items-start gap-3">
                      <div className={`w-[220px] rounded-2xl border p-3 shadow-inner ${dialerLocked ? 'border-amber-200 bg-amber-50/40 opacity-60 pointer-events-none' : 'border-slate-300 bg-gradient-to-b from-slate-100 to-slate-50'}`}>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Dialer</p>
                        <input
                          value={dialTarget}
                          onChange={(e) => setDialTarget(e.target.value)}
                          placeholder="10/11 digit number"
                          disabled={dialerLocked}
                          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold tracking-wide text-slate-900 mb-2 disabled:bg-slate-100"
                        />
                        <div className="text-[10px] text-slate-500 mb-1">Normalized: <span className="font-semibold text-slate-700">{normalizeDialDestination(dialTarget) || '—'}</span></div>
                        <div className="grid grid-cols-3 gap-1.5">
                          {DIAL_PAD.map((k) => (
                            <button key={k.d} type="button" disabled={dialerLocked} onClick={() => keypadPress(k.d)} className="rounded-xl border border-slate-300 bg-white py-2 hover:bg-slate-50 transition disabled:opacity-50">
                              <p className="text-sm font-semibold text-slate-900 leading-tight">{k.d}</p>
                              <p className="text-[9px] text-slate-500 leading-tight min-h-[10px]">{k.s}</p>
                            </button>
                          ))}
                        </div>
                        <div className="grid grid-cols-2 gap-1.5 mt-2">
                          <button type="button" disabled={dialerLocked} onClick={() => setDialTarget((prev) => prev.slice(0, -1))} className="rounded-lg border border-slate-300 bg-white py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50">Backspace</button>
                          <Button className="!min-h-0 h-8 text-xs" disabled={dialerLocked} onClick={() => void dialViaWebclient()}>Dial</Button>
                        </div>
                        <p className="text-[10px] text-slate-500 mt-2">Keyboard: 0-9, *, #, Backspace, Enter</p>
                      </div>

                      <div className="flex-1 min-w-[300px] rounded-xl border border-slate-200 bg-white p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-slate-700">Email composer</p>
                          <select
                            value={emailTemplateId}
                            onChange={(e) => applyTemplate(e.target.value)}
                            className="rounded-lg border border-slate-200 px-2 py-1 text-[11px]"
                          >
                            {PIPELINE_EMAIL_TEMPLATES.map((t) => (
                              <option key={t.id} value={t.id}>{t.label}</option>
                            ))}
                          </select>
                        </div>
                        <input
                          value={emailTo}
                          onChange={(e) => setEmailTo(e.target.value)}
                          placeholder="To"
                          className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs"
                        />
                        <input
                          value={emailCc}
                          onChange={(e) => setEmailCc(e.target.value)}
                          placeholder="CC (optional, comma separated)"
                          className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs"
                        />
                        <input
                          value={emailSubject}
                          onChange={(e) => setEmailSubject(e.target.value)}
                          placeholder="Subject"
                          className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs"
                        />
                        {emailInReplyTo && (
                          <p className="text-[10px] text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-lg px-2 py-1">
                            Replying in thread (In-Reply-To set). Send keeps the conversation linked in Gmail / Outlook.
                          </p>
                        )}
                        <textarea
                          ref={emailBodyRef}
                          value={emailBody}
                          onChange={(e) => setEmailBody(e.target.value)}
                          rows={8}
                          placeholder="Compose email body..."
                          className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs leading-relaxed"
                        />
                        <p className="text-[10px] text-slate-500">Signature auto-appends using your existing company email signature.</p>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] text-slate-500">{selectedTemplate?.label || 'Template'}</span>
                          <Button className="!min-h-0 h-8 text-xs" onClick={() => void sendPipelineEmail()} disabled={emailSending}>
                            {emailSending ? 'Sending…' : 'Send email'}
                          </Button>
                        </div>
                        {emailMsg && <p className="text-[11px] text-slate-600">{emailMsg}</p>}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="secondary" onClick={openWebClientHome}>Open 3CX web client</Button>
                      {callActionMsg && <p className="text-xs text-slate-600">{callActionMsg}</p>}
                    </div>
                  </section>

                  <CandidateMailbox
                    incomingLogs={incomingEmailLogs}
                    sendLogs={emailSendLogs}
                    pipelineEmailLogs={emailLogs}
                    syncing={incomingSyncing}
                    syncMessage={incomingMsg}
                    onSync={() => void syncIncomingEmails()}
                    onReply={fillComposeFromIncomingReply}
                    candidateEmail={String(selectedBundle.candidate.email || profileEmail || '').trim()}
                  />

                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                    <section className="rounded-xl border border-slate-200 p-3 space-y-2">
                      <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Notes</h3>
                      <div className="space-y-2 max-h-40 overflow-auto">
                        {selectedBundle.notes.map((n) => (
                          <div key={n.id} className="rounded-lg bg-slate-50 border border-slate-100 p-2">
                            <p className="text-xs text-slate-800 whitespace-pre-wrap">{n.body}</p>
                            <p className="text-[10px] text-slate-500 mt-1">{formatDateTimeCanadaEastern(n.created_at)}{n.author_label ? ` · ${n.author_label}` : ''}</p>
                          </div>
                        ))}
                        {selectedBundle.notes.length === 0 && <p className="text-xs text-slate-400">No notes yet.</p>}
                      </div>
                      <textarea value={newNote} onChange={(e) => setNewNote(e.target.value)} rows={3} placeholder="Write note…" className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
                      <Button onClick={() => void addNote()} disabled={!newNote.trim() || noteSaving}>
                        {noteSaving ? 'Saving…' : 'Add note'}
                      </Button>
                    </section>

                    <section className="rounded-xl border border-slate-200 p-3 space-y-2">
                      <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Evaluation + schedule</h3>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="text-xs text-slate-600">
                          Fit (1-10)
                          <input type="number" min={1} max={10} value={fitScore ?? ''} onChange={(e) => setFitScore(e.target.value ? Number(e.target.value) : null)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
                        </label>
                        <label className="text-xs text-slate-600">
                          Journey stage
                          <select value={journeyStage} onChange={(e) => setJourneyStage(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs">
                            {JOURNEY_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </label>
                        <label className="text-xs text-slate-600 col-span-2">
                          Disposition
                          <select value={disposition} onChange={(e) => setDisposition(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs">
                            <option value="">Select</option>
                            {DISPOSITION_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                          </select>
                        </label>
                        <label className="text-xs text-slate-600 col-span-2">
                          Schedule
                          <input type="datetime-local" value={scheduledForInput} onChange={(e) => setScheduledForInput(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
                        </label>
                        <label className="text-xs text-slate-600 col-span-2">
                          Next action
                          <input value={nextAction} onChange={(e) => setNextAction(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
                        </label>
                        <label className="text-xs text-slate-600 col-span-2">
                          Comments
                          <textarea value={evaluationComments} onChange={(e) => setEvaluationComments(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
                        </label>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button onClick={() => void saveEvaluation()} disabled={evalSaving}>{evalSaving ? 'Saving…' : 'Save evaluation'}</Button>
                        <Button variant="outline" onClick={() => void saveSchedule()} disabled={scheduleSaving}>{scheduleSaving ? 'Saving…' : 'Save schedule'}</Button>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div className="rounded-lg bg-slate-50 border border-slate-100 p-2">
                          <p className="text-slate-500">Total logs</p>
                          <p className="font-semibold text-slate-900">{selectedBundle.callLogs.length}</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 border border-slate-100 p-2">
                          <p className="text-slate-500">Dispositions</p>
                          <p className="font-semibold text-slate-900">{(selectedBundle.callRecords ?? []).length}</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 border border-slate-100 p-2">
                          <p className="text-slate-500">Dials</p>
                          <p className="font-semibold text-slate-900">{selectedBundle.callLogs.filter((x) => x.action === 'dial_webclient_popup').length}</p>
                        </div>
                      </div>
                      {(selectedBundle.callRecords ?? []).length > 0 && (
                        <div className="max-h-28 overflow-auto space-y-1.5">
                          {(selectedBundle.callRecords ?? []).slice(0, 8).map((r) => (
                            <div key={r.id} className="rounded-lg border border-slate-100 bg-slate-50 px-2 py-1.5 text-[10px]">
                              <p className="font-medium text-slate-800">{r.disposition} · {r.dialed_number}</p>
                              <p className="text-slate-500 truncate">
                                {formatDateTimeCanadaEastern(r.disposed_at)}
                                {r.comment ? ` · ${r.comment}` : ''}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  </div>

                  <section className="rounded-xl border border-slate-200 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Candidate profile (OCR + manual edit)</h3>
                      <Button className="!min-h-0 h-8 text-xs" onClick={() => void saveCandidateProfile()} disabled={profileSaving}>
                        {profileSaving ? 'Saving…' : 'Save profile'}
                      </Button>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Keep only relevant hiring details. Correct OCR mistakes here so phone/email/name and summary stay reliable.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      <label className="text-xs text-slate-600">
                        Full name
                        <input value={profileFullName} onChange={(e) => setProfileFullName(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
                      </label>
                      <label className="text-xs text-slate-600">
                        Email
                        <input value={profileEmail} onChange={(e) => setProfileEmail(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
                      </label>
                      <label className="text-xs text-slate-600">
                        Phone
                        <input value={profilePhone} onChange={(e) => setProfilePhone(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
                      </label>
                      <label className="text-xs text-slate-600">
                        Current title
                        <input value={profileTitle} onChange={(e) => setProfileTitle(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
                      </label>
                      <label className="text-xs text-slate-600">
                        Location
                        <input value={profileLocation} onChange={(e) => setProfileLocation(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
                      </label>
                      <label className="text-xs text-slate-600">
                        Experience
                        <input value={profileExperience} onChange={(e) => setProfileExperience(e.target.value)} placeholder="e.g. 5+ years" className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
                      </label>
                      <label className="text-xs text-slate-600 md:col-span-2">
                        Highest education
                        <input value={profileEducation} onChange={(e) => setProfileEducation(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
                      </label>
                      <label className="text-xs text-slate-600 md:col-span-3">
                        Skills summary
                        <input value={profileSkills} onChange={(e) => setProfileSkills(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
                      </label>
                      <label className="text-xs text-slate-600 md:col-span-3">
                        Work summary
                        <textarea value={profileSummary} onChange={(e) => setProfileSummary(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
                      </label>
                    </div>
                    {profileMsg && <p className="text-[11px] text-slate-600">{profileMsg}</p>}
                  </section>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {pendingCall && typeof document !== 'undefined'
        ? createPortal(
            <div className="fixed inset-0 z-[200] bg-slate-900/55 backdrop-blur-sm flex items-center justify-center px-4">
              <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
                <CallDispositionPanel
                  pendingCall={pendingCall}
                  callDisposition={callDisposition}
                  onSelectDisposition={(d) => {
                    setCallDisposition(d);
                    setCallDispositionError(null);
                  }}
                  callDispositionComment={callDispositionComment}
                  onCommentChange={setCallDispositionComment}
                  callDispositionError={callDispositionError}
                  callDispositionSaving={callDispositionSaving}
                  dialLogWarning={dialLogWarning}
                  onSave={() => void saveCallDisposition()}
                />
              </div>
            </div>,
            document.body,
          )
        : null}
      {uploading && (
        <div className="fixed inset-0 z-[90] bg-slate-900/35 backdrop-blur-sm flex items-center justify-center px-4">
          <div className="w-full max-w-2xl rounded-3xl border border-white/30 bg-white/90 shadow-2xl p-5 space-y-4">
            <div className="flex items-center gap-4">
              <div className="relative h-16 w-16 shrink-0 rounded-2xl border border-slate-200 bg-white flex items-center justify-center overflow-hidden">
                <img src="/logo.png" alt="Globe Life" className="h-12 w-12 object-contain animate-pulse" />
                <div className="absolute inset-0 bg-gradient-to-r from-blue-200/20 via-green-200/35 to-blue-200/20 animate-[pulse_2s_ease-in-out_infinite]" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">Processing resumes in background</p>
                <p className="text-xs text-slate-600 truncate">{uploadCurrentMessage}</p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between text-xs text-slate-600 mb-1">
                <span>Overall progress</span>
                <span>
                  {Object.values(uploadProgressByIndex).filter((p) => p.stage === 'completed' || p.stage === 'failed').length}
                  {' / '}
                  {uploadTotalCount}
                </span>
              </div>
              <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#005EB8] to-[#37B06D] transition-all duration-300"
                  style={{
                    width: `${uploadTotalCount
                      ? Math.round((Object.values(uploadProgressByIndex).filter((p) => p.stage === 'completed' || p.stage === 'failed').length / uploadTotalCount) * 100)
                      : 0}%`,
                  }}
                />
              </div>
            </div>

            <div className="max-h-56 overflow-auto space-y-2 pr-1">
              {Object.values(uploadProgressByIndex)
                .sort((a, b) => a.index - b.index)
                .map((p) => (
                  <div key={`${p.index}-${p.fileName}`} className="rounded-xl border border-slate-200 bg-white p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-slate-800 truncate">{p.fileName}</p>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                        p.stage === 'failed'
                          ? 'bg-red-100 text-red-700'
                          : p.stage === 'completed'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-blue-100 text-blue-700'
                      }`}
                      >
                        {uploadStageLabel(p.stage)}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          p.stage === 'failed' ? 'bg-red-400' : 'bg-[#005EB8]'
                        }`}
                        style={{ width: `${Math.max(0, Math.min(100, p.percent))}%` }}
                      />
                    </div>
                    <p className="mt-1 text-[10px] text-slate-500 truncate">
                      {p.error ? `${p.message} ${p.error}` : p.message}
                    </p>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
};

export default Pipeline;

import React, { useState, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import {
  getCandidates,
  getCandidatesForAdminList,
  getCandidateById,
  deleteCandidate,
  saveCandidate,
} from '../services/storageService';
import { getAssessmentSummary } from '../services/assessmentSummary';
import { sendEmail } from '../services/emailService';
import { EMAIL_TEMPLATES, mergeTemplate, type CrmEmailTemplateId } from '../services/emailTemplates';
import { appendEmailSignatureToHtml, getSiteOriginForEmail, CC_EMAIL_ALEX, SIGNATURE_LOGO_URL } from '../services/emailSignature';
import { getAssessmentLookupUrlForClient } from '../services/hiringUrls';
import { fetchNextUpcomingLiveSession } from '../services/liveSessionOccurrences';
import {
  OPEN_ENDED_QUESTIONS,
  PERSONALITY_QUESTIONS,
  PERSONALITY_LIKERT_OPTIONS,
  SCENARIO_QUESTIONS,
  EQ_QUESTIONS,
  EQ_LIKERT_OPTIONS,
} from '../services/assessmentConfig';
import { downloadCandidateReportPdf, getCandidateReportPdfBase64 } from '../services/pdfReport';
import {
  Candidate,
  QUESTIONS,
  DEFAULT_ADMIN_DATA,
  PIPELINE_STAGES,
  normalizePipelineStage,
  type PipelineStage,
  type AdminData,
} from '../types';
import { Search, Download, Eye, User, Mail, FileText, Star, Calendar, Tag, MessageSquare, ChevronDown, ChevronUp, Linkedin } from 'lucide-react';
import { Button } from '../components/UI';
import { supabase } from '../services/supabaseClient';
import {
  canAccessSection,
  defaultRouteForRole,
  getCurrentUserProfile,
  listAllUserProfiles,
  type AppRole,
  type UserProfile as StaffUserProfile,
} from '../services/accessControl';
import { formatDateCanadaEastern, formatDateTimeCanadaEastern } from '../services/dateDisplay';
import { hasResumeOrLinkedInMaterial } from '../services/linkedinUrl';
import { listSourceCandidateIdsInPipeline, sendCandidatesToPipelineFromAdmin } from '../services/pipelineService';
import { syncRecruiterCoinsAfterCandidateHired } from '../services/recruiterCoinService';
import { signInWithGoogle } from '../services/googleAuth';
import StaffLoginPage from '../components/StaffLoginPage';

const SUGGESTED_TAGS = ['Strong fit', 'Follow up', 'Licensing needed', 'High potential', 'Second interview', 'Offer extended'];

const getAdminData = (c: Candidate): AdminData => {
  const merged = { ...DEFAULT_ADMIN_DATA, ...c.adminData };
  return { ...merged, pipelineStage: normalizePipelineStage(merged.pipelineStage) };
};

function latestCandidateActivity(candidate: Candidate): { text: string; at?: string; by?: string; priority: 'normal' | 'urgent' } {
  const admin = getAdminData(candidate);
  const latestNote = [...admin.notes].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  if (latestNote) {
    return {
      text: latestNote.text,
      at: latestNote.createdAt,
      by: latestNote.authorEmail,
      priority: 'normal',
    };
  }

  const submittedAt = admin.emailsSent
    .filter((e) => e.type === 'automated_post_assessment_submit')
    .sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime())[0]?.sentAt;
  if (submittedAt && admin.pipelineStage === 'Leadership form submitted, awaiting evaluation') {
    const ageMs = Date.now() - new Date(submittedAt).getTime();
    const urgent = ageMs > 24 * 60 * 60 * 1000;
    return {
      text: urgent
        ? 'Leadership form submitted - pending review >24h'
        : 'Leadership form submitted - pending review',
      at: submittedAt,
      by: undefined,
      priority: urgent ? 'urgent' : 'normal',
    };
  }

  return { text: 'No recent update', priority: 'normal' };
}

/** Short labels for the horizontal journey timeline (full names in title/tooltip) */
const TIMELINE_SHORT_LABELS: Record<PipelineStage, string> = {
  'Checked In': 'Checked in',
  'Invited to Live Career Overview Session': 'Invited',
  'Live Career Overview Session Attended': 'Attended',
  'Leadership assessment form sent': 'Form sent',
  'Leadership form submitted, awaiting evaluation': 'Submitted',
  'Evaluation Done': 'Evaluation',
  'Interview scheduled': 'Interview',
  'Final decision': 'Final',
};

function formatEmailLogType(type: string | undefined): string {
  if (!type) return 'Custom / compose';
  const map: Record<string, string> = {
    stage2_post_checkin: 'Stage 2 – Post check-in',
    stage3_assessment_link: 'Leadership assessment (after session attended)',
    stage3_assessment_link_post_overview: 'Leadership assessment (post overview)',
    missed_live_session_reschedule: 'Missed live session – reschedule',
    stage5_evaluation: 'Evaluation done',
    compose: 'Compose (manual)',
    manual: 'Compose (manual)',
    automated_post_checkin: 'Automated – Post check-in (session invite)',
    automated_post_assessment_submit: 'Automated – Assessment submitted',
    automated_leadership_assessment_reminder_24h: 'Automated – Leadership reminder (24h after check-in)',
    automated_stage3_after_live_session: 'Automated – Leadership assessment form sent',
    automated_evaluation_done: 'Automated – Evaluation done',
    'crm_template:stage2_post_checkin': 'CRM – Post check-in',
    'crm_template:stage3_assessment_link': 'CRM – Leadership assessment (after session)',
    'crm_template:stage3_assessment_link_post_overview': 'CRM – Leadership assessment (post overview)',
    'crm_template:missed_live_session_reschedule': 'CRM – Missed session reschedule',
    'crm_template:stage5_evaluation': 'CRM – Evaluation',
  };
  return map[type] ?? type;
}

const CANDIDATES_PAGE_SIZE = 25;

const AdminDashboard: React.FC = () => {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [email, setEmail] = useState('admin@globelife-paz.com');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [sendingToPipeline, setSendingToPipeline] = useState(false);
  const [showAnswers, setShowAnswers] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [pipelineFilter, setPipelineFilter] = useState<PipelineStage | ''>('');
  const [newNote, setNewNote] = useState('');
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailModalMode, setEmailModalMode] = useState<CrmEmailTemplateId | 'compose' | null>(null);
  const [emailSubject, setEmailSubject] = useState('');
  const [copyToast, setCopyToast] = useState(false);
  const [emailBody, setEmailBody] = useState('');
  const [emailBodyIsHtml, setEmailBodyIsHtml] = useState(true);
  const [emailPreviewTab, setEmailPreviewTab] = useState<'preview' | 'edit'>('edit');
  const [emailSending, setEmailSending] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [savingAdmin, setSavingAdmin] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sourceIdsInPipeline, setSourceIdsInPipeline] = useState<Set<string>>(new Set());
  const [hideAlreadyInPipeline, setHideAlreadyInPipeline] = useState(false);
  const [candidateListPage, setCandidateListPage] = useState(1);
  const [bulkStage, setBulkStage] = useState<PipelineStage | ''>('');
  const [nextStepEdit, setNextStepEdit] = useState('');
  const [reportStaffEmail, setReportStaffEmail] = useState('');
  const [reportCcAlex, setReportCcAlex] = useState(false);
  const [reportEmailSending, setReportEmailSending] = useState(false);
  const [reportEmailError, setReportEmailError] = useState<string | null>(null);
  const [reportEmailSent, setReportEmailSent] = useState(false);
  const [emailLogOpen, setEmailLogOpen] = useState(false);
  const [evaluatorName, setEvaluatorName] = useState('');
  const [evaluationComments, setEvaluationComments] = useState('');
  const [evaluationSaving, setEvaluationSaving] = useState(false);
  const [detailTab, setDetailTab] = useState<'profile' | 'status' | 'assessment'>('profile');
  const [showEvaluationModal, setShowEvaluationModal] = useState(false);
  const [liveNow, setLiveNow] = useState(new Date());
  const [role, setRole] = useState<AppRole | null>(null);
  const [staffProfiles, setStaffProfiles] = useState<StaffUserProfile[]>([]);
  const [staffProfilesLoading, setStaffProfilesLoading] = useState(false);
  const [staffProfilesError, setStaffProfilesError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const adminView = useMemo<'overview' | 'candidates' | 'analytics' | 'settings'>(() => {
    const q = new URLSearchParams(location.search).get('view');
    if (q === 'overview' || q === 'candidates' || q === 'analytics' || q === 'settings') return q;
    return 'overview';
  }, [location.search]);

  const effectiveAdminView = useMemo<'overview' | 'candidates' | 'analytics' | 'settings'>(() => {
    if (canAccessSection(role, adminView)) return adminView;
    if (canAccessSection(role, 'candidates')) return 'candidates';
    return 'overview';
  }, [adminView, role]);

  useEffect(() => {
    if (selectedCandidate) setNextStepEdit(getAdminData(selectedCandidate).nextStep);
  }, [selectedCandidate?.id]);

  useEffect(() => {
    const ev = selectedCandidate ? getAdminData(selectedCandidate).evaluation : null;
    setEvaluatorName(ev?.evaluatorName || '');
    setEvaluationComments(ev?.comments || '');
  }, [selectedCandidate?.id]);

  useEffect(() => {
    setReportEmailError(null);
    setReportEmailSent(false);
  }, [selectedCandidate?.id]);

  useEffect(() => {
    setEmailLogOpen(false);
  }, [selectedCandidate?.id]);

  useEffect(() => {
    const id = window.setInterval(() => setLiveNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      const allVisibleSelected = filteredCandidates.length > 0 && filteredCandidates.every(c => next.has(c.id));
      if (allVisibleSelected) {
        filteredCandidates.forEach(c => next.delete(c.id));
      } else {
        filteredCandidates.forEach(c => next.add(c.id));
      }
      return next;
    });
  };

  const handleBulkStageChange = async () => {
    if (!bulkStage || selectedIds.size === 0) return;
    setSavingAdmin(true);
    const updates = new Map<string, Candidate>();
    try {
      for (const id of selectedIds) {
        const c = candidates.find(x => x.id === id);
        if (c) {
          const updated: Candidate = { ...c, adminData: { ...getAdminData(c), pipelineStage: bulkStage } };
          await saveCandidate(updated);
          updates.set(id, updated);
        }
      }
      setCandidates(prev => prev.map(x => updates.get(x.id) ?? x));
      setSelectedCandidate(prev => (prev && updates.has(prev.id) ? updates.get(prev.id)! : prev));
      setSelectedIds(new Set());
      setBulkStage('');
    } catch (err) {
      console.error(err);
      alert('Failed to update some candidates.');
    } finally {
      setSavingAdmin(false);
    }
  };

  const filteredCandidates = useMemo(() => {
    let list = candidates;
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        c =>
          c.firstName.toLowerCase().includes(q) ||
          c.lastName.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q) ||
          c.phone.includes(q)
      );
    }
    if (pipelineFilter) {
      list = list.filter(c => getAdminData(c).pipelineStage === pipelineFilter);
    }
    if (hideAlreadyInPipeline) {
      list = list.filter(c => !sourceIdsInPipeline.has(c.id));
    }
    return list;
  }, [candidates, searchQuery, pipelineFilter, hideAlreadyInPipeline, sourceIdsInPipeline]);

  const candidateListPageCount = Math.max(1, Math.ceil(filteredCandidates.length / CANDIDATES_PAGE_SIZE));

  const paginatedCandidates = useMemo(() => {
    const start = (candidateListPage - 1) * CANDIDATES_PAGE_SIZE;
    return filteredCandidates.slice(start, start + CANDIDATES_PAGE_SIZE);
  }, [filteredCandidates, candidateListPage]);

  useEffect(() => {
    setCandidateListPage(1);
  }, [searchQuery, pipelineFilter, hideAlreadyInPipeline]);

  useEffect(() => {
    if (candidateListPage > candidateListPageCount) {
      setCandidateListPage(candidateListPageCount);
    }
  }, [candidateListPage, candidateListPageCount]);

  const leadershipPendingQueue = useMemo(() => {
    const now = Date.now();
    return candidates
      .map((c) => {
        const admin = getAdminData(c);
        if (admin.pipelineStage !== 'Leadership form submitted, awaiting evaluation') return null;
        const submittedAt = admin.emailsSent
          .filter((e) => e.type === 'automated_post_assessment_submit')
          .sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime())[0]?.sentAt;
        if (!submittedAt) return null;
        const lastTouchAt = [
          ...admin.notes.map((n) => n.createdAt),
          admin.evaluation?.doneAt,
          admin.interviewScheduledAt,
          admin.resumeReviewedAt,
        ]
          .filter(Boolean)
          .map((v) => new Date(String(v)).getTime())
          .filter((v) => Number.isFinite(v))
          .sort((a, b) => b - a)[0];
        const submittedMs = new Date(submittedAt).getTime();
        const untouched = !lastTouchAt || lastTouchAt <= submittedMs;
        if (!untouched) return null;
        const ageHours = Math.floor((now - submittedMs) / (1000 * 60 * 60));
        return { candidate: c, submittedAt, ageHours, urgent: ageHours >= 24 };
      })
      .filter((x): x is { candidate: Candidate; submittedAt: string; ageHours: number; urgent: boolean } => Boolean(x))
      .sort((a, b) => Number(b.urgent) - Number(a.urgent) || b.ageHours - a.ageHours);
  }, [candidates]);

  useEffect(() => {
    // Check if an admin session already exists
    const checkSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setIsAuthenticated(true);
        const profile = await getCurrentUserProfile();
        setRole(profile?.role ?? null);
      }
    };
    checkSession();
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      const load = async () => {
        try {
          setLoading(true);
          setError(null);
          const [data, pipelineSourceIds] = await Promise.all([
            getCandidatesForAdminList(),
            listSourceCandidateIdsInPipeline(),
          ]);
          setCandidates(data);
          setSourceIdsInPipeline(pipelineSourceIds);
        } catch (err) {
          console.error(err);
          setError('Unable to load candidates. Please try again later.');
        } finally {
          setLoading(false);
        }
      };
      load();
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || effectiveAdminView !== 'settings') return;
    if (role !== 'admin' && role !== 'leadership') return;
    let cancelled = false;
    const loadUsers = async () => {
      setStaffProfilesLoading(true);
      setStaffProfilesError(null);
      try {
        const rows = await listAllUserProfiles();
        if (cancelled) return;
        setStaffProfiles(rows);
      } catch (err) {
        if (cancelled) return;
        setStaffProfilesError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setStaffProfilesLoading(false);
      }
    };
    void loadUsers();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, effectiveAdminView, role]);

  /** List rows are lean (no assessment JSON); load full row when opening detail. Stale fetch guard avoids wrong candidate after fast clicks. */
  const selectCandidate = (c: Candidate) => {
    const id = c.id;
    setSelectedCandidate(c);
    void getCandidateById(id).then((full) => {
      if (!full) return;
      setSelectedCandidate((prev) => (prev?.id === id ? full : prev));
    });
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        setAuthError('Invalid email or password.');
        return;
      }
      setIsAuthenticated(true);
      const profile = await getCurrentUserProfile();
      setRole(profile?.role ?? null);
      navigate(defaultRouteForRole(profile?.role ?? null), { replace: true });
    } catch (err) {
      console.error(err);
      setAuthError('Unable to log in. Please try again.');
    }
  };

  const handleGoogleLogin = async () => {
    setAuthError(null);
    setGoogleLoading(true);
    const { error } = await signInWithGoogle('/home');
    if (error) setAuthError(error);
    setGoogleLoading(false);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setIsAuthenticated(false);
    setRole(null);
    setCandidates([]);
    setSelectedCandidate(null);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'High Fit': return 'bg-green-100 text-green-800 border-green-200';
      case 'Review': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'Not Aligned': return 'bg-red-100 text-red-800 border-red-200';
      default: return 'bg-gray-100 text-gray-600';
    }
  };

  const badge = (text: string, className: string) => (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${className}`}>
      {text}
    </span>
  );

  const StatCard: React.FC<{
    label: string;
    value: React.ReactNode;
    hint?: string;
    accent?: 'blue' | 'green' | 'amber' | 'red' | 'slate';
  }> = ({ label, value, hint, accent = 'slate' }) => {
    const accentMap: Record<string, { ring: string; bg: string; text: string }> = {
      blue: { ring: 'ring-[#005EB8]/15', bg: 'from-[#005EB8]/10 to-[#005EB8]/0', text: 'text-[#005EB8]' },
      green: { ring: 'ring-[#37B06D]/15', bg: 'from-[#37B06D]/10 to-[#37B06D]/0', text: 'text-[#2d915a]' },
      amber: { ring: 'ring-amber-500/15', bg: 'from-amber-500/10 to-amber-500/0', text: 'text-amber-700' },
      red: { ring: 'ring-red-500/15', bg: 'from-red-500/10 to-red-500/0', text: 'text-red-700' },
      slate: { ring: 'ring-slate-500/10', bg: 'from-slate-500/10 to-slate-500/0', text: 'text-slate-700' },
    };
    const a = accentMap[accent];
    return (
      <div className={`rounded-2xl border border-gray-200 bg-white shadow-sm ring-1 ${a.ring} overflow-hidden`}>
        <div className={`p-4 bg-gradient-to-br ${a.bg}`}>
          <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500">{label}</p>
          <div className={`mt-1 text-3xl font-extrabold leading-none ${a.text}`}>{value}</div>
          {hint && <p className="mt-2 text-xs text-gray-500">{hint}</p>}
        </div>
      </div>
    );
  };

  const dashboard = useMemo(() => {
    const total = candidates.length;
    const highFit = candidates.filter(c => c.fitCategory === 'High Fit').length;
    const review = candidates.filter(c => c.fitCategory === 'Review').length;
    const notAligned = candidates.filter(c => c.fitCategory === 'Not Aligned').length;
    const assessmentComplete = candidates.filter(c => c.status === 'assessment_complete' || !!c.assessment).length;
    const resumesUploaded = candidates.filter(c =>
      hasResumeOrLinkedInMaterial(c.applicantQuestionnaire?.resumeUrls, c.applicantQuestionnaire?.linkedinProfileUrl),
    ).length;
    const resumesPendingReview = candidates.filter(
      c =>
        hasResumeOrLinkedInMaterial(c.applicantQuestionnaire?.resumeUrls, c.applicantQuestionnaire?.linkedinProfileUrl) &&
        !getAdminData(c).resumeReviewedAt,
    ).length;

    const stageCounts: Record<string, number> = {};
    PIPELINE_STAGES.forEach(s => (stageCounts[s] = 0));
    candidates.forEach(c => {
      const s = getAdminData(c).pipelineStage;
      stageCounts[s] = (stageCounts[s] || 0) + 1;
    });

    const activePipeline =
      total -
      (stageCounts['Final decision'] || 0);

    return {
      total,
      highFit,
      review,
      notAligned,
      assessmentComplete,
      resumesUploaded,
      resumesPendingReview,
      stageCounts,
      activePipeline,
    };
  }, [candidates]);

  const getLikertLabel = (score: number | undefined) => {
    if (score === 3) return 'Strongly Agree';
    if (score === 2) return 'Agree';
    if (score === 1) return 'Disagree';
    if (score === 0) return 'Strongly Disagree';
    return '';
  };

  const getTrueScaleLabel = (score: number | undefined) => {
    if (score === 3) return 'Always True';
    if (score === 2) return 'Quite True';
    if (score === 1) return 'Rarely True';
    if (score === 0) return 'Never True';
    return '';
  };

  const buildAssessmentTextForAI = (): string => {
    if (!selectedCandidate?.assessment) return '';
    const a = selectedCandidate.assessment as any;

    const lines: string[] = ['Candidate assessment – Q&A', ''];
    // Core drivers
    lines.push('Core drivers:');
    lines.push(
      `Q1. On a scale of 1–10, how competitive are you?\nAnswer: ${a.competitiveness}/10`,
      '',
    );
    lines.push(
      `Q2. On a scale of 1–10, how motivated are you by income growth?\nAnswer: ${a.moneyMotivation}/10`,
      '',
    );

    if (a.personalityAnswers || a.scenarioAnswers || a.eqAnswers || a.openEndedAnswers) {
      // Open-ended
      if (a.openEndedAnswers) {
        lines.push('Open-ended questions:');
        OPEN_ENDED_QUESTIONS.forEach((q: any) => {
          lines.push(`Q${q.id}. ${q.question}`);
          lines.push(`Answer: ${a.openEndedAnswers[q.id] || '—'}`, '');
        });
      }

      // Personality Profile
      if (a.personalityAnswers) {
        lines.push('Personality Profile (Likert – Strongly Agree to Strongly Disagree):');
        PERSONALITY_QUESTIONS.forEach((q: any) => {
          const key = a.personalityAnswers[q.id] as keyof typeof PERSONALITY_LIKERT_OPTIONS | undefined;
          const label = key ? PERSONALITY_LIKERT_OPTIONS[key].label : '—';
          lines.push(`Q${q.id}. ${q.question}`);
          lines.push(`Answer: ${label} (${key ?? '-'})`, '');
        });
      }

      // Scenario & preference
      if (a.scenarioAnswers) {
        lines.push('Scenario & Preference Questions:');
        SCENARIO_QUESTIONS.forEach((q: any) => {
          const key = a.scenarioAnswers[q.id] as string | undefined;
          const label = key ? q.options[key] : undefined;
          lines.push(`Q${q.id}. ${q.question}`);
          lines.push(`Answer: ${label ? `${label} (${key})` : '—'}`, '');
        });
      }

      // EQ test
      if (a.eqAnswers) {
        lines.push('Entrepreneurial Quotient (EQ) Test:');
        EQ_QUESTIONS.forEach((q: any) => {
          const key = a.eqAnswers[q.id] as keyof typeof EQ_LIKERT_OPTIONS | undefined;
          const label = key ? EQ_LIKERT_OPTIONS[key].label : '—';
          lines.push(`Q${q.id}. ${q.question}`);
          lines.push(`Answer: ${label} (${key ?? '-'})`, '');
        });
      }
    } else {
      // Legacy 30-question format
      lines.push('');
      QUESTIONS.likert.forEach(q => {
        lines.push(`Q${q.id}. ${q.text}`);
        lines.push(`Answer: ${getLikertLabel(a.likertResponses?.[q.id]) || '—'}`, '');
      });
      QUESTIONS.trueScale.forEach(q => {
        lines.push(`Q${q.id}. ${q.text}`);
        lines.push(`Answer: ${getTrueScaleLabel(a.trueScaleResponses?.[q.id]) || '—'}`, '');
      });
    }

    lines.push('---', '');
    lines.push(
      'Analyze the above assessment answers and provide a concise psychological summary of this candidate for a sales/leadership role. Include: competitive drive, leadership potential, entrepreneurial fit, comfort with performance-based pay, scenario-based decision style, and any concerns.',
    );
    return lines.join('\n');
  };

  const AI_PROMPT_SHORT = 'Analyze the candidate assessment (paste below) and give a psychological summary for a sales/leadership role.';
  const CHATGPT_BASE = 'https://chat.openai.com/';
  const GEMINI_BASE = 'https://gemini.google.com/app';
  const MAX_URL_LENGTH = 7500;

  const handleCopyAndOpenAI = async (baseUrl: string, urlParam: 'q' | 'prompt') => {
    const fullText = buildAssessmentTextForAI();
    if (!fullText) return;
    try {
      await navigator.clipboard.writeText(fullText);
      setCopyToast(true);
      setTimeout(() => setCopyToast(false), 2500);
      const encoded = encodeURIComponent(fullText);
      const url = `${baseUrl}?${urlParam}=${encoded}`;
      if (url.length > MAX_URL_LENGTH) {
        window.open(`${baseUrl}?${urlParam}=${encodeURIComponent(AI_PROMPT_SHORT)}`, '_blank', 'noopener,noreferrer');
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      console.error(err);
      alert('Could not copy to clipboard. You can still open the link and paste manually.');
      window.open(baseUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const escapeCsv = (v: string | number | undefined): string => {
    if (v === undefined || v === null) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const exportCSV = async () => {
    let fullRows: Candidate[];
    try {
      fullRows = await getCandidates();
    } catch (err) {
      console.error(err);
      alert('Could not load candidates for export. Please try again.');
      return;
    }

    const headers = [
      'ID',
      'Name',
      'Email',
      'Phone',
      'City',
      'PipelineStage',
      'Rating',
      'DisqualifiedAtQuestionnaire',
      'DisqualifiedReason',
      'InterviewScheduledAt',
      'NextStep',
      'Tags',
      'NotesCount',
      'ResumeReviewedAt',
      'Occupation',
      'CurrentRole',
      'BackgroundAreas',
      'SalesExperience',
      'SomethingAboutYourself',
      'LegallyEntitledCanada',
      'WhatStoodOut',
      'WhyGoodFit',
      'FinancialInvestmentLicense',
      'LegallyEntitledCanadaFullTime',
      'ComfortableVirtual',
      'ExcitedOffSiteSocial',
      'PositionInterest',
      'QuestionsAboutOpportunity',
      'ContactPermission',
      'ResumeUrls',
      'LinkedinProfileUrl',
      'Score',
      'Fit',
      'Interviewed',
      'CEO Invite',
      'Q1_Competitiveness',
      'Q2_MoneyMotivation',
      ...QUESTIONS.likert.map(q => `Q${q.id}`),
      ...QUESTIONS.trueScale.map(q => `Q${q.id}`),
    ];

    const rows = fullRows.map(c => {
      const a = c.assessment;
      const q = c.applicantQuestionnaire;
      const ad = getAdminData(c);
      const base = [
        c.id,
        `${c.firstName} ${c.lastName}`,
        c.email,
        c.phone,
        c.city,
        ad.pipelineStage,
        ad.rating ?? '',
        ad.questionnaireDisqualified ? 'Yes' : '',
        ad.questionnaireDisqualified ? escapeCsv(ad.questionnaireDisqualified.reason) : '',
        ad.interviewScheduledAt ?? '',
        escapeCsv(ad.nextStep),
        ad.tags.join('; '),
        ad.notes.length,
        ad.resumeReviewedAt ?? '',
        q ? escapeCsv((q as any).occupation) : '',
        q ? escapeCsv((q as any).currentRole) : '',
        q && (q as any).backgroundAreas ? (q as any).backgroundAreas.join('; ') : '',
        q ? escapeCsv((q as any).salesExperience) : '',
        q ? escapeCsv((q as any).somethingAboutYourself) : '',
        q ? (q as any).legallyEntitledCanada ?? (q as any).legallyEntitledCanadaFullTime ?? '' : '',
        q ? escapeCsv((q as any).whatStoodOut) : '',
        q ? escapeCsv((q as any).whyGoodFit) : '',
        q ? (q as any).financialInvestmentLicense : '',
        q ? (q as any).legallyEntitledCanadaFullTime : '',
        q ? (q as any).comfortableVirtualEnvironment : '',
        q ? (q as any).excitedOffSiteSocial : '',
        q ? (q as any).positionInterest : '',
        q ? escapeCsv((q as any).questionsAboutOpportunity) : '',
        q ? (q as any).contactPermission : '',
        q?.resumeUrls?.length ? q.resumeUrls.join('; ') : '',
        q?.linkedinProfileUrl ? escapeCsv(q.linkedinProfileUrl) : '',
        c.score ?? '',
        c.fitCategory || 'N/A',
        c.postInterview?.interviewCompleted ? 'Yes' : 'No',
        c.postInterview?.ceoInvite || 'N/A',
        a ? a.competitiveness : '',
        a ? a.moneyMotivation : '',
      ];

      const likertAnswers = QUESTIONS.likert.map(q =>
        a?.likertResponses ? getLikertLabel(a.likertResponses?.[q.id]) || '' : ''
      );

      const trueScaleAnswers = QUESTIONS.trueScale.map(q =>
        a?.trueScaleResponses ? getTrueScaleLabel(a.trueScaleResponses?.[q.id]) || '' : ''
      );

      return [...base, ...likertAnswers, ...trueScaleAnswers];
    });
    
    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers.map(escapeCsv).join(","), ...rows.map(row => row.map(cell => escapeCsv(cell)).join(","))].join("\n");
      
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "candidates.csv");
    document.body.appendChild(link);
    link.click();
  };

  const handleDeleteSelected = async () => {
    if (!selectedCandidate) return;
    const confirmed = window.confirm(
      `Delete candidate ${selectedCandidate.firstName} ${selectedCandidate.lastName} (ID: ${selectedCandidate.id})? This cannot be undone.`
    );
    if (!confirmed) return;

    try {
      setDeleting(true);
      await deleteCandidate(selectedCandidate.id);
      setCandidates(prev => prev.filter(c => c.id !== selectedCandidate.id));
      setSelectedCandidate(null);
    } catch (err) {
      console.error(err);
      alert('Unable to delete candidate. Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  const handleBulkDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    const confirmed = window.confirm(
      `Delete ${selectedIds.size} selected candidate(s)? This cannot be undone.`
    );
    if (!confirmed) return;

    try {
      setDeleting(true);
      const ids = Array.from(selectedIds);
      for (const id of ids) {
        await deleteCandidate(id);
      }
      setCandidates(prev => prev.filter(c => !selectedIds.has(c.id)));
      setSelectedCandidate(prev => (prev && selectedIds.has(prev.id) ? null : prev));
      setSelectedIds(new Set());
    } catch (err) {
      console.error(err);
      alert('Unable to delete all selected candidates. Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  const handleBulkSendToPipeline = async () => {
    if (selectedIds.size === 0) return;
    setSendingToPipeline(true);
    try {
      const ids = Array.from(selectedIds);
      const result = await sendCandidatesToPipelineFromAdmin(ids);
      const skippedNoResume = Math.max(0, result.selected - result.withResumes);
      const alreadyOrNoNew =
        result.withResumes > 0 && result.importedCandidates === 0 && result.importedResumes === 0
          ? '\nSelected candidates were already in Pipeline or had no new resume URLs to import.'
          : '';
      alert(
        `Pipeline send result:\n` +
        `Selected: ${result.selected}\n` +
        `With resume URLs: ${result.withResumes}\n` +
        `New pipeline candidates: ${result.importedCandidates}\n` +
        `New resumes imported: ${result.importedResumes}` +
        (skippedNoResume > 0 ? `\nSkipped (no resume URL): ${skippedNoResume}` : '') +
        alreadyOrNoNew,
      );
      const latest = await listSourceCandidateIdsInPipeline();
      setSourceIdsInPipeline(latest);
      setSelectedIds(new Set());
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setSendingToPipeline(false);
    }
  };

  const handleDownloadCandidateReport = async (candidate: Candidate) => {
    try {
      const full = await getCandidateById(candidate.id);
      downloadCandidateReportPdf(full ?? candidate);
    } catch (err) {
      console.error(err);
      // Fall back to list payload if full row fetch fails.
      downloadCandidateReportPdf(candidate);
    }
  };

  const updateAdminData = async (updater: (prev: AdminData) => AdminData) => {
    if (!selectedCandidate) return;
    const next = updater(getAdminData(selectedCandidate));
    const updated: Candidate = { ...selectedCandidate, adminData: next };
    try {
      setSavingAdmin(true);
      await saveCandidate(updated);
      setCandidates(prev => prev.map(c => (c.id === updated.id ? updated : c)));
      setSelectedCandidate(updated);
    } catch (err) {
      console.error(err);
      alert('Failed to save. Please try again.');
    } finally {
      setSavingAdmin(false);
    }
  };

  const handleAddNote = async () => {
    if (!newNote.trim() || !selectedCandidate) return;
    const { data: { user } } = await supabase.auth.getUser();
    const actorLabel = String(
      user?.user_metadata?.full_name ||
      user?.user_metadata?.name ||
      user?.email ||
      ''
    ).trim() || undefined;
    await updateAdminData(prev => ({
      ...prev,
      notes: [
        ...prev.notes,
        { id: crypto.randomUUID(), createdAt: new Date().toISOString(), text: newNote.trim(), authorEmail: actorLabel },
      ],
    }));
    setNewNote('');
  };

  const handlePipelineStageChange = (stage: PipelineStage) => {
    updateAdminData(prev => ({ ...prev, pipelineStage: stage }));
  };

  const handleFinalDecisionChange = async (decision: 'Hired' | 'Not Hired') => {
    if (!selectedCandidate) return;
    const candidateId = selectedCandidate.id;
    await updateAdminData(prev => ({
      ...prev,
      pipelineStage: 'Final decision',
      finalDecision: decision,
    }));
    if (decision === 'Hired') {
      void syncRecruiterCoinsAfterCandidateHired(candidateId);
    }
  };

  const handleRatingChange = (rating: number) => {
    updateAdminData(prev => ({ ...prev, rating: prev.rating === rating ? null : rating }));
  };

  const handleInterviewDateChange = (value: string) => {
    updateAdminData(prev => ({ ...prev, interviewScheduledAt: value || null }));
  };

  const handleNextStepChange = (value: string) => {
    updateAdminData(prev => ({ ...prev, nextStep: value }));
  };

  const handleAddTag = (tag: string) => {
    const t = tag.trim();
    if (!t) return;
    updateAdminData(prev => ({ ...prev, tags: prev.tags.includes(t) ? prev.tags : [...prev.tags, t] }));
    setNewTag('');
  };

  const handleRemoveTag = (tag: string) => {
    updateAdminData(prev => ({ ...prev, tags: prev.tags.filter(t => t !== tag) }));
  };

  const handleMarkResumeReviewed = () => {
    updateAdminData(prev => ({ ...prev, resumeReviewedAt: new Date().toISOString() }));
  };

  const openEmailModal = async (mode: CrmEmailTemplateId | 'compose') => {
    setEmailModalMode(mode);
    setEmailError(null);
    setEmailPreviewTab('edit');
    if (mode === 'compose') {
      setEmailSubject('');
      setEmailBody('');
      setEmailBodyIsHtml(false);
    } else if (selectedCandidate) {
      const template = EMAIL_TEMPLATES.find((t) => t.id === mode);
      if (template) {
        const origin = getSiteOriginForEmail();
        const extras =
          mode === 'stage3_assessment_link' || mode === 'stage3_assessment_link_post_overview'
            ? { '{{assessmentLookupUrl}}': getAssessmentLookupUrlForClient() }
            : undefined;
        const liveSessionOccurrence =
          mode === 'stage2_post_checkin' ? await fetchNextUpcomingLiveSession() : null;
        const { subject, bodyHtml } = mergeTemplate(template.subject, template.bodyHtml, selectedCandidate, extras, {
          siteOrigin: origin,
          liveSessionOccurrence,
        });
        setEmailSubject(subject);
        setEmailBody(bodyHtml);
        setEmailBodyIsHtml(true);
      }
    }
    setShowEmailModal(true);
  };

  const handleEmailCandidateReportPdf = async () => {
    if (!selectedCandidate) return;
    const to = reportStaffEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      setReportEmailError('Enter a valid staff email address.');
      setReportEmailSent(false);
      return;
    }
    setReportEmailError(null);
    setReportEmailSent(false);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setReportEmailError('Your session expired. Please sign in again.');
      return;
    }
    setReportEmailSending(true);
    try {
      const { base64, filename } = getCandidateReportPdfBase64(selectedCandidate);
      const name = `${selectedCandidate.firstName} ${selectedCandidate.lastName}`.trim();
      const subject = `Candidate report: ${name || 'Candidate'}`;
      const origin = getSiteOriginForEmail();
      const bodyCore = `<p>Attached is the candidate PDF report for <strong>${name || 'candidate'}</strong>.</p><p>Candidate email: <a href="mailto:${selectedCandidate.email}">${selectedCandidate.email}</a><br/>Phone: ${selectedCandidate.phone || 'N/A'}</p>`;
      const bodyHtml = appendEmailSignatureToHtml(bodyCore, origin);

      const result = await sendEmail(session.access_token, {
        to,
        cc: reportCcAlex ? CC_EMAIL_ALEX : undefined,
        subject,
        bodyHtml,
        attachments: [{ filename, contentBase64: base64, contentType: 'application/pdf' }],
        trigger: 'candidate_report_pdf_staff',
        candidateId: selectedCandidate.id,
      });
      if ('ok' in result && result.ok) {
        setReportEmailSent(true);
        setReportEmailError(null);
      } else {
        setReportEmailError(('error' in result ? result.error : '') || 'Failed to send email');
        setReportEmailSent(false);
      }
    } catch (e) {
      setReportEmailError(e instanceof Error ? e.message : 'Failed to send email');
      setReportEmailSent(false);
    } finally {
      setReportEmailSending(false);
    }
  };

  const handleSendEmail = async () => {
    if (!selectedCandidate || !emailSubject.trim()) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setEmailError('Your session expired. Please sign in again.');
      return;
    }
    setEmailSending(true);
    setEmailError(null);
    const to = selectedCandidate.email;
    const subject = emailSubject.trim();
    const origin = getSiteOriginForEmail();
    const rawHtml = emailBody.trim();
    // mergeTemplate() already replaced {{emailSignature}} — do not append again.
    const bodyHtml = emailBodyIsHtml
      ? (rawHtml
          ? rawHtml.includes(SIGNATURE_LOGO_URL)
            ? rawHtml
            : appendEmailSignatureToHtml(rawHtml, origin)
          : undefined)
      : undefined;
    const bodyText = !emailBodyIsHtml ? emailBody.trim() || undefined : undefined;
    const trigger =
      emailModalMode && emailModalMode !== 'compose'
        ? `crm_template:${emailModalMode}`
        : 'crm_compose_manual';
    const result = await sendEmail(session.access_token, {
      to,
      subject,
      bodyHtml,
      bodyText,
      trigger,
      candidateId: selectedCandidate.id,
      attachLiveSessionCalendar: emailModalMode === 'stage2_post_checkin',
    });
    setEmailSending(false);
    if ('ok' in result && result.ok) {
      const sentAt = new Date().toISOString();
      await updateAdminData(prev => ({
        ...prev,
        emailsSent: [...prev.emailsSent, { sentAt, subject, type: emailModalMode || 'manual' }],
      }));
      setShowEmailModal(false);
      setEmailModalMode(null);
      setEmailSubject('');
      setEmailBody('');
    } else {
      setEmailError(('error' in result ? result.error : '') || 'Failed to send email');
    }
  };

  const handleCompleteEvaluation = async () => {
    if (!selectedCandidate || evaluationSaving) return;
    const name = evaluatorName.trim();
    if (!name) {
      alert('Please enter evaluator name.');
      return;
    }
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      alert('Session expired. Please sign in again.');
      return;
    }

    setEvaluationSaving(true);
    try {
      const template = EMAIL_TEMPLATES.find((t) => t.id === 'stage5_evaluation');
      if (!template) throw new Error('Evaluation email template missing');
      const nowIso = new Date().toISOString();
      const { subject, bodyHtml } = mergeTemplate(
        template.subject,
        template.bodyHtml,
        selectedCandidate,
        undefined,
        { siteOrigin: getSiteOriginForEmail() }
      );
      const send = await sendEmail(session.access_token, {
        to: selectedCandidate.email,
        subject,
        bodyHtml,
        trigger: 'crm_template:stage5_evaluation',
        candidateId: selectedCandidate.id,
      });
      if (!('ok' in send && send.ok)) {
        throw new Error(('error' in send ? send.error : '') || 'Failed to send evaluation email');
      }

      await updateAdminData((prev) => ({
        ...prev,
        pipelineStage: 'Evaluation Done',
        evaluation: (() => {
          const entry = {
            doneAt: nowIso,
            evaluatorName: name,
            comments: evaluationComments.trim(),
            evaluationEmailSentAt: nowIso,
            editedAt: nowIso,
          };
          const priorHistory = prev.evaluation?.history ?? [];
          const previousEntry = prev.evaluation
            ? [{
                doneAt: prev.evaluation.doneAt,
                evaluatorName: prev.evaluation.evaluatorName,
                comments: prev.evaluation.comments,
                evaluationEmailSentAt: prev.evaluation.evaluationEmailSentAt,
                editedAt: nowIso,
              }]
            : [];
          return {
            doneAt: nowIso,
            evaluatorName: name,
            comments: evaluationComments.trim(),
            evaluationEmailSentAt: nowIso,
            history: [...priorHistory, ...previousEntry, entry],
          };
        })(),
        emailsSent: [
          ...prev.emailsSent,
          { sentAt: nowIso, subject, type: 'automated_evaluation_done' },
        ],
      }));
      setShowEvaluationModal(false);
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : 'Failed to complete evaluation.');
    } finally {
      setEvaluationSaving(false);
    }
  };

  const canRunEvaluation =
    selectedCandidate != null &&
    PIPELINE_STAGES.indexOf(getAdminData(selectedCandidate).pipelineStage) >=
      PIPELINE_STAGES.indexOf('Leadership form submitted, awaiting evaluation');

  const stageDistribution = useMemo(() => {
    const max = Math.max(1, ...PIPELINE_STAGES.map((s) => dashboard.stageCounts[s] ?? 0));
    return PIPELINE_STAGES.map((s) => ({
      stage: s,
      count: dashboard.stageCounts[s] ?? 0,
      width: `${Math.max(6, Math.round(((dashboard.stageCounts[s] ?? 0) / max) * 100))}%`,
    }));
  }, [dashboard.stageCounts]);

  const monthGrid = useMemo(() => {
    const now = liveNow;
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const start = new Date(first);
    start.setDate(first.getDate() - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return {
        key: d.toISOString(),
        date: d.getDate(),
        isCurrentMonth: d.getMonth() === now.getMonth(),
        isToday:
          d.getFullYear() === now.getFullYear() &&
          d.getMonth() === now.getMonth() &&
          d.getDate() === now.getDate(),
      };
    });
  }, [liveNow]);

  if (!isAuthenticated) {
    return (
      <StaffLoginPage
        title="Admin access"
        subtitle="Sign in to manage candidates, sessions, and team analytics."
        footerNote="Use your Globe Life Paz staff credentials."
        email={email}
        onEmailChange={setEmail}
        password={password}
        onPasswordChange={setPassword}
        authError={authError}
        googleLoading={googleLoading}
        submitLabel="Sign in"
        onSubmit={(e) => void handleLogin(e)}
        onGoogleSignIn={() => void handleGoogleLogin()}
      />
    );
  }

  return (
    <Layout isAdmin>
      <div
        className={`w-full p-5 lg:p-6 flex flex-col flex-1 min-h-0 ${
          effectiveAdminView === 'candidates' && !selectedCandidate ? 'gap-4' : 'space-y-5'
        }`}
      >
        {!(effectiveAdminView === 'candidates' && selectedCandidate) && (
        <div className="rounded-2xl border border-[#d6deea] bg-white shadow-sm px-5 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-[#0b1f3a]">
              {effectiveAdminView === 'overview' ? 'Overview' : effectiveAdminView === 'candidates' ? 'Candidates' : effectiveAdminView === 'analytics' ? 'Analytics' : 'Settings'}
            </h1>
            <p className="text-xs text-gray-500">
              {dashboard.total} applicants · {dashboard.activePipeline} active
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500">Live date & time</p>
            <p className="text-sm font-semibold text-gray-900">
              {liveNow.toLocaleString('en-CA', { timeZone: 'America/Toronto', dateStyle: 'medium', timeStyle: 'medium' })}
            </p>
          </div>
        </div>
        )}

        {effectiveAdminView === 'overview' && (
          <div className="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] gap-5">
            <div className="rounded-2xl border border-[#d6deea] bg-white shadow-sm p-4">
              <p className="text-sm font-semibold text-[#0b1f3a] mb-3">
                {liveNow.toLocaleString('en-CA', { month: 'long', year: 'numeric', timeZone: 'America/Toronto' })}
              </p>
              <div className="grid grid-cols-7 gap-1 text-[11px] text-center text-gray-500 mb-2">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d}>{d}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {monthGrid.map((d) => (
                  <div
                    key={d.key}
                    className={`h-9 rounded-md border text-xs flex items-center justify-center ${
                      d.isToday
                        ? 'bg-[#0b1f3a] text-white border-[#0b1f3a]'
                        : d.isCurrentMonth
                          ? 'bg-white border-gray-200 text-gray-700'
                          : 'bg-gray-50 border-gray-100 text-gray-400'
                    }`}
                  >
                    {d.date}
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-5">
              <div className="rounded-2xl border border-[#d6deea] bg-white shadow-sm p-5">
                <p className="text-sm font-semibold text-[#0b1f3a] mb-3">Pipeline Velocity</p>
                <div className="space-y-2">
                  {stageDistribution.map((row) => (
                    <div key={row.stage} className="flex items-center gap-2 text-xs">
                      <span className="w-28 truncate text-gray-600">{TIMELINE_SHORT_LABELS[row.stage]}</span>
                      <div className="h-2 flex-1 rounded-full bg-gray-100 overflow-hidden">
                        <div className="h-full bg-[#005EB8]" style={{ width: row.width }} />
                      </div>
                      <span className="w-6 text-right text-gray-800">{row.count}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="rounded-2xl border border-[#d6deea] bg-white shadow-sm p-5">
                  <p className="text-sm font-semibold text-[#0b1f3a] mb-3">Candidate Status Breakdown</p>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between rounded-lg bg-green-50 border border-green-100 px-3 py-2"><span>High fit</span><span className="font-semibold text-green-700">{dashboard.highFit}</span></div>
                    <div className="flex items-center justify-between rounded-lg bg-amber-50 border border-amber-100 px-3 py-2"><span>Review</span><span className="font-semibold text-amber-700">{dashboard.review}</span></div>
                    <div className="flex items-center justify-between rounded-lg bg-red-50 border border-red-100 px-3 py-2"><span>Not aligned</span><span className="font-semibold text-red-700">{dashboard.notAligned}</span></div>
                  </div>
                </div>
                <div className="rounded-2xl border border-[#d6deea] bg-white shadow-sm p-5">
                  <p className="text-sm font-semibold text-[#0b1f3a] mb-3">Operational Queue</p>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span>High fit</span><span className="font-semibold">{dashboard.highFit}</span></div>
                    <div className="flex justify-between"><span>Review</span><span className="font-semibold">{dashboard.review}</span></div>
                    <div className="flex justify-between"><span>Not aligned</span><span className="font-semibold">{dashboard.notAligned}</span></div>
                    <div className="flex justify-between"><span>Resume / LinkedIn pending review</span><span className="font-semibold">{dashboard.resumesPendingReview}</span></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {effectiveAdminView === 'analytics' && (
          <div className="rounded-2xl border border-[#d6deea] bg-white shadow-sm p-5 space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button onClick={exportCSV} variant="outline" className="text-sm">
                <Download size={16} className="mr-2" />
                Export all candidates CSV
              </Button>
            </div>
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="grid grid-cols-[1.5fr,1fr,1fr] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500 bg-[#f8fbff] border-b border-gray-200">
                <span>Candidate</span>
                <span>Current stage</span>
                <span>Reports</span>
              </div>
              {candidates.map((c) => (
                <div key={c.id} className="grid grid-cols-[1.5fr,1fr,1fr] px-4 py-3 text-sm border-b border-gray-100 items-center">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 truncate">{c.firstName} {c.lastName}</p>
                    <p className="text-xs text-gray-500 truncate">{c.email}</p>
                  </div>
                  <span className="text-xs text-gray-700">{getAdminData(c).pipelineStage}</span>
                  <button
                    type="button"
                    className="w-fit text-xs px-2.5 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50"
                    onClick={() => void handleDownloadCandidateReport(c)}
                  >
                    Download PDF
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {effectiveAdminView === 'settings' && (
          <div className="rounded-2xl border border-[#d6deea] bg-white shadow-sm p-6 space-y-4">
            <div>
              <p className="text-sm font-semibold text-[#0b1f3a]">Staff directory</p>
              <p className="text-xs text-gray-600 mt-1">
                Leadership/admin visibility across all user accounts for role and points readiness.
              </p>
            </div>
            {(role === 'admin' || role === 'leadership') ? (
              <>
                {staffProfilesError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {staffProfilesError}
                  </div>
                )}
                <div className="rounded-xl border border-gray-200 overflow-hidden">
                  <div className="grid grid-cols-[1.3fr_1fr_0.8fr_0.6fr] px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500 bg-[#f8fbff] border-b border-gray-200">
                    <span>User</span>
                    <span>Email</span>
                    <span>Role</span>
                    <span className="text-right">Points</span>
                  </div>
                  {staffProfilesLoading ? (
                    <div className="px-4 py-4 text-xs text-gray-500">Loading users…</div>
                  ) : staffProfiles.length === 0 ? (
                    <div className="px-4 py-4 text-xs text-gray-500">No user profiles found.</div>
                  ) : (
                    staffProfiles.map((row) => (
                      <div key={row.user_id} className="grid grid-cols-[1.3fr_1fr_0.8fr_0.6fr] px-4 py-2.5 text-sm border-b border-gray-100 items-center">
                        <span className="font-medium text-gray-900 truncate">{row.full_name || '—'}</span>
                        <span className="text-gray-600 truncate">{row.email || '—'}</span>
                        <span className="text-xs inline-flex w-fit rounded-full bg-blue-50 border border-blue-200 text-blue-700 px-2 py-0.5">
                          {row.role}
                        </span>
                        <span className="text-right text-gray-700 tabular-nums">{Number(row.points || 0)}</span>
                      </div>
                    ))
                  )}
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
                User management is available to leadership/admin accounts.
              </div>
            )}
          </div>
        )}

        {effectiveAdminView === 'candidates' && (
        <>
        {!selectedCandidate && leadershipPendingQueue.length > 0 && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 shadow-sm p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-amber-900">Leadership assessments pending action</p>
                <p className="text-xs text-amber-800 mt-1">
                  Prioritized list of submissions not touched yet. Items older than 24h are marked urgent.
                </p>
              </div>
              <span className="text-xs font-semibold px-2 py-1 rounded-full bg-amber-200 text-amber-900">
                {leadershipPendingQueue.length} pending
              </span>
            </div>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
              {leadershipPendingQueue.slice(0, 8).map((row) => (
                <button
                  key={row.candidate.id}
                  type="button"
                  onClick={() => selectCandidate(row.candidate)}
                  className={`text-left rounded-lg border px-3 py-2 ${
                    row.urgent ? 'border-red-300 bg-red-50' : 'border-amber-200 bg-white'
                  }`}
                >
                  <p className="text-sm font-semibold text-gray-900">{row.candidate.firstName} {row.candidate.lastName}</p>
                  <p className="text-xs text-gray-600 mt-1">
                    Submitted {formatDateTimeCanadaEastern(row.submittedAt)} ({row.ageHours}h ago)
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}
        {!selectedCandidate && (
        <div className="shrink-0 rounded-2xl border border-[#d6deea] bg-white shadow-sm">
          <div className="px-5 py-3 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2 text-xs bg-[#f9fbff]">
            {PIPELINE_STAGES.map((s) => (
              <button
                type="button"
                key={s}
                onClick={() => setPipelineFilter(s)}
                className={`text-left rounded-xl border px-3 py-2 transition ${
                  pipelineFilter === s ? 'border-[#005EB8] bg-blue-50 text-[#005EB8]' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                <div className="font-semibold truncate">{TIMELINE_SHORT_LABELS[s]}</div>
                <div className="text-[11px] mt-0.5">{dashboard.stageCounts[s] ?? 0}</div>
              </button>
            ))}
          </div>
        </div>
        )}

        {error && (
          <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">
            {error}
          </div>
        )}

        <div className={`grid grid-cols-1 gap-5 ${selectedCandidate ? '' : 'flex flex-col flex-1 min-h-0'}`}>
          {/* Candidate List */}
          <div
            className={`${
              selectedCandidate ? 'hidden' : 'flex'
            } bg-white rounded-2xl shadow-sm border border-[#d6deea] overflow-hidden flex-1 min-h-[min(720px,calc(100dvh-14rem))] flex-col`}
          >
            <div className="p-4 border-b border-gray-100 bg-white space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
                <input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search by name, email, phone..."
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#005EB8]/30 focus:border-[#005EB8]/40 bg-white"
                />
              </div>
              <select
                value={pipelineFilter}
                onChange={e => setPipelineFilter((e.target.value || '') as PipelineStage | '')}
                className="w-full px-3 py-2.5 rounded-xl border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#005EB8]/30 focus:border-[#005EB8]/40 bg-white"
              >
                <option value="">All stages</option>
                {PIPELINE_STAGES.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => setPipelineFilter('')}
                  className={`px-2.5 py-1 rounded-full text-[11px] border ${pipelineFilter === '' ? 'bg-[#005EB8] text-white border-[#005EB8]' : 'bg-white text-gray-600 border-gray-200'}`}
                >
                  All ({candidates.length})
                </button>
                {PIPELINE_STAGES.slice(0, 5).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setPipelineFilter(s)}
                    className={`px-2.5 py-1 rounded-full text-[11px] border ${
                      pipelineFilter === s ? 'bg-[#005EB8] text-white border-[#005EB8]' : 'bg-white text-gray-600 border-gray-200'
                    }`}
                  >
                    {TIMELINE_SHORT_LABELS[s]} ({dashboard.stageCounts[s] ?? 0})
                  </button>
                ))}
              </div>
              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={hideAlreadyInPipeline}
                  onChange={e => setHideAlreadyInPipeline(e.target.checked)}
                  className="rounded border-gray-300 text-[#005EB8]"
                />
                <span>Hide already in pipeline</span>
              </label>
              {selectedIds.size > 0 && (
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-200">
                  <span className="text-xs text-gray-600">{selectedIds.size} selected</span>
                  <select
                    value={bulkStage}
                    onChange={e => setBulkStage(e.target.value as PipelineStage | '')}
                    className="px-2 py-1 rounded border border-gray-300 text-xs"
                  >
                    <option value="">Change stage to...</option>
                    {PIPELINE_STAGES.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleBulkStageChange}
                    disabled={!bulkStage || savingAdmin}
                    className="text-xs px-2 py-1 bg-[#005EB8] text-white rounded hover:opacity-90 disabled:opacity-50"
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    onClick={handleBulkSendToPipeline}
                    disabled={sendingToPipeline}
                    className="text-xs px-2 py-1 bg-emerald-600 text-white rounded hover:opacity-90 disabled:opacity-50"
                    title="Copies selected candidates into Pipeline (does not delete from Candidates)"
                  >
                    {sendingToPipeline ? 'Sending...' : 'Send to pipeline'}
                  </button>
                  <button
                    type="button"
                    onClick={handleBulkDeleteSelected}
                    disabled={deleting}
                    className="text-xs px-2 py-1 bg-red-600 text-white rounded hover:opacity-90 disabled:opacity-50"
                  >
                    {deleting ? 'Deleting...' : 'Delete Selected'}
                  </button>
                  <button type="button" onClick={() => setSelectedIds(new Set())} className="text-xs text-gray-500 hover:underline">
                    Clear
                  </button>
                </div>
              )}
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="grid grid-cols-[34px,1.1fr,0.8fr,1.15fr,0.9fr,1.15fr,0.8fr,0.6fr,0.85fr] items-center gap-2 px-4 py-2 border-b border-gray-100 bg-[#f8fbff] text-[11px] font-semibold text-gray-500 uppercase tracking-wide sticky top-0 z-10">
                <input type="checkbox" checked={filteredCandidates.length > 0 && filteredCandidates.every(c => selectedIds.has(c.id))} onChange={selectAll} className="rounded border-gray-300 text-[#005EB8]" />
                <span>Candidate Name</span>
                <span>Phone</span>
                <span>Email</span>
                <span>Status / Stage</span>
                <span>Current Status</span>
                <span>Date & Time</span>
                <span>Score</span>
                <span>Resume / LinkedIn</span>
              </div>
              {filteredCandidates.length === 0 && (
                <div className="px-4 py-12 text-center text-sm text-gray-500">No candidates match your filters.</div>
              )}
              {paginatedCandidates.map(c => {
                const admin = getAdminData(c);
                const activity = latestCandidateActivity(c);
                return (
                  <div
                    key={c.id}
                    className={`grid grid-cols-[34px,1.1fr,0.8fr,1.15fr,0.9fr,1.15fr,0.8fr,0.6fr,0.85fr] items-center gap-2 p-3 border-b border-gray-100 transition-all ${
                      selectedCandidate?.id === c.id
                        ? 'bg-gradient-to-r from-[#005EB8]/10 to-white border-l-4 border-l-[#005EB8]'
                        : 'hover:bg-gradient-to-r hover:from-gray-50 hover:to-white'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(c.id)}
                      onChange={() => toggleSelect(c.id)}
                      onClick={e => e.stopPropagation()}
                      className="rounded border-gray-300 text-[#005EB8]"
                    />
                    <div className="min-w-0">
                      <button type="button" onClick={() => selectCandidate(c)} className="font-semibold text-sm text-[#0b1f3a] hover:underline truncate text-left">
                        {c.firstName} {c.lastName}
                      </button>
                    {sourceIdsInPipeline.has(c.id) && (
                      <span className="mt-1 inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                        Already in pipeline
                      </span>
                    )}
                    </div>
                    <div className="text-[12px] text-gray-700 truncate">{c.phone || '-'}</div>
                    <div className="text-[12px] text-gray-600 truncate">{c.email}</div>
                    <div className="min-w-0">
                      <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold bg-gray-100 text-gray-700 border border-gray-200 inline-block truncate max-w-full">
                        {admin.pipelineStage}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className={`text-[11px] truncate ${activity.priority === 'urgent' ? 'text-red-700 font-semibold' : 'text-gray-700'}`}>{activity.text}</p>
                      {(activity.at || activity.by) && (
                        <p className="text-[10px] text-gray-500 truncate">
                          {activity.by ? `${activity.by} · ` : ''}{activity.at ? formatDateTimeCanadaEastern(activity.at) : ''}
                        </p>
                      )}
                    </div>
                    <div className="text-[11px] text-gray-700 truncate">{formatDateTimeCanadaEastern(c.timestamp)}</div>
                    <div className="text-[12px] text-gray-700">{c.score ?? '-'}</div>
                    <div className="text-[12px] text-gray-700 min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1">
                      {c.applicantQuestionnaire?.resumeUrls?.[0] ? (
                        <a
                          href={c.applicantQuestionnaire.resumeUrls[0]}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#005EB8] font-semibold hover:underline shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Resume
                        </a>
                      ) : null}
                      {c.applicantQuestionnaire?.linkedinProfileUrl ? (
                        <a
                          href={c.applicantQuestionnaire.linkedinProfileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 text-[#005EB8] font-semibold hover:underline shrink-0"
                          onClick={(e) => e.stopPropagation()}
                          title={c.applicantQuestionnaire.linkedinProfileUrl}
                        >
                          <Linkedin size={14} aria-hidden /> LI
                        </a>
                      ) : null}
                      {!c.applicantQuestionnaire?.resumeUrls?.[0] && !c.applicantQuestionnaire?.linkedinProfileUrl ? '—' : null}
                    </div>
                  </div>
                );
              })}
            </div>
            {filteredCandidates.length > 0 && (
              <div className="shrink-0 border-t border-gray-100 bg-[#f9fbff] px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-sm">
                <p className="text-gray-600">
                  Showing{' '}
                  <span className="font-semibold text-gray-900">
                    {(candidateListPage - 1) * CANDIDATES_PAGE_SIZE + 1}–
                    {Math.min(candidateListPage * CANDIDATES_PAGE_SIZE, filteredCandidates.length)}
                  </span>{' '}
                  of <span className="font-semibold text-gray-900">{filteredCandidates.length}</span>
                  {filteredCandidates.length !== candidates.length && (
                    <span className="text-gray-500"> (filtered from {candidates.length})</span>
                  )}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={candidateListPage <= 1}
                    onClick={() => setCandidateListPage((p) => Math.max(1, p - 1))}
                    className="px-3 py-1.5 rounded-lg border border-gray-300 text-xs font-semibold text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <span className="text-xs text-gray-600 tabular-nums px-1">
                    Page {candidateListPage} of {candidateListPageCount}
                  </span>
                  <button
                    type="button"
                    disabled={candidateListPage >= candidateListPageCount}
                    onClick={() => setCandidateListPage((p) => Math.min(candidateListPageCount, p + 1))}
                    className="px-3 py-1.5 rounded-lg border border-gray-300 text-xs font-semibold text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Candidate Detail */}
          <div className={`${selectedCandidate ? 'block' : 'hidden'} rounded-2xl border border-[#d6deea] bg-gradient-to-b from-[#f8fafc] to-[#eef3f9] shadow-sm h-[calc(100vh-130px)] overflow-y-auto p-6 pt-8 lg:p-7 lg:pt-9`}>
            {selectedCandidate ? (
              <div className="space-y-8 animate-fade-in">
                <div className="flex items-center justify-between">
                  <button type="button" onClick={() => setSelectedCandidate(null)} className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50">
                    Back to candidates
                  </button>
                </div>

                {(() => {
                  const admin = getAdminData(selectedCandidate);
                  const journeyStage = admin.pipelineStage;
                  const journeyStages: PipelineStage[] = [
                    'Checked In',
                    'Invited to Live Career Overview Session',
                    'Live Career Overview Session Attended',
                    'Leadership assessment form sent',
                    'Leadership form submitted, awaiting evaluation',
                    'Evaluation Done',
                    'Interview scheduled',
                    'Final decision',
                  ];
                  const activeIdx = Math.max(0, journeyStages.indexOf(journeyStage));
                  const n = journeyStages.length;
                  const isFinal = journeyStage === 'Final decision';
                  return (
                    <div className="mt-2 rounded-2xl border border-gray-200 bg-gradient-to-r from-slate-100 via-slate-50 to-emerald-50/40 px-3 py-5 sm:px-5 sm:py-6 shadow-sm">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-4">Hiring journey</p>
                      <div className="overflow-x-auto overflow-y-visible pt-2 pb-1 -mx-1">
                        <div className="min-w-[560px] sm:min-w-0 relative px-1">
                          <div className="pointer-events-none absolute left-3 right-3 top-[22px] h-[3px] rounded-full bg-gray-200 z-0" aria-hidden />
                          {n > 1 && (
                            <div
                              className="pointer-events-none absolute left-3 top-[22px] h-[3px] rounded-full bg-[#005EB8] z-0 transition-all duration-300"
                              style={{ width: `calc((100% - 24px) * ${activeIdx / (n - 1)})` }}
                              aria-hidden
                            />
                          )}
                          <div className="relative z-10 flex justify-between items-start gap-0">
                            {journeyStages.map((stage, i) => {
                              const done = i <= activeIdx;
                              const active = i === activeIdx;
                              const isFinalNode = stage === 'Final decision';
                              return (
                                <div key={stage} className="flex flex-col items-center flex-1 min-w-0 max-w-[100px] sm:max-w-none" title={stage}>
                                  <div
                                    className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 shadow-sm transition-transform ${
                                      active
                                        ? isFinal
                                          ? 'scale-110 border-red-500 bg-red-500 text-white'
                                          : 'scale-110 border-[#005EB8] bg-[#005EB8] text-white'
                                        : done
                                          ? 'border-[#005EB8] bg-white text-[#005EB8]'
                                          : 'border-gray-300 bg-white text-gray-400'
                                    }`}
                                  >
                                    {active ? <User size={18} strokeWidth={2.5} aria-hidden /> : <span className="text-[11px] font-bold">{i + 1}</span>}
                                  </div>
                                  <p className={`mt-2 text-[9px] sm:text-[10px] font-semibold text-center leading-tight px-0.5 ${active ? (isFinal ? 'text-red-700' : 'text-[#005EB8]') : 'text-gray-600'}`}>
                                    {TIMELINE_SHORT_LABELS[stage]}
                                  </p>
                                  {isFinalNode && (
                                    <div className="mt-1.5 flex flex-col gap-1 w-full max-w-[86px]">
                                      <button
                                        type="button"
                                        onClick={() => handleFinalDecisionChange('Hired')}
                                        className={`text-[9px] px-1.5 py-1 rounded-md border font-semibold transition ${
                                          admin.finalDecision === 'Hired'
                                            ? 'border-green-500 bg-green-500 text-white'
                                            : 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100'
                                        }`}
                                      >
                                        Hired
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleFinalDecisionChange('Not Hired')}
                                        className={`text-[9px] px-1.5 py-1 rounded-md border font-semibold transition ${
                                          admin.finalDecision === 'Not Hired'
                                            ? 'border-red-500 bg-red-500 text-white'
                                            : 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                                        }`}
                                      >
                                        Not hired
                                      </button>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          <p className="mt-3 text-center text-xs text-gray-600">
                            Current stage:{' '}
                            <span className="font-semibold text-gray-900">
                              {journeyStage}
                              {isFinal && admin.finalDecision ? ` (${admin.finalDecision})` : ''}
                            </span>
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Header */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 bg-gradient-to-br from-blue-50 to-emerald-50 rounded-2xl flex items-center justify-center text-[#005EB8] border border-blue-100">
                      <User size={32} />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-2xl font-extrabold text-gray-900 tracking-tight">
                          {selectedCandidate.firstName} {selectedCandidate.lastName}
                        </h2>
                        {selectedCandidate.fitCategory &&
                          badge(
                            selectedCandidate.fitCategory,
                            getStatusColor(selectedCandidate.fitCategory),
                          )}
                        {badge(getAdminData(selectedCandidate).pipelineStage, 'bg-white text-[#005EB8] border-[#005EB8]/30')}
                      </div>

                      <div className="flex flex-wrap gap-2 text-sm text-gray-600 mt-1">
                        <span className="font-medium">{selectedCandidate.email}</span>
                        {selectedCandidate.phone && <span className="text-gray-300">•</span>}
                        {selectedCandidate.phone && <span className="font-medium">{selectedCandidate.phone}</span>}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        ID: {selectedCandidate.id} • Submitted {formatDateTimeCanadaEastern(selectedCandidate.timestamp)}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    {selectedCandidate.fitCategory && (
                      <div className="text-right">
                        <div className="text-3xl font-extrabold text-[#005EB8] leading-none">{selectedCandidate.score}</div>
                        <div className="text-[10px] text-gray-500 uppercase tracking-wide font-bold mt-1">Total Score</div>
                      </div>
                    )}
                    <div className="flex flex-col items-end gap-2 max-w-full">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="text-[11px] px-3 py-1"
                          onClick={() => downloadCandidateReportPdf(selectedCandidate)}
                        >
                          Generate report (PDF)
                        </Button>
                        <input
                          type="email"
                          placeholder="Staff email"
                          value={reportStaffEmail}
                          onChange={e => {
                            setReportStaffEmail(e.target.value);
                            setReportEmailError(null);
                            setReportEmailSent(false);
                          }}
                          className="min-w-[180px] max-w-[220px] px-3 py-1.5 text-xs rounded-lg border border-gray-300 focus:ring-[#005EB8] focus:border-[#005EB8]"
                          aria-label="Staff email for PDF report"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          className="text-[11px] px-3 py-1 border-[#005EB8]/40 text-[#005EB8]"
                          onClick={handleEmailCandidateReportPdf}
                          disabled={reportEmailSending}
                        >
                          {reportEmailSending ? 'Sending…' : 'Email report (PDF)'}
                        </Button>
                      </div>
                      <label className="flex items-center justify-end gap-2 text-[11px] text-gray-700 cursor-pointer select-none max-w-sm ml-auto">
                        <input
                          type="checkbox"
                          checked={reportCcAlex}
                          onChange={e => setReportCcAlex(e.target.checked)}
                          className="rounded border-gray-300 text-[#005EB8] focus:ring-[#005EB8]"
                        />
                        <span>CC {CC_EMAIL_ALEX}</span>
                      </label>
                      {reportEmailError && (
                        <p className="text-[11px] text-red-600 text-right max-w-sm">{reportEmailError}</p>
                      )}
                      {reportEmailSent && !reportEmailError && (
                        <p className="text-[11px] text-green-700 text-right">Report emailed.</p>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="text-[11px] px-3 py-1 border-red-200 text-red-600 hover:bg-red-50"
                      onClick={handleDeleteSelected}
                      disabled={deleting}
                    >
                      {deleting ? 'Deleting...' : 'Delete Candidate'}
                    </Button>
                  </div>
                </div>

                <div className="rounded-xl border border-gray-200 bg-[#f3f6fb] p-2 flex flex-wrap gap-2">
                  {[
                    ['profile', 'Profile'],
                    ['status', 'Status'],
                    ['assessment', 'Assessment'],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setDetailTab(id as typeof detailTab)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                        detailTab === id
                          ? 'bg-[#0b1f3a] text-white border-[#0b1f3a]'
                          : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* At-a-glance */}
                {detailTab === 'profile' && (
                <div className="rounded-2xl border border-gray-200 bg-gradient-to-r from-[#e8f1ff] to-[#edf8f2] p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {badge(
                        selectedCandidate.assessment || selectedCandidate.status === 'assessment_complete'
                          ? 'Assessment: Complete'
                          : 'Assessment: Not complete',
                        selectedCandidate.assessment || selectedCandidate.status === 'assessment_complete'
                          ? 'bg-green-50 text-green-800 border-green-200'
                          : 'bg-gray-50 text-gray-700 border-gray-200',
                      )}
                      {badge(
                        (() => {
                          const q = selectedCandidate.applicantQuestionnaire;
                          const n = q?.resumeUrls?.length ?? 0;
                          const li = q?.linkedinProfileUrl?.trim();
                          const parts = [
                            n > 0 ? `Resumes: ${n}` : null,
                            li ? 'LinkedIn' : null,
                          ].filter(Boolean);
                          return parts.length ? parts.join(' · ') : 'No resume / LinkedIn';
                        })(),
                        hasResumeOrLinkedInMaterial(
                          selectedCandidate.applicantQuestionnaire?.resumeUrls,
                          selectedCandidate.applicantQuestionnaire?.linkedinProfileUrl,
                        )
                          ? 'bg-blue-50 text-blue-800 border-blue-200'
                          : 'bg-gray-50 text-gray-700 border-gray-200',
                      )}
                      {(selectedCandidate.applicantQuestionnaire as any)?.contactPermission != null &&
                        badge(
                          `Contact: ${(selectedCandidate.applicantQuestionnaire as any).contactPermission === 'yes' ? 'Yes' : 'No'}`,
                          (selectedCandidate.applicantQuestionnaire as any).contactPermission === 'yes'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : 'bg-gray-50 text-gray-700 border-gray-200',
                        )}
                    </div>
                  </div>
                </div>
                )}

                {/* Disqualified at questionnaire - reason for admin */}
                {detailTab === 'profile' && getAdminData(selectedCandidate).questionnaireDisqualified && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                    <h3 className="text-sm font-bold text-amber-900 mb-1">Disqualified at questionnaire</h3>
                    <p className="text-sm text-amber-800 mb-1">
                      {getAdminData(selectedCandidate).questionnaireDisqualified!.reason}
                    </p>
                    <p className="text-xs text-amber-700">
                      Question: {getAdminData(selectedCandidate).questionnaireDisqualified!.questionKey} ·{' '}
                      {formatDateTimeCanadaEastern(getAdminData(selectedCandidate).questionnaireDisqualified!.at)}
                    </p>
                  </div>
                )}

                {/* Resumes & LinkedIn */}
                {detailTab === 'profile' &&
                  (hasResumeOrLinkedInMaterial(
                    selectedCandidate.applicantQuestionnaire?.resumeUrls,
                    selectedCandidate.applicantQuestionnaire?.linkedinProfileUrl,
                  ) ? (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                        <FileText size={20} className="text-[#005EB8]" />
                        Resume &amp; LinkedIn
                        {getAdminData(selectedCandidate).resumeReviewedAt && (
                          <span className="text-xs font-normal text-green-600 bg-green-50 px-2 py-0.5 rounded">Reviewed</span>
                        )}
                      </h3>
                      {!getAdminData(selectedCandidate).resumeReviewedAt && (
                        <Button variant="outline" className="text-xs px-3 py-1.5" onClick={handleMarkResumeReviewed} disabled={savingAdmin}>
                          Mark as reviewed
                        </Button>
                      )}
                    </div>
                    {selectedCandidate.applicantQuestionnaire?.linkedinProfileUrl && (
                      <div>
                        <p className="text-xs font-medium text-gray-500 mb-1">LinkedIn profile</p>
                        <a
                          href={selectedCandidate.applicantQuestionnaire.linkedinProfileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-[#0a66c2] text-[#0a66c2] rounded-lg text-sm font-medium hover:bg-blue-50"
                        >
                          <Linkedin size={18} aria-hidden />
                          Open profile
                        </a>
                      </div>
                    )}
                    {selectedCandidate.applicantQuestionnaire?.resumeUrls?.length ? (
                      <div>
                        <p className="text-xs font-medium text-gray-500 mb-1">Resume files</p>
                        <div className="flex flex-wrap gap-3">
                          {selectedCandidate.applicantQuestionnaire!.resumeUrls!.map((url, i) => (
                            <a
                              key={i}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-[#005EB8] text-[#005EB8] rounded-lg text-sm font-medium hover:bg-blue-50"
                            >
                              <FileText size={16} /> Resume {i + 1}
                            </a>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="bg-slate-50 border border-dashed border-slate-200 rounded-xl p-4 text-center text-sm text-gray-500">
                    No resume or LinkedIn on file.
                  </div>
                ))}

                {/* HR Panel: Stage, Rating, Interview, Next step, Tags, Notes, Email */}
                {detailTab === 'status' && (
                <div className="border border-[#d3dded] rounded-xl p-5 space-y-5 bg-[#f7f9fd]">
                  <h3 className="text-lg font-bold border-b pb-2 text-[#0b1f3a]">Candidate Control Center</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Pipeline stage</label>
                      <select
                        value={getAdminData(selectedCandidate).pipelineStage}
                        onChange={e => handlePipelineStageChange(e.target.value as PipelineStage)}
                        disabled={savingAdmin}
                        className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-[#005EB8] focus:border-[#005EB8]"
                      >
                        {PIPELINE_STAGES.map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Rating (1–5)</label>
                      <div className="flex gap-1">
                        {[1, 2, 3, 4, 5].map(n => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => handleRatingChange(n)}
                            className={`p-1 rounded ${getAdminData(selectedCandidate).rating === n ? 'text-amber-500' : 'text-gray-300 hover:text-amber-400'}`}
                          >
                            <Star size={20} fill={getAdminData(selectedCandidate).rating === n ? 'currentColor' : 'none'} />
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1 flex items-center gap-1"><Calendar size={12} /> Session scheduled</label>
                      <input
                        key={`${selectedCandidate.id}-interview`}
                        type="datetime-local"
                        defaultValue={getAdminData(selectedCandidate).interviewScheduledAt?.slice(0, 16) ?? ''}
                        onBlur={e => handleInterviewDateChange(e.target.value ? new Date(e.target.value).toISOString() : '')}
                        disabled={savingAdmin}
                        className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-[#005EB8] focus:border-[#005EB8]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Next step</label>
                      <input
                        type="text"
                        placeholder="e.g. Call for final interview"
                        value={nextStepEdit}
                        onChange={e => setNextStepEdit(e.target.value)}
                        onBlur={() => handleNextStepChange(nextStepEdit)}
                        disabled={savingAdmin}
                        className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-[#005EB8] focus:border-[#005EB8]"
                      />
                    </div>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                      Evaluation details
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                      <Button
                        type="button"
                        onClick={() => setShowEvaluationModal(true)}
                        disabled={evaluationSaving || !canRunEvaluation}
                        className="justify-center"
                      >
                        {evaluationSaving ? 'Saving…' : 'Open evaluation form'}
                      </Button>
                      {getAdminData(selectedCandidate).evaluation && (
                        <p className="text-xs text-gray-600">
                          Last completed by{' '}
                          <span className="font-semibold">{getAdminData(selectedCandidate).evaluation?.evaluatorName}</span>
                          {' '}on {formatDateTimeCanadaEastern(getAdminData(selectedCandidate).evaluation?.doneAt)}
                        </p>
                      )}
                    </div>
                    {!canRunEvaluation && (
                      <p className="text-xs text-amber-700">
                        Evaluation will be enabled once leadership assessment is submitted by this candidate.
                      </p>
                    )}
                    {getAdminData(selectedCandidate).evaluation?.history?.length ? (
                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs space-y-2 max-h-40 overflow-auto">
                        <p className="font-semibold text-gray-700">Evaluation history</p>
                        {getAdminData(selectedCandidate).evaluation?.history?.slice().reverse().map((h, idx) => (
                          <div key={`${h.doneAt}-${idx}`} className="border-b border-gray-200 pb-1">
                            <p><span className="font-semibold">{h.evaluatorName}</span> · {formatDateTimeCanadaEastern(h.doneAt)}</p>
                            <p className="text-gray-600">{h.comments || 'No comments'}</p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="hidden">
                    <label className="block text-xs font-medium text-gray-500 mb-1 flex items-center gap-1"><Tag size={12} /> Tags</label>
                    <div className="flex flex-wrap gap-2 mb-2">
                      {getAdminData(selectedCandidate).tags.map(t => (
                        <span key={t} className="inline-flex items-center gap-1 px-2 py-1 bg-[#005EB8] text-white text-xs rounded-full">
                          {t} <button type="button" onClick={() => handleRemoveTag(t)} className="hover:opacity-80">×</button>
                        </span>
                      ))}
                      <select
                        value={newTag}
                        onChange={e => { const v = e.target.value; if (v) handleAddTag(v); setNewTag(''); }}
                        className="text-sm border border-gray-300 rounded-lg px-2 py-1"
                      >
                        <option value="">Add tag...</option>
                        {SUGGESTED_TAGS.filter(t => !getAdminData(selectedCandidate).tags.includes(t)).map(t => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                      <input
                        type="text"
                        placeholder="Custom tag"
                        value={newTag}
                        onChange={e => setNewTag(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddTag(newTag))}
                        className="w-28 px-2 py-1 text-sm border border-gray-300 rounded-lg"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1 flex items-center gap-1"><MessageSquare size={12} /> Notes</label>
                    <div className="space-y-2 mb-2 max-h-32 overflow-y-auto">
                      {getAdminData(selectedCandidate).notes.map(n => (
                        <div key={n.id} className="text-sm bg-white border border-gray-100 rounded-lg p-2">
                          <p className="text-gray-800">{n.text}</p>
                          <p className="text-[10px] text-gray-400 mt-1">{formatDateTimeCanadaEastern(n.createdAt)}{n.authorEmail ? ` · ${n.authorEmail}` : ''}</p>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Add a note..."
                        value={newNote}
                        onChange={e => setNewNote(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddNote())}
                        className="flex-1 px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-[#005EB8] focus:border-[#005EB8]"
                      />
                      <Button onClick={handleAddNote} disabled={!newNote.trim() || savingAdmin}>Add</Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Stage emails</p>
                    <div className="flex flex-wrap gap-2 items-center">
                    {EMAIL_TEMPLATES.map((t) => (
                      <Button
                        key={t.id}
                        variant="outline"
                        onClick={() => openEmailModal(t.id)}
                        className="text-sm"
                        title={t.hint}
                      >
                        <Mail size={16} className="mr-2 shrink-0" /> {t.name}
                      </Button>
                    ))}
                    <Button variant="outline" onClick={() => openEmailModal('compose')} className="text-sm">
                      <Mail size={16} className="mr-2" /> Compose
                    </Button>
                    <button
                      type="button"
                      onClick={() => setEmailLogOpen((o) => !o)}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#005EB8] hover:text-[#004a94] self-center rounded-lg px-2 py-1 hover:bg-blue-50/80 border border-transparent hover:border-blue-100 transition-colors"
                      aria-expanded={emailLogOpen}
                    >
                      Emails sent: {getAdminData(selectedCandidate).emailsSent.length}
                      {emailLogOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                    </div>
                    {emailLogOpen && (
                      <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3 shadow-sm">
                        {getAdminData(selectedCandidate).emailsSent.length === 0 ? (
                          <p className="text-sm text-gray-600">No emails logged yet for this candidate.</p>
                        ) : (
                          <ul className="space-y-3 max-h-64 overflow-y-auto">
                            {[...getAdminData(selectedCandidate).emailsSent]
                              .sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime())
                              .map((entry, idx) => (
                                <li
                                  key={`${entry.sentAt}-${idx}`}
                                  className="border-b border-gray-100 pb-3 last:border-0 last:pb-0 text-sm"
                                >
                                  <p className="font-semibold text-gray-900 leading-snug">{entry.subject}</p>
                                  <p className="text-xs text-gray-500 mt-1">
                                    {formatDateTimeCanadaEastern(entry.sentAt)}
                                  </p>
                                  <p className="text-xs text-gray-600 mt-0.5">
                                    Type: <span className="font-medium">{formatEmailLogType(entry.type)}</span>
                                  </p>
                                </li>
                              ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">WebinarGeek sync data</p>
                    {(() => {
                      const wg = (getAdminData(selectedCandidate).webinarGeek || {}) as Record<string, unknown>;
                      const records = Array.isArray(wg.records) ? wg.records as Array<Record<string, unknown>> : [];
                      if (Object.keys(wg).length === 0) {
                        return <p className="text-sm text-gray-600">No WebinarGeek data synced yet for this candidate.</p>;
                      }
                      return (
                        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-2 text-sm">
                          <p className="text-gray-700">
                            Last sync: <span className="font-medium">{wg.synced_at ? formatDateTimeCanadaEastern(String(wg.synced_at)) : '—'}</span>
                          </p>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                            <div className="rounded-lg border border-gray-200 p-2">Subs: <span className="font-semibold">{String(wg.total_subscriptions ?? 0)}</span></div>
                            <div className="rounded-lg border border-gray-200 p-2">Watched: <span className="font-semibold">{String(wg.watched_count ?? 0)}</span></div>
                            <div className="rounded-lg border border-gray-200 p-2">Live: <span className="font-semibold">{String(wg.watched_live_count ?? 0)}</span></div>
                            <div className="rounded-lg border border-gray-200 p-2">Replay: <span className="font-semibold">{String(wg.watched_replay_count ?? 0)}</span></div>
                          </div>
                          <p className="text-xs text-gray-600">
                            Total watch duration: <span className="font-medium">{String(wg.total_watch_duration ?? 0)} sec</span>
                          </p>
                          <p className="text-xs text-gray-600">
                            Registration IPs: <span className="font-medium">{Array.isArray(wg.registration_ips) ? wg.registration_ips.join(', ') || '—' : '—'}</span>
                          </p>
                          <p className="text-xs text-gray-600">
                            Sources: <span className="font-medium">{Array.isArray(wg.registration_sources) ? wg.registration_sources.join(', ') || '—' : '—'}</span>
                          </p>
                          <p className="text-xs text-gray-500">Detailed records synced: {records.length}</p>
                        </div>
                      );
                    })()}
                  </div>
                </div>
                )}
                {/* Applicant Questionnaire */}
                {detailTab === 'assessment' && selectedCandidate.applicantQuestionnaire && (
                  <div className="space-y-4">
                    <h3 className="text-lg font-bold border-b pb-2">Applicant Questionnaire</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                      {(selectedCandidate.applicantQuestionnaire as any).occupation != null && (
                        <>
                          <div><p className="text-gray-500">Occupation</p><p className="text-gray-800 font-medium capitalize">{(selectedCandidate.applicantQuestionnaire as any).occupation}</p></div>
                          <div><p className="text-gray-500">Current role / company</p><p className="text-gray-800">{(selectedCandidate.applicantQuestionnaire as any).currentRole || '—'}</p></div>
                          <div className="sm:col-span-2"><p className="text-gray-500">Background areas</p><p className="text-gray-800">{(selectedCandidate.applicantQuestionnaire as any).backgroundAreas?.join(', ') || '—'}</p></div>
                          <div className="sm:col-span-2"><p className="text-gray-500">Sales / leadership experience</p><p className="text-gray-800">{(selectedCandidate.applicantQuestionnaire as any).salesExperience || '—'}</p></div>
                          <div className="sm:col-span-2"><p className="text-gray-500">Something about yourself (not on resume)</p><p className="text-gray-800">{(selectedCandidate.applicantQuestionnaire as any).somethingAboutYourself || '—'}</p></div>
                          <div><p className="text-gray-500">Legally entitled to work in Canada</p><p className="font-medium capitalize">{(selectedCandidate.applicantQuestionnaire as any).legallyEntitledCanada}</p></div>
                          <div className="sm:col-span-2">
                            <p className="text-gray-500">LinkedIn profile (check-in)</p>
                            {selectedCandidate.applicantQuestionnaire.linkedinProfileUrl ? (
                              <a
                                href={selectedCandidate.applicantQuestionnaire.linkedinProfileUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[#0a66c2] font-medium hover:underline break-all"
                              >
                                {selectedCandidate.applicantQuestionnaire.linkedinProfileUrl}
                              </a>
                            ) : (
                              <p className="text-gray-800">—</p>
                            )}
                          </div>
                          <div className="sm:col-span-2">
                            <p className="text-gray-500">Resume files (check-in)</p>
                            {selectedCandidate.applicantQuestionnaire.resumeUrls?.length ? (
                              <ul className="list-disc list-inside text-gray-800 space-y-1">
                                {selectedCandidate.applicantQuestionnaire.resumeUrls.map((url, i) => (
                                  <li key={i}>
                                    <a href={url} target="_blank" rel="noopener noreferrer" className="text-[#005EB8] hover:underline break-all">
                                      File {i + 1}
                                    </a>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="text-gray-800">—</p>
                            )}
                          </div>
                        </>
                      )}
                      {(selectedCandidate.applicantQuestionnaire as any).whatStoodOut != null && (
                        <>
                          <div><p className="text-gray-500">What stood out</p><p className="text-gray-800">{(selectedCandidate.applicantQuestionnaire as any).whatStoodOut}</p></div>
                          <div><p className="text-gray-500">Why good fit</p><p className="text-gray-800">{(selectedCandidate.applicantQuestionnaire as any).whyGoodFit}</p></div>
                          <div><p className="text-gray-500">Financial investment for license</p><p className="font-medium capitalize">{(selectedCandidate.applicantQuestionnaire as any).financialInvestmentLicense}</p></div>
                          <div><p className="text-gray-500">Legally entitled (full-time)</p><p className="font-medium capitalize">{(selectedCandidate.applicantQuestionnaire as any).legallyEntitledCanadaFullTime}</p></div>
                          <div><p className="text-gray-500">Comfortable 100% virtual</p><p className="font-medium uppercase">{(selectedCandidate.applicantQuestionnaire as any).comfortableVirtualEnvironment}</p></div>
                          <div><p className="text-gray-500">Excited about off-site social</p><p className="font-medium capitalize">{(selectedCandidate.applicantQuestionnaire as any).excitedOffSiteSocial}</p></div>
                          <div><p className="text-gray-500">Position interest</p><p className="font-medium">{(selectedCandidate.applicantQuestionnaire as any).positionInterest}</p></div>
                          <div><p className="text-gray-500">Contact permission</p><p className="font-medium capitalize">{(selectedCandidate.applicantQuestionnaire as any).contactPermission}</p></div>
                          <div><p className="text-gray-500">Background check willingness</p><p className="font-medium capitalize">{(selectedCandidate.applicantQuestionnaire as any).backgroundCheckWilling}</p></div>
                        </>
                      )}
                    </div>
                    {(selectedCandidate.applicantQuestionnaire as any).questionsAboutOpportunity && (
                      <div><p className="text-gray-500 text-sm">Questions about opportunity</p><p className="text-gray-800 text-sm">{(selectedCandidate.applicantQuestionnaire as any).questionsAboutOpportunity}</p></div>
                    )}
                  </div>
                )}

                {/* Post Live Career Overview Exit Questionnaire */}
                {false && selectedCandidate.exitQuestionnaire && (
                  <div className="space-y-4">
                    <h3 className="text-lg font-bold border-b pb-2">Post Live Career Overview Exit Questionnaire</h3>
                    <p className="text-xs text-gray-500">
                      Submitted {formatDateTimeCanadaEastern(selectedCandidate.exitQuestionnaire.submittedAt)}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                      <div><p className="text-gray-500">First Name</p><p className="text-gray-800 font-medium">{selectedCandidate.exitQuestionnaire.firstName}</p></div>
                      <div><p className="text-gray-500">Last Name</p><p className="text-gray-800 font-medium">{selectedCandidate.exitQuestionnaire.lastName}</p></div>
                      <div><p className="text-gray-500">Email</p><p className="text-gray-800">{selectedCandidate.exitQuestionnaire.email}</p></div>
                      <div><p className="text-gray-500">Phone</p><p className="text-gray-800">{selectedCandidate.exitQuestionnaire.phone}</p></div>
                      <div className="sm:col-span-2"><p className="text-gray-500">What stood out most</p><p className="text-gray-800">{selectedCandidate.exitQuestionnaire.whatStoodOut}</p></div>
                      <div className="sm:col-span-2"><p className="text-gray-500">Why good fit</p><p className="text-gray-800">{selectedCandidate.exitQuestionnaire.whyGoodFit}</p></div>
                      <div><p className="text-gray-500">Financial investment for license ($348)</p><p className="font-medium capitalize">{selectedCandidate.exitQuestionnaire.financialInvestmentLicense}</p></div>
                      <div><p className="text-gray-500">Legally entitled to work in Canada (full-time)</p><p className="font-medium capitalize">{selectedCandidate.exitQuestionnaire.legallyEntitledCanadaFullTime}</p></div>
                      <div><p className="text-gray-500">Comfortable 100% virtual</p><p className="font-medium uppercase">{selectedCandidate.exitQuestionnaire.comfortableVirtualEnvironment}</p></div>
                      <div><p className="text-gray-500">Excited about off-site social</p><p className="font-medium capitalize">{selectedCandidate.exitQuestionnaire.excitedOffSiteSocial}</p></div>
                      <div><p className="text-gray-500">Position interest</p><p className="font-medium">{selectedCandidate.exitQuestionnaire.positionInterest}</p></div>
                      <div><p className="text-gray-500">Contact permission</p><p className="font-medium capitalize">{selectedCandidate.exitQuestionnaire.contactPermission}</p></div>
                    </div>
                    {selectedCandidate.exitQuestionnaire.questionsAboutOpportunity && (
                      <div><p className="text-gray-500 text-sm">Questions about opportunity</p><p className="text-gray-800 text-sm">{selectedCandidate.exitQuestionnaire.questionsAboutOpportunity}</p></div>
                    )}
                  </div>
                )}

                {/* Assessment Data */}
                {detailTab === 'assessment' && (selectedCandidate.assessment ? (
                  <div className="space-y-6">
                    <h3 className="text-lg font-bold border-b pb-2">Assessment Results</h3>

                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-3">
                      <h4 className="text-sm font-bold text-slate-800">Assessment summary</h4>
                      <p className="text-xs text-slate-500 mb-2">
                        Summary of core drivers, personality traits, scenario preferences, and entrepreneurial quotient based on the completed assessment.
                      </p>
                      <div className="space-y-2 text-sm text-slate-700">
                        {getAssessmentSummary(selectedCandidate.assessment).map((paragraph, i) => (
                          <p key={i} className="leading-relaxed">{paragraph}</p>
                        ))}
                      </div>
                    </div>

                    {(selectedCandidate.assessment.financialInvestmentLicense != null || selectedCandidate.assessment.comfortableVirtualEnvironment != null || selectedCandidate.assessment.careerPathInterest != null) && (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        {selectedCandidate.assessment.financialInvestmentLicense != null && (
                          <div>
                            <p className="text-sm text-gray-500">Financial investment for license</p>
                            <p className="font-medium capitalize">{selectedCandidate.assessment.financialInvestmentLicense}</p>
                          </div>
                        )}
                        {selectedCandidate.assessment.comfortableVirtualEnvironment != null && (
                          <div>
                            <p className="text-sm text-gray-500">Comfortable 100% virtual</p>
                            <p className="font-medium capitalize">{selectedCandidate.assessment.comfortableVirtualEnvironment}</p>
                          </div>
                        )}
                        {selectedCandidate.assessment.careerPathInterest != null && (
                          <div>
                            <p className="text-sm text-gray-500">Career path interest</p>
                            <p className="font-medium">{selectedCandidate.assessment.careerPathInterest}</p>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <p className="text-sm text-gray-500">Current Occupation</p>
                        <p className="font-medium capitalize">{selectedCandidate.assessment.occupation}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-500">Role</p>
                        <p className="font-medium">{selectedCandidate.assessment.currentRole || 'N/A'}</p>
                      </div>
                    </div>

                    <div>
                      <p className="text-sm text-gray-500 mb-1">Background Areas</p>
                      <div className="flex flex-wrap gap-2">
                        {selectedCandidate.assessment.backgroundAreas.map(area => (
                          <span key={area} className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs border border-blue-100">{area}</span>
                        ))}
                      </div>
                    </div>

                    <div className="bg-gray-50 p-4 rounded-lg">
                      <p className="text-sm text-gray-500 mb-1">Experience Summary</p>
                      <p className="text-sm text-gray-800 italic">"{selectedCandidate.assessment.salesExperience}"</p>
                    </div>

                    <div>
                      <h4 className="font-bold text-gray-900 mb-4">Core Drivers (1-10)</h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <div className="flex justify-between text-sm mb-1">
                            <span>Competitiveness</span>
                            <span className="font-bold">{selectedCandidate.assessment.competitiveness + '/10'}</span>
                          </div>
                          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                            <div className="h-full bg-[#005EB8]" style={{ width: `${selectedCandidate.assessment.competitiveness * 10}%` }}></div>
                          </div>
                        </div>
                        <div>
                          <div className="flex justify-between text-sm mb-1">
                            <span>Money Motivation</span>
                            <span className="font-bold">{selectedCandidate.assessment.moneyMotivation + '/10'}</span>
                          </div>
                          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                            <div className="h-full bg-[#37B06D]" style={{ width: `${selectedCandidate.assessment.moneyMotivation * 10}%` }}></div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-gray-100 space-y-2">
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setShowAnswers(prev => !prev)}
                          className="text-xs font-semibold text-[#005EB8] hover:text-[#00428a] flex items-center gap-1"
                        >
                          {showAnswers ? 'Hide full assessment responses' : 'View full assessment responses'}
                        </button>
                        <span className="text-gray-300">|</span>
                        <button
                          type="button"
                          onClick={() => handleCopyAndOpenAI(CHATGPT_BASE, 'q')}
                          className="text-xs font-semibold text-[#005EB8] hover:text-[#00428a]"
                        >
                          Copy Q&A & open ChatGPT
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCopyAndOpenAI(GEMINI_BASE, 'prompt')}
                          className="text-xs font-semibold text-[#005EB8] hover:text-[#00428a]"
                        >
                          Copy Q&A & open Gemini
                        </button>
                      </div>
                      {copyToast && (
                        <p className="text-xs text-green-600 font-medium">Copied to clipboard. Paste (Ctrl+V) in the new tab and send.</p>
                      )}
                      {showAnswers && (
                        <div className="mt-4 space-y-4 text-sm">
                          {/* Core drivers always shown */}
                          <div>
                            <p className="font-semibold text-gray-800">
                              Q1. On a scale of 1–10, how competitive are you?
                            </p>
                            <p className="text-gray-600">
                              Answer: {selectedCandidate.assessment.competitiveness + '/10'}
                            </p>
                          </div>
                          <div>
                            <p className="font-semibold text-gray-800">
                              Q2. On a scale of 1–10, how motivated are you by income growth?
                            </p>
                            <p className="text-gray-600">
                              Answer: {selectedCandidate.assessment.moneyMotivation + '/10'}
                            </p>
                          </div>

                          {/* New 50-question assessment responses */}
                          {(selectedCandidate.assessment as any).personalityAnswers ||
                          (selectedCandidate.assessment as any).scenarioAnswers ||
                          (selectedCandidate.assessment as any).eqAnswers ||
                          (selectedCandidate.assessment as any).openEndedAnswers ? (
                            <>
                              {/* Open-ended */}
                              {(selectedCandidate.assessment as any).openEndedAnswers && (
                                <div className="space-y-3 pt-2 border-t border-gray-100">
                                  <p className="font-semibold text-gray-800">Open-ended questions</p>
                                  {OPEN_ENDED_QUESTIONS.map(q => (
                                    <div key={q.id}>
                                      <p className="font-semibold text-gray-800">
                                        Q{q.id}. {q.question}
                                      </p>
                                      <p className="text-gray-600 whitespace-pre-wrap">
                                        Answer:{' '}
                                        {(selectedCandidate.assessment as any).openEndedAnswers[q.id] ||
                                          '—'}
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Personality Profile */}
                              {(selectedCandidate.assessment as any).personalityAnswers && (
                                <div className="space-y-3 pt-2 border-t border-gray-100">
                                  <p className="font-semibold text-gray-800">Personality Profile</p>
                                  {PERSONALITY_QUESTIONS.map(q => {
                                    const key =
                                      (selectedCandidate.assessment as any).personalityAnswers[
                                        q.id
                                      ] as keyof typeof PERSONALITY_LIKERT_OPTIONS | undefined;
                                    const label = key
                                      ? PERSONALITY_LIKERT_OPTIONS[key].label
                                      : '—';
                                    return (
                                      <div key={q.id}>
                                        <p className="font-semibold text-gray-800">
                                          Q{q.id}. {q.question}
                                        </p>
                                        <p className="text-gray-600">
                                          Answer: {label} {key ? `(${key})` : ''}
                                        </p>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}

                              {/* Scenario & Preference */}
                              {(selectedCandidate.assessment as any).scenarioAnswers && (
                                <div className="space-y-3 pt-2 border-t border-gray-100">
                                  <p className="font-semibold text-gray-800">
                                    Scenario & Preference Questions
                                  </p>
                                  {SCENARIO_QUESTIONS.map(q => {
                                    const key =
                                      (selectedCandidate.assessment as any).scenarioAnswers[
                                        q.id
                                      ] as string | undefined;
                                    const label = key ? q.options[key] : undefined;
                                    return (
                                      <div key={q.id}>
                                        <p className="font-semibold text-gray-800">
                                          Q{q.id}. {q.question}
                                        </p>
                                        <p className="text-gray-600">
                                          Answer: {label ? `${label} (${key})` : '—'}
                                        </p>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}

                              {/* EQ Test */}
                              {(selectedCandidate.assessment as any).eqAnswers && (
                                <div className="space-y-3 pt-2 border-t border-gray-100">
                                  <p className="font-semibold text-gray-800">
                                    Entrepreneurial Quotient (EQ) Test
                                  </p>
                                  {EQ_QUESTIONS.map(q => {
                                    const key =
                                      (selectedCandidate.assessment as any).eqAnswers[
                                        q.id
                                      ] as keyof typeof EQ_LIKERT_OPTIONS | undefined;
                                    const label = key ? EQ_LIKERT_OPTIONS[key].label : '—';
                                    return (
                                      <div key={q.id}>
                                        <p className="font-semibold text-gray-800">
                                          Q{q.id}. {q.question}
                                        </p>
                                        <p className="text-gray-600">
                                          Answer: {label} {key ? `(${key})` : ''}
                                        </p>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </>
                          ) : (
                            <>
                              {/* Legacy 30-question responses */}
                              <div className="space-y-3">
                                {QUESTIONS.likert.map(q => (
                                  <div key={q.id}>
                                    <p className="font-semibold text-gray-800">
                                      Q{q.id}. {q.text}
                                    </p>
                                    <p className="text-gray-600">
                                      Answer:{' '}
                                      {getLikertLabel(
                                        selectedCandidate.assessment.likertResponses?.[q.id]
                                      ) || '—'}
                                    </p>
                                  </div>
                                ))}
                              </div>

                              <div className="space-y-3 pt-2 border-t border-gray-100">
                                {QUESTIONS.trueScale.map(q => (
                                  <div key={q.id}>
                                    <p className="font-semibold text-gray-800">
                                      Q{q.id}. {q.text}
                                    </p>
                                    <p className="text-gray-600">
                                      Answer:{' '}
                                      {getTrueScaleLabel(
                                        selectedCandidate.assessment.trueScaleResponses?.[q.id]
                                      ) || '—'}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12 bg-gray-50 rounded-lg border border-dashed border-gray-300">
                    <p className="text-gray-400">Assessment not started or completed.</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-gray-400">
                <Eye size={48} className="mb-4 opacity-20" />
                <p>Select a candidate to view details</p>
              </div>
            )}
          </div>
        </div>
        </>
        )}

        {showEvaluationModal && selectedCandidate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => !evaluationSaving && setShowEvaluationModal(false)}>
            <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-gray-900">Complete evaluation</h3>
              <input
                type="text"
                placeholder="Evaluator name"
                value={evaluatorName}
                onChange={(e) => setEvaluatorName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-[#005EB8] focus:border-[#005EB8]"
              />
              <textarea
                placeholder="Evaluation comments"
                value={evaluationComments}
                onChange={(e) => setEvaluationComments(e.target.value)}
                rows={4}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-[#005EB8] focus:border-[#005EB8]"
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowEvaluationModal(false)} disabled={evaluationSaving}>Cancel</Button>
                <Button onClick={handleCompleteEvaluation} disabled={evaluationSaving || !canRunEvaluation}>
                  {evaluationSaving ? 'Saving…' : 'Save evaluation + send email'}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Email modal: preview + send */}
        {showEmailModal && selectedCandidate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => !emailSending && (setShowEmailModal(false), setEmailModalMode(null))}>
            <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="p-6 space-y-4 overflow-y-auto">
                <h3 className="text-lg font-bold text-gray-900">
                  {emailModalMode === 'compose' ? 'Compose email' : `${EMAIL_TEMPLATES.find(t => t.id === emailModalMode)?.name ?? 'Email'} – preview & send`}
                </h3>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">To</label>
                  <input type="email" value={selectedCandidate.email} readOnly className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
                  <input
                    type="text"
                    value={emailSubject}
                    onChange={e => setEmailSubject(e.target.value)}
                    placeholder="Subject"
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-[#005EB8] focus:border-[#005EB8]"
                  />
                </div>
                <div>
                  <div className="flex gap-2 mb-1">
                    <button
                      type="button"
                      onClick={() => setEmailPreviewTab('edit')}
                      className={`text-sm font-medium px-2 py-1 rounded ${emailPreviewTab === 'edit' ? 'bg-[#005EB8] text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                    >
                      Edit
                    </button>
                    {emailBodyIsHtml && (
                      <button
                        type="button"
                        onClick={() => setEmailPreviewTab('preview')}
                        className={`text-sm font-medium px-2 py-1 rounded ${emailPreviewTab === 'preview' ? 'bg-[#005EB8] text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                      >
                        Preview
                      </button>
                    )}
                  </div>
                  {emailPreviewTab === 'edit' ? (
                    <textarea
                      value={emailBody}
                      onChange={e => setEmailBody(e.target.value)}
                      placeholder={emailBodyIsHtml ? 'HTML or plain text...' : 'Your message...'}
                      rows={10}
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-[#005EB8] focus:border-[#005EB8] font-mono"
                    />
                  ) : (
                    <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 min-h-[200px] max-h-[300px] overflow-y-auto text-sm prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: emailBody || '<p class="text-gray-400">No content</p>' }} />
                  )}
                </div>
                {emailError && <p className="text-sm text-red-600">{emailError}</p>}
              </div>
              <div className="flex gap-2 justify-end p-6 border-t border-gray-100">
                <Button variant="outline" onClick={() => { setShowEmailModal(false); setEmailModalMode(null); }} disabled={emailSending}>Cancel</Button>
                <Button onClick={handleSendEmail} disabled={!emailSubject.trim() || emailSending}>
                  {emailSending ? 'Sending...' : 'Send'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
};

export default AdminDashboard;
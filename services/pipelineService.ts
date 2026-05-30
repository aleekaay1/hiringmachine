import { supabase } from './supabaseClient';
import mammoth from 'mammoth';
import { createWorker } from 'tesseract.js';
import {
  journeyStageForCallDisposition,
  type PipelineCallDisposition,
} from './pipelineCallDispositions';
import { getCurrentUserProfile } from './accessControl';

const PIPELINE_BUCKET = 'pipeline-resumes';

export type PipelineJourneyStage =
  | 'new'
  | 'queued_for_call'
  | 'attempted'
  | 'connected'
  | 'follow_up'
  | 'qualified'
  | 'not_interested'
  | 'hired';

export type PipelineStatus = 'open' | 'in_progress' | 'closed';

export interface PipelineCandidate {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  source: string;
  journey_stage: PipelineJourneyStage | string;
  status: PipelineStatus | string;
  uploader_user_id: string | null;
  uploader_label: string | null;
  scheduled_for: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface PipelineCandidateProfile {
  current_title: string | null;
  location: string | null;
  total_experience_years: string | null;
  education_highest: string | null;
  skills_summary: string | null;
  work_summary: string | null;
}

export interface PipelineResume {
  id: string;
  candidate_id: string;
  storage_bucket: string;
  storage_path: string;
  public_url: string | null;
  original_filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  converted_pdf_path: string | null;
  converted_pdf_url: string | null;
  conversion_status: 'pending' | 'processing' | 'ready' | 'failed' | 'not_required';
  conversion_error: string | null;
  resume_source?: 'bulk_upload' | 'journey_upload' | string;
  source_candidate_id?: string | null;
  source_resume_url?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PipelineNote {
  id: string;
  candidate_id: string;
  body: string;
  author_user_id: string | null;
  author_label: string | null;
  created_at: string;
}

export interface PipelineEvaluation {
  id: string;
  candidate_id: string;
  fit_score: number | null;
  disposition: string | null;
  next_action: string | null;
  journey_stage: string | null;
  comments: string | null;
  created_by_user_id: string | null;
  created_by_label: string | null;
  created_at: string;
  updated_at: string;
}

export interface PipelineCallLog {
  id: string;
  candidate_id: string;
  resume_id: string | null;
  threecx_call_id: string | null;
  action: string;
  outcome: string | null;
  duration_seconds: number | null;
  agent_extension: string | null;
  request_payload: Record<string, unknown> | null;
  response_payload: Record<string, unknown> | null;
  created_by_user_id: string | null;
  created_by_label: string | null;
  created_at: string;
}

export interface PipelineCallContext {
  extension?: string | null;
  dialingLocale?: string | null;
}

export interface PipelineCallRecord {
  id: string;
  candidate_id: string;
  resume_id: string | null;
  dial_log_id: string | null;
  recruiter_user_id: string | null;
  recruiter_label: string | null;
  disposition: string;
  comment: string | null;
  dialed_number: string;
  dial_started_at: string;
  disposed_at: string;
  threecx_metadata: Record<string, unknown>;
  created_at: string;
  callback_at?: string | null;
  booked_subtype?: string | null;
}

export interface PipelineIncomingEmailLog {
  id: string;
  provider: string;
  message_id: string;
  thread_id: string | null;
  from_email: string;
  to_email: string | null;
  cc_email: string | null;
  subject: string | null;
  snippet: string | null;
  received_at: string;
  candidate_id: string | null;
  raw_headers: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

/** Row from public.email_send_logs (server-sent / outbox audit). */
export interface PipelineEmailSendLog {
  id: string;
  source: string;
  trigger_label: string | null;
  from_email: string;
  to_email: string;
  cc_email: string | null;
  subject: string;
  candidate_id: string | null;
  status: string;
  created_at: string;
  error_message: string | null;
}

export interface PipelineUserCallSettings {
  user_id: string;
  extension: string | null;
  dialing_locale: string | null;
  daily_upload_target: number | null;
  daily_webinar_booking_target: number | null;
  created_at: string;
  updated_at: string;
}

export interface PipelineActivityTimelineItem {
  id: string;
  kind: 'note' | 'evaluation' | 'call_log' | 'call_record';
  title: string;
  body: string | null;
  actor_label: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

export interface PipelineCandidateBundle {
  candidate: PipelineCandidate;
  resumes: PipelineResume[];
  notes: PipelineNote[];
  evaluations: PipelineEvaluation[];
  callLogs: PipelineCallLog[];
  callRecords: PipelineCallRecord[];
}

export type PipelineUploadStage =
  | 'starting'
  | 'extracting'
  | 'saving_candidate'
  | 'uploading_file'
  | 'creating_resume'
  | 'queueing_conversion'
  | 'completed'
  | 'failed';

export interface PipelineUploadProgress {
  index: number;
  total: number;
  fileName: string;
  stage: PipelineUploadStage;
  percent: number;
  processed: number;
  succeeded: number;
  failed: number;
  message: string;
  error?: string;
}

function sanitizeFilename(name: string): string {
  const clean = name.replace(/[^a-zA-Z0-9.\-_ ]/g, '_').trim();
  return clean || `resume-${Date.now()}`;
}

function guessNameFromFilename(fileName: string): string {
  const base = fileName.replace(/\.[a-zA-Z0-9]+$/, '');
  const cleaned = base.replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned || 'Unknown Candidate';
}

function normalizeExtractText(v: string): string {
  return v
    .replace(/[•●▪◦◆▶►]/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCaseName(v: string): string {
  return v
    .toLowerCase()
    .split(/\s+/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

function extractEmailCandidates(raw: string): string[] {
  const normalized = raw
    .replace(/\s*\(?at\)?\s*/gi, '@')
    .replace(/\s*\(?dot\)?\s*/gi, '.')
    .replace(/\s*\[\s*at\s*\]\s*/gi, '@')
    .replace(/\s*\[\s*dot\s*\]\s*/gi, '.');
  const hits = normalized.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return [...new Set(hits.map((h) => h.toLowerCase()))];
}

function extractPhoneCandidates(raw: string): string[] {
  const out: string[] = [];
  const withSeparators = raw.match(/(?:\+?\d[\d\s().-]{7,}\d)/g) || [];
  for (const item of withSeparators) {
    const digits = item.replace(/\D/g, '');
    if (digits.length >= 9 && digits.length <= 13) out.push(item.trim());
  }
  const contiguous = raw.match(/(?<!\d)(\+?\d{9,13})(?!\d)/g) || [];
  for (const item of contiguous) {
    const digits = item.replace(/\D/g, '');
    if (digits.length >= 9 && digits.length <= 13) out.push(item.trim());
  }
  return [...new Set(out)];
}

function chooseBestPhone(candidates: string[]): string | null {
  if (!candidates.length) return null;
  const ranked = [...candidates].sort((a, b) => {
    const da = a.replace(/\D/g, '').length;
    const db = b.replace(/\D/g, '').length;
    const aIntl = a.trim().startsWith('+') ? 1 : 0;
    const bIntl = b.trim().startsWith('+') ? 1 : 0;
    return (bIntl - aIntl) || Math.abs(10 - da) - Math.abs(10 - db);
  });
  return ranked[0] || null;
}

function inferNameFromText(parsedText: string): string | null {
  const lines = parsedText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 24);
  const blacklist = /(resume|curriculum|vitae|email|phone|mobile|contact|linkedin|github|objective|summary|profile)/i;
  for (const line of lines) {
    if (line.length < 3 || line.length > 80) continue;
    if (line.includes('@')) continue;
    if (/\d/.test(line)) continue;
    if (blacklist.test(line)) continue;
    const parts = line.split(/\s+/).filter(Boolean);
    if (parts.length < 2 || parts.length > 4) continue;
    const alphabeticParts = parts.filter((p) => /^[A-Za-z][A-Za-z'`.-]*$/.test(p));
    if (alphabeticParts.length < 2) continue;
    const candidate = alphabeticParts.join(' ');
    const hasTitleCase = alphabeticParts.every((p) => /^[A-Z][a-z'`.-]*$/.test(p));
    const hasAllCaps = alphabeticParts.every((p) => /^[A-Z'`.-]+$/.test(p));
    if (hasTitleCase) return candidate;
    if (hasAllCaps) return titleCaseName(candidate);
  }
  return null;
}

function mergeHints(fileName: string, parsedText: string): { name: string; phone: string | null; email: string | null } {
  const normalizedText = normalizeExtractText(parsedText);
  const combined = `${fileName}\n${normalizedText}`;
  const email = extractEmailCandidates(combined)[0] || null;
  const phone = chooseBestPhone(extractPhoneCandidates(combined));
  const name = inferNameFromText(parsedText) || guessNameFromFilename(fileName);
  return { name: name.slice(0, 120), phone, email };
}

function linesFromText(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length >= 2 && l.length <= 140);
}

function compactText(raw: string): string {
  return raw
    .replace(/\u0000/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeEmail(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase();
}

function normalizePhone(value: string | null | undefined): string {
  return String(value || '').replace(/\D/g, '');
}

const CLEAN_PHONE_INPUT_RE = /^[+\d\s()\-]*$/;

export function isPipelinePhoneInputClean(raw: string): boolean {
  const value = String(raw || '').trim();
  if (!value) return false;
  if (!CLEAN_PHONE_INPUT_RE.test(value)) return false;
  return /\d/.test(value);
}

export function normalizeDialDestination(raw: string): string {
  const cleaned = String(raw || '').replace(/[^\d+]/g, '').trim();
  if (!cleaned) return '';
  const normalizedPlus = cleaned.startsWith('+')
    ? `+${cleaned.slice(1).replace(/\+/g, '')}`
    : cleaned.replace(/\+/g, '');
  if (normalizedPlus.startsWith('+1')) return normalizedPlus.slice(1);
  if (normalizedPlus.startsWith('+')) return normalizedPlus.slice(1);
  return normalizedPlus;
}

export function readPipelineCandidatePhone(candidate: Pick<PipelineCandidate, 'phone' | 'metadata'>): {
  effectivePhone: string;
  overridePhone: string | null;
  originalExtractedPhone: string | null;
} {
  const metadata = candidate?.metadata && typeof candidate.metadata === 'object'
    ? (candidate.metadata as Record<string, unknown>)
    : {};
  const overridePhoneRaw = metadata.phone_override;
  const originalExtractedRaw = metadata.phone_original_extracted;
  const overridePhone = typeof overridePhoneRaw === 'string' && overridePhoneRaw.trim()
    ? overridePhoneRaw.trim()
    : null;
  const originalExtractedPhone = typeof originalExtractedRaw === 'string' && originalExtractedRaw.trim()
    ? originalExtractedRaw.trim()
    : null;
  const effectivePhone = overridePhone || String(candidate.phone || '').trim();
  return {
    effectivePhone,
    overridePhone,
    originalExtractedPhone,
  };
}

function normalizeName(value: string | null | undefined): string {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ');
}

function candidateMetadata(record: { metadata?: unknown } | null | undefined): Record<string, unknown> {
  return record?.metadata && typeof record.metadata === 'object'
    ? (record.metadata as Record<string, unknown>)
    : {};
}

function sourceCandidateIdFromMetadata(metadata: Record<string, unknown>): string {
  return String(metadata.source_candidate_id || '').trim();
}

function isModernJourneyPipelineMetadata(metadata: Record<string, unknown>): boolean {
  const queueVersion = String(metadata.pipeline_queue_version || '').trim().toLowerCase();
  const sourceOrigin = String(metadata.source_origin || '').trim().toLowerCase();
  return queueVersion === 'v2' || sourceOrigin === 'admin_push' || sourceOrigin === 'checkin_journey';
}

function isAdminPushJourneyPipelineMetadata(metadata: Record<string, unknown>): boolean {
  const sourceOrigin = String(metadata.source_origin || '').trim().toLowerCase();
  return sourceOrigin === 'admin_push';
}

function mergeCallContextMetadata(
  existing: Record<string, unknown> | null | undefined,
  callContext?: PipelineCallContext | null,
): Record<string, unknown> | null {
  if (!callContext) return existing ?? null;
  const extension = String(callContext.extension || '').trim();
  const dialingLocale = String(callContext.dialingLocale || '').trim();
  if (!extension && !dialingLocale) return existing ?? null;
  return {
    ...(existing || {}),
    call_context: {
      extension: extension || null,
      dialing_locale: dialingLocale || null,
    },
  };
}

type SupabaseErrorLike = {
  message?: unknown;
  details?: unknown;
  hint?: unknown;
  code?: unknown;
};

function normalizeSupabaseError(error: unknown): SupabaseErrorLike | null {
  if (!error || typeof error !== 'object') return null;
  return error as SupabaseErrorLike;
}

export function stringifySupabaseError(error: unknown): string {
  if (error instanceof Error) {
    const msg = String(error.message || '').trim();
    if (msg && msg !== '[object Object]') return msg;
  }

  const normalized = normalizeSupabaseError(error);
  if (normalized) {
    const message = String(normalized.message || '').trim();
    const details = String(normalized.details || '').trim();
    const hint = String(normalized.hint || '').trim();
    const code = String(normalized.code || '').trim();
    const parts: string[] = [];
    if (message) parts.push(message);
    if (details && details !== message) parts.push(`Details: ${details}`);
    if (hint && hint !== message && hint !== details) parts.push(`Hint: ${hint}`);
    if (!parts.length && code) parts.push(`Code: ${code}`);
    if (parts.length) return parts.join(' ');
  }

  const raw = String(error || '').trim();
  if (raw && raw !== '[object Object]') return raw;
  return 'Unexpected error.';
}

function isCallRecordInsertFallbackEligible(error: unknown): boolean {
  const normalized = normalizeSupabaseError(error);
  if (!normalized) return false;
  const code = String(normalized.code || '').trim().toUpperCase();
  const combined = `${String(normalized.message || '')} ${String(normalized.details || '')} ${String(normalized.hint || '')}`
    .toLowerCase();
  if (code === '23514') return true; // check_violation (commonly Booked constraint drift)
  if (code === '42703' || code === 'PGRST204') return true; // missing/unknown columns
  if (code === '42P01') return true; // missing table in not-yet-migrated env
  return (
    combined.includes('pipeline_call_records') ||
    combined.includes('check constraint') ||
    combined.includes('violates check constraint') ||
    combined.includes('does not exist') ||
    combined.includes('schema cache') ||
    combined.includes('booked')
  );
}

export function readCallRecordMeta(record: Pick<PipelineCallRecord, 'threecx_metadata'>): {
  callbackAt: string | null;
  bookedSubtype: string | null;
} {
  const meta = record.threecx_metadata && typeof record.threecx_metadata === 'object'
    ? (record.threecx_metadata as Record<string, unknown>)
    : {};
  return {
    callbackAt: typeof meta.callback_at === 'string' ? meta.callback_at : null,
    bookedSubtype: typeof meta.booked_subtype === 'string' ? meta.booked_subtype : null,
  };
}

function firstMatchingLine(lines: string[], re: RegExp): string | null {
  const hit = lines.find((l) => re.test(l));
  return hit ? hit.slice(0, 160) : null;
}

function extractYearsExperience(raw: string): string | null {
  const direct = raw.match(/(\d{1,2})\s*\+?\s*(?:years|yrs)\b/i);
  if (direct) return `${direct[1]}+ years`;
  const verbose = raw.match(/experience[^.\n]{0,80}?(\d{1,2})\s*\+?\s*(?:years|yrs)\b/i);
  if (verbose) return `${verbose[1]}+ years`;
  return null;
}

function extractEducation(lines: string[]): string | null {
  return firstMatchingLine(
    lines,
    /(bachelor|master|mba|phd|diploma|degree|university|college|polytechnic|b\.sc|m\.sc|bba|ba\b)/i,
  );
}

function extractLocation(lines: string[]): string | null {
  const hit = lines.find((l) => {
    if (/@|\d{4,}/.test(l)) return false;
    if (l.length < 4 || l.length > 60) return false;
    return /,/.test(l) && /\b(ON|BC|AB|MB|SK|NS|NB|NL|PE|QC|USA|CANADA|UK)\b/i.test(l);
  });
  return hit ? hit.slice(0, 120) : null;
}

function extractTitle(lines: string[]): string | null {
  return firstMatchingLine(
    lines.slice(0, 30),
    /(advisor|manager|specialist|representative|associate|consultant|coordinator|analyst|developer|engineer|recruiter|sales|executive|administrator|designer|architect)/i,
  );
}

function extractSection(raw: string, headerRegex: RegExp): string | null {
  const normalized = raw.replace(/\r/g, '\n');
  const headerMatch = normalized.match(headerRegex);
  if (!headerMatch || headerMatch.index == null) return null;
  const start = headerMatch.index + headerMatch[0].length;
  const tail = normalized.slice(start);
  const endMatch = tail.match(/\n\s*(experience|education|skills?|projects?|certifications?|summary|profile|objective)\b\s*[:\-]?\s*\n?/i);
  const chunk = endMatch ? tail.slice(0, endMatch.index) : tail.slice(0, 420);
  const cleaned = compactText(chunk).replace(/\n/g, ' ');
  if (!cleaned || cleaned.length < 16) return null;
  return cleaned.slice(0, 320);
}

function extractSkillsSummary(lines: string[], raw: string): string | null {
  const section = extractSection(raw, /\bskills?\b\s*[:\-]?\s*\n?/i);
  if (section) return section.slice(0, 220);
  const idx = lines.findIndex((l) => /skills?/i.test(l));
  if (idx >= 0) {
    const slice = lines.slice(idx + 1, idx + 4).join(', ');
    const clean = slice.replace(/\s*,\s*/g, ', ').trim();
    if (clean.length >= 6) return clean.slice(0, 220);
  }
  const top = lines.filter((l) => /crm|excel|salesforce|communication|leadership|customer service|javascript|python|accounting/i.test(l));
  if (top.length > 0) return top.slice(0, 3).join(', ').slice(0, 220);
  return null;
}

function extractWorkSummary(lines: string[], raw: string): string | null {
  const expSection = extractSection(raw, /\b(work\s+)?experience\b\s*[:\-]?\s*\n?/i);
  if (expSection) return expSection.slice(0, 280);
  const summarySection = extractSection(raw, /\b(summary|profile|objective)\b\s*[:\-]?\s*\n?/i);
  if (summarySection) return summarySection.slice(0, 280);
  const idx = lines.findIndex((l) => /(summary|profile|objective|experience)/i.test(l));
  if (idx >= 0) {
    const text = lines.slice(idx + 1, idx + 5).join(' ').trim();
    if (text.length >= 20) return text.slice(0, 280);
  }
  return null;
}

function buildOcrProfile(parsedText: string): PipelineCandidateProfile {
  const prepared = compactText(parsedText);
  const lines = linesFromText(prepared);
  return {
    current_title: extractTitle(lines),
    location: extractLocation(lines),
    total_experience_years: extractYearsExperience(prepared),
    education_highest: extractEducation(lines),
    skills_summary: extractSkillsSummary(lines, prepared),
    work_summary: extractWorkSummary(lines, prepared),
  };
}

async function extractTextFromPdf(file: File): Promise<string> {
  try {
    const pdfjs = await import('pdfjs-dist');
    const workerSrc = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    (pdfjs as any).GlobalWorkerOptions.workerSrc = workerSrc.default;
    const buf = await file.arrayBuffer();
    const task = (pdfjs as any).getDocument({ data: buf });
    const doc = await task.promise;
    const pagesToRead = Math.min(doc.numPages, 8);
    let out = '';
    for (let i = 1; i <= pagesToRead; i += 1) {
      const page = await doc.getPage(i);
      const text = await page.getTextContent();
      const chunks: string[] = [];
      for (const it of text.items as Array<any>) {
        const part = String(it?.str || '');
        if (!part) continue;
        chunks.push(part);
        if (it?.hasEOL) chunks.push('\n');
        else chunks.push(' ');
      }
      out += `\n${chunks.join('')}`;
    }
    // OCR fallback for scanned PDFs with little/no text layer.
    if (normalizeExtractText(out).length < 260) {
      try {
        const worker = await createWorker('eng');
        const pagesForOcr = Math.min(doc.numPages, 3);
        for (let i = 1; i <= pagesForOcr; i += 1) {
          const page = await doc.getPage(i);
          const viewport = page.getViewport({ scale: 2 });
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (ctx) {
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            await page.render({ canvasContext: ctx, viewport }).promise;
            const result = await worker.recognize(canvas);
            const ocrText = String(result.data.text || '');
            if (normalizeExtractText(ocrText).length > 40) {
              out += `\n${ocrText}`;
            }
          }
        }
        await worker.terminate();
      } catch {
        // ignore OCR fallback failures
      }
    }
    return out;
  } catch {
    return '';
  }
}

async function extractTextFromImage(file: File): Promise<string> {
  try {
    const worker = await createWorker('eng');
    const result = await worker.recognize(file);
    await worker.terminate();
    return String(result.data.text || '');
  } catch {
    return '';
  }
}

async function extractTextFromWord(file: File): Promise<string> {
  try {
    const arr = await file.arrayBuffer();
    const res = await mammoth.extractRawText({ arrayBuffer: arr });
    return String(res.value || '');
  } catch {
    return '';
  }
}

async function extractCandidateHints(file: File, cleanName: string): Promise<{ name: string; phone: string | null; email: string | null }> {
  const parsed = await extractResumeParsedText(file, cleanName);
  return mergeHints(cleanName, parsed);
}

async function extractResumeParsedText(file: File, cleanName: string): Promise<string> {
  const mime = (file.type || '').toLowerCase();
  let parsed = '';
  if (mime.includes('pdf')) parsed = await extractTextFromPdf(file);
  else if (mime.startsWith('image/')) parsed = await extractTextFromImage(file);
  else if (mime.includes('word') || cleanName.toLowerCase().endsWith('.docx')) parsed = await extractTextFromWord(file);
  else if (mime.includes('text') || cleanName.toLowerCase().endsWith('.txt') || cleanName.toLowerCase().endsWith('.rtf')) {
    parsed = await file.text().catch(() => '');
  }
  return parsed;
}

async function extractCandidateProfile(file: File, cleanName: string): Promise<PipelineCandidateProfile> {
  const parsed = await extractResumeParsedText(file, cleanName);
  return buildOcrProfile(parsed);
}

function fileViewerKind(resume: PipelineResume): 'pdf' | 'image' | 'other' {
  const mime = String(resume.mime_type || '').toLowerCase();
  if (resume.converted_pdf_url || mime.includes('pdf')) return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  return 'other';
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function resumeExtension(resume: PipelineResume): string {
  const name = String(resume.original_filename || '').trim().toLowerCase();
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1) : '';
}

const PIPELINE_CANDIDATE_SELECT =
  'id, full_name, phone, email, source, journey_stage, status, uploader_user_id, uploader_label, scheduled_for, metadata, created_at, updated_at';

type PipelineViewerScope = {
  userId: string | null;
  hasFullVisibility: boolean;
};

async function resolvePipelineViewerScope(): Promise<PipelineViewerScope> {
  const [{ data: auth }, profile] = await Promise.all([
    supabase.auth.getUser(),
    getCurrentUserProfile().catch(() => null),
  ]);
  const userId = auth.user?.id ?? null;
  const role = String(profile?.role || '').trim().toLowerCase();
  const hasFullVisibility = role === 'admin' || role === 'leadership';
  return { userId, hasFullVisibility };
}

function applyPipelineUploaderScope<TQuery extends { eq: (column: string, value: unknown) => TQuery }>(
  query: TQuery,
  scope: PipelineViewerScope,
): TQuery {
  if (scope.hasFullVisibility) return query;
  if (!scope.userId) return query.eq('id', '__no_pipeline_access__');
  return query.eq('uploader_user_id', scope.userId);
}

async function canAccessPipelineCandidate(candidateId: string): Promise<boolean> {
  const scope = await resolvePipelineViewerScope();
  let query = supabase
    .from('pipeline_candidates')
    .select('id')
    .eq('id', candidateId);
  query = applyPipelineUploaderScope(query, scope);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return Boolean(data?.id);
}

async function listPipelineCandidatesUnscoped(): Promise<PipelineCandidate[]> {
  const { data, error } = await supabase
    .from('pipeline_candidates')
    .select(PIPELINE_CANDIDATE_SELECT)
    .order('updated_at', { ascending: false })
    .limit(2000);
  if (error) throw error;
  return (data || []) as PipelineCandidate[];
}

export function getPipelineResumeDisplayUrl(resume: PipelineResume): string | null {
  return resume.converted_pdf_url || resume.public_url;
}

export function getPipelineResumeViewerKind(resume: PipelineResume): 'pdf' | 'image' | 'other' {
  return fileViewerKind(resume);
}

export function getPipelineResumeOpenInNewTabUrl(resume: PipelineResume): string | null {
  const displayUrl = getPipelineResumeDisplayUrl(resume);
  if (!displayUrl) return null;

  // Preserve current inline-friendly behavior for PDF/image resumes.
  if (getPipelineResumeViewerKind(resume) !== 'other') return displayUrl;

  // If a converted PDF exists for a non-inline source, prefer it for best tab viewing.
  if (resume.converted_pdf_url) return resume.converted_pdf_url;

  const sourceUrl = String(resume.public_url || '').trim();
  if (!sourceUrl || !isHttpUrl(sourceUrl)) return sourceUrl || null;

  const ext = resumeExtension(resume);
  const mime = String(resume.mime_type || '').toLowerCase();

  if (ext === 'doc' || ext === 'docx') {
    return `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(sourceUrl)}`;
  }

  if (ext === 'rtf' || ext === 'txt' || mime.startsWith('text/') || mime.includes('rtf')) {
    return `https://docs.google.com/gview?embedded=1&url=${encodeURIComponent(sourceUrl)}`;
  }

  return sourceUrl;
}

export async function listPipelineCandidates(): Promise<PipelineCandidate[]> {
  const scope = await resolvePipelineViewerScope();
  let query = supabase
    .from('pipeline_candidates')
    .select(PIPELINE_CANDIDATE_SELECT)
    .order('updated_at', { ascending: false })
    .limit(2000);
  query = applyPipelineUploaderScope(query, scope);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as PipelineCandidate[];
}

export async function listPipelineManualCandidates(): Promise<PipelineCandidate[]> {
  const rows = await listPipelineCandidates();
  return rows.filter((c) => String(c.source || '').toLowerCase() !== 'journey_upload');
}

export async function listPipelineAdminPushedJourneyCandidates(): Promise<PipelineCandidate[]> {
  const rows = await listPipelineCandidates();
  return rows.filter((c) => {
    const source = String(c.source || '').toLowerCase();
    if (source !== 'journey_upload') return false;
    const metadata = c.metadata && typeof c.metadata === 'object' ? c.metadata : {};
    const origin = String((metadata as Record<string, unknown>).source_origin || '').trim().toLowerCase();
    return origin === 'admin_push';
  });
}

export async function listPipelineFreshJourneyCandidates(): Promise<PipelineCandidate[]> {
  const rows = await listPipelineCandidates();
  const queue = rows.filter((c) => {
    const source = String(c.source || '').toLowerCase();
    const stage = String(c.journey_stage || '').toLowerCase();
    const status = String(c.status || '').toLowerCase();
    const metadata = c.metadata && typeof c.metadata === 'object' ? c.metadata : {};
    const touchedAt = String((metadata as Record<string, unknown>).pipeline_touched_at || '').trim();
    const queueVersion = String((metadata as Record<string, unknown>).pipeline_queue_version || '').trim().toLowerCase();
    return source === 'journey_upload' && stage === 'new' && status === 'open' && !touchedAt && queueVersion === 'v2';
  });
  if (!queue.length) return [];

  const queueIds = new Set(queue.map((c) => c.id));
  const { data: resumes, error } = await supabase
    .from('pipeline_resumes')
    .select('candidate_id,resume_source')
    .in('candidate_id', [...queueIds])
    .limit(4000);

  if (error) {
    // Backward compatibility before resume_source migration.
    const { data: legacyResumes, error: legacyErr } = await supabase
      .from('pipeline_resumes')
      .select('candidate_id')
      .in('candidate_id', [...queueIds])
      .limit(4000);
    if (legacyErr) throw legacyErr;
    const ids = new Set((legacyResumes || []).map((r) => String((r as { candidate_id?: string }).candidate_id || '')).filter(Boolean));
    return queue.filter((c) => ids.has(c.id));
  }

  const candidateIdsWithJourneyResume = new Set(
    (resumes || [])
      .filter((r) => String((r as { resume_source?: string }).resume_source || 'journey_upload') === 'journey_upload')
      .map((r) => String((r as { candidate_id?: string }).candidate_id || ''))
      .filter(Boolean),
  );
  const candidatesWithJourneyResume = queue.filter((c) => candidateIdsWithJourneyResume.has(c.id));
  if (!candidatesWithJourneyResume.length) return [];

  const ids = candidatesWithJourneyResume.map((c) => c.id);
  const [
    { data: notes, error: notesErr },
    { data: evals, error: evalErr },
    { data: logs, error: logsErr },
    { data: records, error: recordsErr },
  ] = await Promise.all([
    supabase.from('pipeline_notes').select('candidate_id').in('candidate_id', ids).limit(5000),
    supabase.from('pipeline_evaluations').select('candidate_id').in('candidate_id', ids).limit(5000),
    supabase.from('pipeline_call_logs').select('candidate_id').in('candidate_id', ids).limit(5000),
    supabase.from('pipeline_call_records').select('candidate_id').in('candidate_id', ids).limit(5000),
  ]);

  if (notesErr) throw notesErr;
  if (evalErr) throw evalErr;
  if (logsErr) throw logsErr;
  if (recordsErr) {
    const msg = String(recordsErr.message || '');
    const missing = recordsErr.code === '42P01' || msg.includes('pipeline_call_records');
    if (!missing) throw recordsErr;
  }

  const touchedIds = new Set<string>();
  for (const row of notes || []) touchedIds.add(String((row as { candidate_id?: string }).candidate_id || ''));
  for (const row of evals || []) touchedIds.add(String((row as { candidate_id?: string }).candidate_id || ''));
  for (const row of logs || []) touchedIds.add(String((row as { candidate_id?: string }).candidate_id || ''));
  for (const row of records || []) touchedIds.add(String((row as { candidate_id?: string }).candidate_id || ''));

  return candidatesWithJourneyResume.filter((c) => !touchedIds.has(c.id));
}

export async function getPipelineUserCallSettings(): Promise<PipelineUserCallSettings | null> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return null;
  const { data, error } = await supabase
    .from('pipeline_user_call_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data || null) as PipelineUserCallSettings | null;
}

export async function savePipelineUserCallSettings(input: {
  extension?: string | null;
  dialingLocale?: string | null;
  dailyUploadTarget?: number | null;
  dailyWebinarBookingTarget?: number | null;
}): Promise<PipelineUserCallSettings> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error('You must be signed in.');
  const payloadBase = {
    user_id: userId,
    extension: input.extension?.trim() || null,
    dialing_locale: input.dialingLocale?.trim() || null,
    updated_at: new Date().toISOString(),
  };
  const payloadWithDailyTarget = {
    ...payloadBase,
    daily_upload_target: Number.isFinite(input.dailyUploadTarget)
      ? Math.max(0, Math.round(Number(input.dailyUploadTarget)))
      : null,
    daily_webinar_booking_target: Number.isFinite(input.dailyWebinarBookingTarget)
      ? Math.max(0, Math.round(Number(input.dailyWebinarBookingTarget)))
      : null,
  };
  const isMissingColumn = (
    error: { code?: string | null; message?: string | null; details?: string | null; hint?: string | null } | null | undefined,
    column: 'daily_upload_target' | 'daily_webinar_booking_target',
  ): boolean => {
    if (!error) return false;
    const combined = `${String(error.message || '')} ${String(error.details || '')} ${String(error.hint || '')}`.toLowerCase();
    const mentionsColumn = combined.includes(column);
    // 42703: undefined column, PGRST204: column not found in schema cache.
    if ((error.code === '42703' || error.code === 'PGRST204') && mentionsColumn) return true;
    return mentionsColumn && (
      combined.includes('does not exist') ||
      combined.includes('could not find the')
    );
  };

  const normalizeSettingsRow = (row: Record<string, unknown>): PipelineUserCallSettings => ({
    ...(row as unknown as PipelineUserCallSettings),
    daily_upload_target: typeof row.daily_upload_target === 'number' ? row.daily_upload_target : null,
    daily_webinar_booking_target:
      typeof row.daily_webinar_booking_target === 'number' ? row.daily_webinar_booking_target : null,
  });

  // Avoid upsert/on_conflict to support environments where unique constraints or schema cache differ.
  const writeAndSelect = async (payload: Record<string, unknown>) => {
    const { data: existingRow, error: existingErr } = await supabase
      .from('pipeline_user_call_settings')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (existingErr && existingErr.code !== 'PGRST116') throw existingErr;

    if (existingRow) {
      const { user_id: _ignored, ...updatePayload } = payload;
      return supabase
        .from('pipeline_user_call_settings')
        .update(updatePayload)
        .eq('user_id', userId)
        .select('*')
        .single();
    }

    return supabase
      .from('pipeline_user_call_settings')
      .insert(payload)
      .select('*')
      .single();
  };

  const { data, error } = await writeAndSelect(payloadWithDailyTarget as Record<string, unknown>);
  if (!error) return normalizeSettingsRow(data as Record<string, unknown>);

  // Backward compatibility: retry with progressively smaller payload when new columns are missing.
  const uploadMissing = isMissingColumn(error, 'daily_upload_target');
  const webinarMissing = isMissingColumn(error, 'daily_webinar_booking_target');
  if (uploadMissing || webinarMissing) {
    const retryPayload: Record<string, unknown> = { ...payloadWithDailyTarget } as Record<string, unknown>;
    if (uploadMissing) delete retryPayload.daily_upload_target;
    if (webinarMissing) delete retryPayload.daily_webinar_booking_target;
    const { data: retryData, error: retryError } = await writeAndSelect(retryPayload);
    if (!retryError) {
      return normalizeSettingsRow(retryData as Record<string, unknown>);
    }

    // Final fallback: base columns only (works even when both target columns are absent).
    const { data: baseData, error: baseError } = await writeAndSelect(payloadBase as Record<string, unknown>);
    if (baseError) throw baseError;
    return normalizeSettingsRow(baseData as Record<string, unknown>);
  }

  throw error;
}

export async function markPipelineCandidateTouched(candidateId: string): Promise<void> {
  const { data: row, error: getErr } = await supabase
    .from('pipeline_candidates')
    .select('metadata')
    .eq('id', candidateId)
    .maybeSingle();
  if (getErr) throw getErr;
  const metadata = row?.metadata && typeof row.metadata === 'object'
    ? { ...(row.metadata as Record<string, unknown>) }
    : {};
  if (metadata.pipeline_touched_at) return;
  metadata.pipeline_touched_at = new Date().toISOString();
  const { error } = await supabase
    .from('pipeline_candidates')
    .update({ metadata })
    .eq('id', candidateId);
  if (error) throw error;
}

export async function listPipelineCandidateActivityTimeline(candidateId: string): Promise<PipelineActivityTimelineItem[]> {
  if (!(await canAccessPipelineCandidate(candidateId))) return [];
  const [
    { data: notes, error: notesError },
    { data: evals, error: evalError },
    { data: logs, error: logsError },
    { data: records, error: recordsError },
  ] = await Promise.all([
    supabase.from('pipeline_notes').select('*').eq('candidate_id', candidateId).order('created_at', { ascending: false }).limit(300),
    supabase.from('pipeline_evaluations').select('*').eq('candidate_id', candidateId).order('created_at', { ascending: false }).limit(300),
    supabase.from('pipeline_call_logs').select('*').eq('candidate_id', candidateId).order('created_at', { ascending: false }).limit(400),
    supabase.from('pipeline_call_records').select('*').eq('candidate_id', candidateId).order('created_at', { ascending: false }).limit(400),
  ]);
  if (notesError) throw notesError;
  if (evalError) throw evalError;
  if (logsError) throw logsError;
  if (recordsError) throw recordsError;

  const output: PipelineActivityTimelineItem[] = [];
  for (const row of notes || []) {
    output.push({
      id: String((row as any).id),
      kind: 'note',
      title: 'Note added',
      body: String((row as any).body || '').trim() || null,
      actor_label: (row as any).author_label ?? null,
      created_at: String((row as any).created_at),
      metadata: null,
    });
  }
  for (const row of evals || []) {
    output.push({
      id: String((row as any).id),
      kind: 'evaluation',
      title: 'Evaluation saved',
      body: String((row as any).comments || '').trim() || null,
      actor_label: (row as any).created_by_label ?? null,
      created_at: String((row as any).created_at),
      metadata: {
        fit_score: (row as any).fit_score ?? null,
        disposition: (row as any).disposition ?? null,
        next_action: (row as any).next_action ?? null,
        journey_stage: (row as any).journey_stage ?? null,
      },
    });
  }
  for (const row of logs || []) {
    output.push({
      id: String((row as any).id),
      kind: 'call_log',
      title: `Log: ${String((row as any).action || 'action')}`,
      body: String((row as any).outcome || '').trim() || null,
      actor_label: (row as any).created_by_label ?? null,
      created_at: String((row as any).created_at),
      metadata: (row as any).request_payload ?? (row as any).response_payload ?? null,
    });
  }
  for (const row of records || []) {
    output.push({
      id: String((row as any).id),
      kind: 'call_record',
      title: `Disposition: ${String((row as any).disposition || 'unknown')}`,
      body: String((row as any).comment || '').trim() || null,
      actor_label: (row as any).recruiter_label ?? null,
      created_at: String((row as any).created_at),
      metadata: {
        dialed_number: (row as any).dialed_number ?? null,
        dial_started_at: (row as any).dial_started_at ?? null,
        disposed_at: (row as any).disposed_at ?? null,
        threecx_metadata: (row as any).threecx_metadata ?? null,
        callback_at: ((row as any).threecx_metadata as Record<string, unknown> | null)?.callback_at ?? null,
        booked_subtype: ((row as any).threecx_metadata as Record<string, unknown> | null)?.booked_subtype ?? null,
      },
    });
  }
  output.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return output;
}

type JourneySourceRow = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  applicant_questionnaire?: Record<string, unknown> | null;
};

async function upsertJourneyRowsIntoPipeline(
  rows: JourneySourceRow[],
  sourceOrigin: 'checkin_journey' | 'admin_push',
): Promise<{ importedCandidates: number; importedResumes: number }> {
  if (!rows.length) return { importedCandidates: 0, importedResumes: 0 };
  const existingCandidates = await listPipelineCandidatesUnscoped();
  const bySourceCandidateId = new Map<string, PipelineCandidate>();
  for (const c of existingCandidates) {
    if (String(c.source || '').trim().toLowerCase() !== 'journey_upload') continue;
    const metadata = candidateMetadata(c);
    const shouldUseForDedupe = sourceOrigin === 'admin_push'
      ? isAdminPushJourneyPipelineMetadata(metadata)
      : isModernJourneyPipelineMetadata(metadata);
    if (!shouldUseForDedupe) continue;
    const sourceCandidateId = sourceCandidateIdFromMetadata(metadata);
    if (sourceCandidateId) bySourceCandidateId.set(sourceCandidateId, c);
  }

  let importedCandidates = 0;
  let importedResumes = 0;
  for (const row of rows) {
    const sourceCandidateId = String(row.id || '').trim();
    if (!sourceCandidateId) continue;
    const aq = (row.applicant_questionnaire || {}) as Record<string, unknown>;
    const rawResumeUrls = Array.isArray(aq.resumeUrls) ? aq.resumeUrls : [];
    const resumeUrls = rawResumeUrls.map((x) => String(x || '').trim()).filter(Boolean);
    if (resumeUrls.length === 0) continue;

    let matched = bySourceCandidateId.get(sourceCandidateId) || null;
    if (!matched) {
      const fullName = `${String(row.first_name || '').trim()} ${String(row.last_name || '').trim()}`.trim() || 'Unknown Candidate';
      const email = normalizeEmail(row.email);
      const phone = normalizePhone(row.phone);
      const { data: inserted, error: insertError } = await supabase
        .from('pipeline_candidates')
        .insert({
          full_name: fullName,
          email: email || null,
          phone: phone || null,
          source: 'journey_upload',
          metadata: {
            source_candidate_id: sourceCandidateId,
            source_origin: sourceOrigin,
            pipeline_queue_version: 'v2',
          },
        })
        .select('id, full_name, phone, email, source, journey_stage, status, uploader_user_id, uploader_label, scheduled_for, metadata, created_at, updated_at')
        .single();
      if (insertError) throw insertError;
      matched = inserted as PipelineCandidate;
      bySourceCandidateId.set(sourceCandidateId, matched);
      importedCandidates += 1;
    }

    const { data: existingResumes, error: existingError } = await supabase
      .from('pipeline_resumes')
      .select('id, public_url, source_resume_url')
      .eq('candidate_id', matched.id);
    if (existingError) throw existingError;
    const knownUrls = new Set(
      (existingResumes || [])
        .flatMap((x) => [String((x as { public_url?: string }).public_url || '').trim(), String((x as { source_resume_url?: string }).source_resume_url || '').trim()])
        .filter(Boolean),
    );
    for (const resumeUrl of resumeUrls) {
      if (knownUrls.has(resumeUrl)) continue;
      const urlNoQuery = resumeUrl.split('?')[0] || resumeUrl;
      const filenameGuess = urlNoQuery.split('/').pop() || 'journey_resume.pdf';
      const lowerFileName = filenameGuess.toLowerCase();
      const inferredMime =
        lowerFileName.endsWith('.pdf') ? 'application/pdf'
          : lowerFileName.endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            : lowerFileName.endsWith('.doc') ? 'application/msword'
              : lowerFileName.endsWith('.txt') ? 'text/plain'
                : lowerFileName.endsWith('.rtf') ? 'application/rtf'
                  : null;
      const { error: resumeInsertError } = await supabase
        .from('pipeline_resumes')
        .insert({
          candidate_id: matched.id,
          storage_bucket: 'candidate-resumes',
          storage_path: `external:${sourceCandidateId}:${filenameGuess}`,
          public_url: resumeUrl,
          original_filename: filenameGuess,
          mime_type: inferredMime,
          size_bytes: null,
          conversion_status: 'not_required',
          converted_pdf_url: inferredMime === 'application/pdf' ? resumeUrl : null,
          resume_source: 'journey_upload',
          source_candidate_id: sourceCandidateId,
          source_resume_url: resumeUrl,
        });
      if (resumeInsertError) throw resumeInsertError;
      importedResumes += 1;
      knownUrls.add(resumeUrl);
    }
  }
  return { importedCandidates, importedResumes };
}

export async function syncJourneyResumesIntoPipeline(): Promise<{ importedCandidates: number; importedResumes: number }> {
  const { data: sourceRows, error: sourceError } = await supabase
    .from('candidates')
    .select('id, first_name, last_name, email, phone, status, admin_data, applicant_questionnaire')
    .order('timestamp', { ascending: false })
    .limit(2000);
  if (sourceError) throw sourceError;
  const journeyRows = (sourceRows || []).filter((row) => {
    const status = String((row as { status?: string }).status || '').trim().toLowerCase();
    if (status && !['new', 'open', 'pending', 'checked_in', 'checked in'].includes(status)) return false;
    const adminData = ((row as { admin_data?: Record<string, unknown> }).admin_data || {}) as Record<string, unknown>;
    const pipelineStage = String(adminData.pipelineStage || '').trim().toLowerCase();
    const progressedStages = new Set([
      'live career overview session attended',
      'leadership assessment form sent',
      'leadership form submitted, awaiting evaluation',
      'evaluation done',
      'interview scheduled',
      'final decision',
    ]);
    if (pipelineStage && progressedStages.has(pipelineStage)) return false;
    const aq = ((row as { applicant_questionnaire?: Record<string, unknown> }).applicant_questionnaire || {}) as Record<string, unknown>;
    const resumeUrls = Array.isArray(aq.resumeUrls) ? aq.resumeUrls : [];
    return resumeUrls.some((x) => String(x || '').trim().length > 0);
  }) as JourneySourceRow[];
  return upsertJourneyRowsIntoPipeline(journeyRows, 'checkin_journey');
}

export async function sendCandidatesToPipelineFromAdmin(candidateIds: string[]): Promise<{
  selected: number;
  withResumes: number;
  importedCandidates: number;
  importedResumes: number;
}> {
  const ids = [...new Set(candidateIds.map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return { selected: 0, withResumes: 0, importedCandidates: 0, importedResumes: 0 };
  const { data, error } = await supabase
    .from('candidates')
    .select('id, first_name, last_name, email, phone, applicant_questionnaire')
    .in('id', ids);
  if (error) throw error;
  const selectedRows = (data || []) as JourneySourceRow[];
  const withResumesRows = selectedRows.filter((row) => {
    const aq = (row.applicant_questionnaire || {}) as Record<string, unknown>;
    const resumeUrls = Array.isArray(aq.resumeUrls) ? aq.resumeUrls : [];
    return resumeUrls.some((x) => String(x || '').trim().length > 0);
  });
  const result = await upsertJourneyRowsIntoPipeline(withResumesRows, 'admin_push');
  return {
    selected: ids.length,
    withResumes: withResumesRows.length,
    importedCandidates: result.importedCandidates,
    importedResumes: result.importedResumes,
  };
}

export async function listSourceCandidateIdsInPipeline(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('pipeline_candidates')
    .select('metadata,source')
    .eq('source', 'journey_upload')
    .limit(5000);
  if (error) throw error;
  const ids = new Set<string>();
  for (const row of data || []) {
    const metadata = candidateMetadata(row);
    if (!isAdminPushJourneyPipelineMetadata(metadata)) continue;
    const id = sourceCandidateIdFromMetadata(metadata);
    if (id) ids.add(id);
  }
  return ids;
}

export async function getPipelineCandidateBundle(candidateId: string): Promise<PipelineCandidateBundle | null> {
  const scope = await resolvePipelineViewerScope();
  let candidateQuery = supabase
    .from('pipeline_candidates')
    .select(PIPELINE_CANDIDATE_SELECT)
    .eq('id', candidateId);
  candidateQuery = applyPipelineUploaderScope(candidateQuery, scope);
  const { data: candidate, error: cErr } = await candidateQuery.maybeSingle();
  if (cErr) throw cErr;
  if (!candidate) return null;

  const [
    { data: resumes, error: rErr },
    { data: notes, error: nErr },
    { data: evaluations, error: eErr },
    { data: callLogs, error: lErr },
    { data: callRecords, error: crErr },
  ] = await Promise.all([
    supabase
      .from('pipeline_resumes')
      .select('*')
      .eq('candidate_id', candidateId)
      .order('created_at', { ascending: false }),
    supabase
      .from('pipeline_notes')
      .select('*')
      .eq('candidate_id', candidateId)
      .order('created_at', { ascending: false }),
    supabase
      .from('pipeline_evaluations')
      .select('*')
      .eq('candidate_id', candidateId)
      .order('created_at', { ascending: false }),
    supabase
      .from('pipeline_call_logs')
      .select('*')
      .eq('candidate_id', candidateId)
      .order('created_at', { ascending: false }),
    supabase
      .from('pipeline_call_records')
      .select('*')
      .eq('candidate_id', candidateId)
      .order('created_at', { ascending: false }),
  ]);

  if (rErr) throw rErr;
  if (nErr) throw nErr;
  if (eErr) throw eErr;
  if (lErr) throw lErr;
  if (crErr) {
    const msg = String(crErr.message || '');
    const missingTable = crErr.code === '42P01' || msg.includes('pipeline_call_records');
    if (!missingTable) throw crErr;
  }

  return {
    candidate: candidate as PipelineCandidate,
    resumes: (resumes || []) as PipelineResume[],
    notes: (notes || []) as PipelineNote[],
    evaluations: (evaluations || []) as PipelineEvaluation[],
    callLogs: (callLogs || []) as PipelineCallLog[],
    callRecords: crErr ? [] : ((callRecords || []) as PipelineCallRecord[]),
  };
}

async function invokePipelineConvertResume(body: Record<string, unknown>): Promise<void> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!supabaseUrl || !anonKey) return;
  const { data: s } = await supabase.auth.getSession();
  const token = s.session?.access_token;
  if (!token) return;
  await fetch(`${supabaseUrl}/functions/v1/pipeline-convert-resume`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

export async function triggerPipelineResumeConversion(resumeId: string): Promise<void> {
  await invokePipelineConvertResume({ resume_id: resumeId });
}

export async function bulkUploadPipelineResumes(
  files: File[],
  actorLabel?: string,
  onProgress?: (progress: PipelineUploadProgress) => void,
): Promise<{ created: PipelineCandidate[]; failed: Array<{ file: string; error: string }> }> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error('You must be signed in to upload resumes.');
  const created: PipelineCandidate[] = [];
  const failed: Array<{ file: string; error: string }> = [];
  const total = files.length;

  const emit = (
    index: number,
    fileName: string,
    stage: PipelineUploadStage,
    percent: number,
    message: string,
    error?: string,
  ) => {
    if (!onProgress) return;
    onProgress({
      index,
      total,
      fileName,
      stage,
      percent,
      processed: created.length + failed.length,
      succeeded: created.length,
      failed: failed.length,
      message,
      error,
    });
  };

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    try {
      emit(index, file.name, 'starting', 5, 'Preparing file...');
      const cleanName = sanitizeFilename(file.name);
      emit(index, file.name, 'extracting', 18, 'Reading and extracting resume text...');
      const parsedText = await extractResumeParsedText(file, cleanName);
      const hints = mergeHints(cleanName, parsedText);
      const profile = buildOcrProfile(parsedText);
      emit(index, file.name, 'saving_candidate', 35, 'Creating candidate record...');
      const { data: cand, error: cErr } = await supabase
        .from('pipeline_candidates')
        .insert({
          full_name: hints.name,
          phone: hints.phone,
          email: hints.email,
          uploader_user_id: userId,
          uploader_label: actorLabel ?? null,
          source: 'bulk_upload',
          metadata: {
            original_file_name: file.name,
            ocr_profile: profile,
            ocr_text_excerpt: compactText(parsedText).slice(0, 12000),
          },
        })
        .select('id, full_name, phone, email, source, journey_stage, status, uploader_user_id, uploader_label, scheduled_for, metadata, created_at, updated_at')
        .single();
      if (cErr) throw cErr;
      const candidate = cand as PipelineCandidate;

      const path = `${candidate.id}/${Date.now()}-${cleanName}`;
      emit(index, file.name, 'uploading_file', 58, 'Uploading file to storage...');
      const { error: upErr } = await supabase.storage.from(PIPELINE_BUCKET).upload(path, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type || 'application/octet-stream',
      });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from(PIPELINE_BUCKET).getPublicUrl(path);

      const conversionStatus: PipelineResume['conversion_status'] = 'not_required';

      emit(index, file.name, 'creating_resume', 78, 'Saving resume metadata...');
      const { data: resume, error: rErr } = await supabase
        .from('pipeline_resumes')
        .insert({
          candidate_id: candidate.id,
          storage_bucket: PIPELINE_BUCKET,
          storage_path: path,
          public_url: pub.publicUrl,
          original_filename: file.name,
          mime_type: file.type || null,
          size_bytes: file.size,
          conversion_status: conversionStatus,
          resume_source: 'bulk_upload',
        })
        .select('*')
        .single();
      if (rErr) throw rErr;

      emit(index, file.name, 'queueing_conversion', 92, 'Preparing preview...');
      created.push(candidate);
      emit(index, file.name, 'completed', 100, 'Completed.');
    } catch (err) {
      const errorText = err instanceof Error ? err.message : String(err);
      failed.push({ file: file.name, error: errorText });
      emit(index, file.name, 'failed', 100, 'Failed.', errorText);
    }
  }
  return { created, failed };
}

export async function deletePipelineCandidate(candidateId: string): Promise<void> {
  const { data: resumes, error: rErr } = await supabase
    .from('pipeline_resumes')
    .select('storage_bucket,storage_path')
    .eq('candidate_id', candidateId);
  if (rErr) throw rErr;
  const grouped = new Map<string, string[]>();
  for (const row of resumes || []) {
    const bucket = String((row as any).storage_bucket || PIPELINE_BUCKET);
    const path = String((row as any).storage_path || '');
    if (!path) continue;
    if (!grouped.has(bucket)) grouped.set(bucket, []);
    grouped.get(bucket)!.push(path);
  }
  for (const [bucket, paths] of grouped.entries()) {
    if (paths.length) {
      await supabase.storage.from(bucket).remove(paths);
    }
  }
  const { error } = await supabase.from('pipeline_candidates').delete().eq('id', candidateId);
  if (error) throw error;
}

export async function bulkDeletePipelineCandidates(candidateIds: string[]): Promise<void> {
  for (const id of candidateIds) {
    await deletePipelineCandidate(id);
  }
}

export async function addPipelineNote(candidateId: string, body: string, authorLabel?: string): Promise<PipelineNote> {
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('pipeline_notes')
    .insert({
      candidate_id: candidateId,
      body: body.trim(),
      author_user_id: auth.user?.id ?? null,
      author_label: authorLabel ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as PipelineNote;
}

export async function savePipelineEvaluation(input: {
  candidateId: string;
  fitScore: number | null;
  disposition: string;
  nextAction: string;
  journeyStage: string;
  comments: string;
  actorLabel?: string;
  callContext?: PipelineCallContext | null;
}): Promise<PipelineEvaluation> {
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('pipeline_evaluations')
    .insert({
      candidate_id: input.candidateId,
      fit_score: input.fitScore,
      disposition: input.disposition || null,
      next_action: input.nextAction || null,
      journey_stage: input.journeyStage || null,
      comments: input.comments || null,
      created_by_user_id: auth.user?.id ?? null,
      created_by_label: input.actorLabel ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;

  const { error: upErr } = await supabase
    .from('pipeline_candidates')
    .update({
      journey_stage: input.journeyStage || 'new',
      status: input.disposition?.toLowerCase().includes('close') ? 'closed' : 'in_progress',
    })
    .eq('id', input.candidateId);
  if (upErr) throw upErr;

  await logPipelineCallAction({
    candidateId: input.candidateId,
    action: 'evaluation_saved',
    outcome: 'ok',
    requestPayload: {
      fit_score: input.fitScore,
      disposition: input.disposition || null,
      next_action: input.nextAction || null,
      journey_stage: input.journeyStage || null,
    },
    actorLabel: input.actorLabel ?? null,
    callContext: input.callContext ?? null,
  });

  return data as PipelineEvaluation;
}

export async function updatePipelineCandidateSchedule(candidateId: string, scheduledFor: string | null): Promise<void> {
  const { error } = await supabase
    .from('pipeline_candidates')
    .update({ scheduled_for: scheduledFor || null })
    .eq('id', candidateId);
  if (error) throw error;
}

export async function updatePipelineCandidateProfile(input: {
  candidateId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  profile: PipelineCandidateProfile;
}): Promise<void> {
  const { data: existing, error: getErr } = await supabase
    .from('pipeline_candidates')
    .select('metadata')
    .eq('id', input.candidateId)
    .maybeSingle();
  if (getErr) throw getErr;
  const currentMetadata = (existing?.metadata && typeof existing.metadata === 'object')
    ? existing.metadata as Record<string, unknown>
    : {};
  const nextMetadata: Record<string, unknown> = {
    ...currentMetadata,
    ocr_profile: input.profile,
    ocr_profile_updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from('pipeline_candidates')
    .update({
      full_name: input.fullName.trim() || 'Unknown Candidate',
      email: input.email?.trim() || null,
      phone: input.phone?.trim() || null,
      metadata: nextMetadata,
    })
    .eq('id', input.candidateId);
  if (error) throw error;
}

export async function savePipelineCandidatePhoneOverride(input: {
  candidateId: string;
  phoneInput: string;
  source?: string | null;
}): Promise<PipelineCandidate> {
  const phoneInput = String(input.phoneInput || '').trim();
  if (!isPipelinePhoneInputClean(phoneInput)) {
    throw new Error('Phone input can only include digits, spaces, parentheses, dashes, and optional +.');
  }
  const { data: existing, error: getErr } = await supabase
    .from('pipeline_candidates')
    .select('id, full_name, phone, email, source, journey_stage, status, uploader_user_id, uploader_label, scheduled_for, metadata, created_at, updated_at')
    .eq('id', input.candidateId)
    .maybeSingle();
  if (getErr) throw getErr;
  if (!existing) throw new Error('Candidate not found.');

  const row = existing as PipelineCandidate;
  const metadata = row.metadata && typeof row.metadata === 'object'
    ? { ...(row.metadata as Record<string, unknown>) }
    : {};
  const existingOriginal = typeof metadata.phone_original_extracted === 'string'
    ? String(metadata.phone_original_extracted || '').trim()
    : '';
  const currentPhone = String(row.phone || '').trim();
  const originalExtracted = existingOriginal || currentPhone || null;

  const nextMetadata: Record<string, unknown> = {
    ...metadata,
    phone_override: phoneInput,
    phone_original_extracted: originalExtracted,
    phone_override_updated_at: new Date().toISOString(),
    phone_override_source: String(input.source || 'manual').trim() || 'manual',
  };

  const { data, error } = await supabase
    .from('pipeline_candidates')
    .update({
      phone: phoneInput,
      metadata: nextMetadata,
    })
    .eq('id', input.candidateId)
    .select('id, full_name, phone, email, source, journey_stage, status, uploader_user_id, uploader_label, scheduled_for, metadata, created_at, updated_at')
    .single();
  if (error) throw error;
  return data as PipelineCandidate;
}

export async function savePipelineCallDisposition(input: {
  candidateId: string;
  resumeId?: string | null;
  dialLogId?: string | null;
  disposition: PipelineCallDisposition;
  comment?: string | null;
  dialedNumber: string;
  dialStartedAt: string;
  threecxMetadata?: Record<string, unknown> | null;
  actorLabel?: string | null;
  updateJourneyStage?: boolean;
  callContext?: PipelineCallContext | null;
  callbackAt?: string | null;
  bookedSubtype?: string | null;
}): Promise<PipelineCallRecord> {
  const { data: auth } = await supabase.auth.getUser();
  const disposedAt = new Date().toISOString();
  const callbackAt = input.callbackAt ? new Date(input.callbackAt).toISOString() : null;
  const bookedSubtype = input.bookedSubtype?.trim() || null;
  if (input.disposition === 'Callback requested' && !callbackAt) {
    throw new Error('Callback date and time is required for Callback requested.');
  }
  if (input.disposition === 'Booked' && !bookedSubtype) {
    throw new Error('Booked subtype is required.');
  }
  const requestPayload: Record<string, unknown> = {
    disposition: input.disposition,
    dialed_number: input.dialedNumber,
    dial_started_at: input.dialStartedAt,
    dial_log_id: input.dialLogId ?? null,
    comment: input.comment?.trim() || null,
    callback_at: callbackAt,
    booked_subtype: bookedSubtype,
    call_context: input.callContext ?? null,
  };
  const threecxMetadata = mergeCallContextMetadata({
    ...(input.threecxMetadata ?? {}),
    callback_at: callbackAt,
    booked_subtype: bookedSubtype,
  }, input.callContext) ?? {};

  let savedRecord: PipelineCallRecord | null = null;
  let savedViaFallback = false;
  const { data, error } = await supabase
    .from('pipeline_call_records')
    .insert({
      candidate_id: input.candidateId,
      resume_id: input.resumeId ?? null,
      dial_log_id: input.dialLogId ?? null,
      recruiter_user_id: auth.user?.id ?? null,
      recruiter_label: input.actorLabel ?? null,
      disposition: input.disposition,
      comment: input.comment?.trim() || null,
      dialed_number: input.dialedNumber,
      dial_started_at: input.dialStartedAt,
      disposed_at: disposedAt,
      threecx_metadata: threecxMetadata,
    })
    .select('*')
    .single();

  if (error) {
    if (!isCallRecordInsertFallbackEligible(error)) throw error;
    const fallbackReason = stringifySupabaseError(error);
    const fallbackLog = await logPipelineCallAction({
      candidateId: input.candidateId,
      resumeId: input.resumeId ?? null,
      action: 'call_disposition_saved',
      outcome: 'fallback_saved',
      requestPayload: {
        ...requestPayload,
        persistence_mode: 'pipeline_call_logs_fallback',
      },
      responsePayload: {
        call_record_id: `fallback-${disposedAt}`,
        persistence_mode: 'pipeline_call_logs_fallback',
        fallback_reason: fallbackReason,
      },
      actorLabel: input.actorLabel ?? null,
      callContext: input.callContext ?? null,
    });
    savedViaFallback = true;
    savedRecord = {
      id: `fallback-${fallbackLog.id}`,
      candidate_id: input.candidateId,
      resume_id: input.resumeId ?? null,
      dial_log_id: input.dialLogId ?? null,
      recruiter_user_id: auth.user?.id ?? null,
      recruiter_label: input.actorLabel ?? null,
      disposition: input.disposition,
      comment: input.comment?.trim() || null,
      dialed_number: input.dialedNumber,
      dial_started_at: input.dialStartedAt,
      disposed_at: disposedAt,
      threecx_metadata: {
        ...threecxMetadata,
        persistence_mode: 'pipeline_call_logs_fallback',
        fallback_log_id: fallbackLog.id,
        fallback_reason: fallbackReason,
      },
      created_at: fallbackLog.created_at,
      callback_at: callbackAt,
      booked_subtype: bookedSubtype,
    };
  } else {
    savedRecord = data as PipelineCallRecord;
  }

  const journeyStage = journeyStageForCallDisposition(input.disposition);
  const status =
    input.disposition === 'Not interested' || input.disposition === 'Do not call'
      ? 'closed'
      : 'in_progress';

  if (input.updateJourneyStage !== false) {
    const { error: upErr } = await supabase
      .from('pipeline_candidates')
      .update({ journey_stage: journeyStage, status })
      .eq('id', input.candidateId);
    if (upErr) throw upErr;
  }

  if (!savedViaFallback) {
    await logPipelineCallAction({
      candidateId: input.candidateId,
      resumeId: input.resumeId ?? null,
      action: 'call_disposition_saved',
      outcome: 'ok',
      requestPayload,
      responsePayload: { call_record_id: savedRecord.id },
      actorLabel: input.actorLabel ?? null,
      callContext: input.callContext ?? null,
    });
  }

  return savedRecord;
}

export async function logPipelineCallAction(input: {
  candidateId: string;
  resumeId?: string | null;
  threecxCallId?: string | null;
  action: string;
  outcome?: string | null;
  durationSeconds?: number | null;
  agentExtension?: string | null;
  requestPayload?: Record<string, unknown> | null;
  responsePayload?: Record<string, unknown> | null;
  actorLabel?: string | null;
  callContext?: PipelineCallContext | null;
}): Promise<PipelineCallLog> {
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('pipeline_call_logs')
    .insert({
      candidate_id: input.candidateId,
      resume_id: input.resumeId ?? null,
      threecx_call_id: input.threecxCallId ?? null,
      action: input.action,
      outcome: input.outcome ?? null,
      duration_seconds: input.durationSeconds ?? null,
      agent_extension: input.agentExtension ?? null,
      request_payload: mergeCallContextMetadata(input.requestPayload, input.callContext),
      response_payload: input.responsePayload ?? null,
      created_by_user_id: auth.user?.id ?? null,
      created_by_label: input.actorLabel ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as PipelineCallLog;
}

export async function listPipelineIncomingEmailLogs(candidateId: string): Promise<PipelineIncomingEmailLog[]> {
  const { data, error } = await supabase
    .from('email_inbox_logs')
    .select('*')
    .eq('candidate_id', candidateId)
    .order('received_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data || []) as PipelineIncomingEmailLog[];
}

export async function listPipelineEmailSendLogs(candidateId: string): Promise<PipelineEmailSendLog[]> {
  const { data, error } = await supabase
    .from('email_send_logs')
    .select('id,source,trigger_label,from_email,to_email,cc_email,subject,candidate_id,status,created_at,error_message')
    .eq('candidate_id', candidateId)
    .order('created_at', { ascending: false })
    .limit(150);
  if (error) throw error;
  return (data || []) as PipelineEmailSendLog[];
}

export async function listPipelineEmailSendLogsByCandidates(
  candidateIds: string[],
  input?: { fromIso?: string | null; toIso?: string | null; limit?: number },
): Promise<PipelineEmailSendLog[]> {
  if (!candidateIds.length) return [];
  let query = supabase
    .from('email_send_logs')
    .select('id,source,trigger_label,from_email,to_email,cc_email,subject,candidate_id,status,created_at,error_message')
    .in('candidate_id', candidateIds)
    .order('created_at', { ascending: false })
    .limit(input?.limit ?? 3000);
  if (input?.fromIso) query = query.gte('created_at', input.fromIso);
  if (input?.toIso) query = query.lte('created_at', input.toIso);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as PipelineEmailSendLog[];
}

export async function listPipelineCallRecords(input?: {
  candidateIds?: string[];
  recruiterUserId?: string | null;
  fromIso?: string | null;
  toIso?: string | null;
  limit?: number;
}): Promise<PipelineCallRecord[]> {
  const limit = input?.limit ?? 1500;
  let query = supabase
    .from('pipeline_call_records')
    .select('*')
    .order('disposed_at', { ascending: false })
    .limit(limit);

  if (input?.candidateIds && input.candidateIds.length > 0) {
    query = query.in('candidate_id', input.candidateIds);
  }
  if (input?.recruiterUserId) {
    query = query.eq('recruiter_user_id', input.recruiterUserId);
  }
  if (input?.fromIso) {
    query = query.gte('disposed_at', input.fromIso);
  }
  if (input?.toIso) {
    query = query.lte('disposed_at', input.toIso);
  }

  const toIsoString = (value: unknown): string => {
    const str = String(value || '').trim();
    if (!str) return new Date().toISOString();
    const d = new Date(str);
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  };

  const mapLogsToRecords = (logs: PipelineCallLog[]): PipelineCallRecord[] => {
    return logs.map((row) => {
      const req = (row.request_payload && typeof row.request_payload === 'object'
        ? row.request_payload
        : {}) as Record<string, unknown>;
      const res = (row.response_payload && typeof row.response_payload === 'object'
        ? row.response_payload
        : {}) as Record<string, unknown>;
      const disposition = String(req.disposition || row.outcome || 'Connected').trim() || 'Connected';
      const callbackAt = typeof req.callback_at === 'string' ? req.callback_at : null;
      const bookedSubtype = typeof req.booked_subtype === 'string' ? req.booked_subtype : null;
      return {
        id: String(res.call_record_id || row.id),
        candidate_id: row.candidate_id,
        resume_id: row.resume_id,
        dial_log_id: typeof req.dial_log_id === 'string' ? req.dial_log_id : null,
        recruiter_user_id: row.created_by_user_id,
        recruiter_label: row.created_by_label,
        disposition,
        comment: typeof req.comment === 'string' ? req.comment : null,
        dialed_number: String(req.dialed_number || '').trim() || 'unknown',
        dial_started_at: toIsoString(req.dial_started_at || row.created_at),
        disposed_at: row.created_at,
        threecx_metadata: {
          callback_at: callbackAt,
          booked_subtype: bookedSubtype,
          source: 'pipeline_call_logs_fallback',
        },
        created_at: row.created_at,
      } as PipelineCallRecord;
    });
  };

  try {
    const { data, error } = await query;
    if (!error) return (data || []) as PipelineCallRecord[];
    throw error;
  } catch {
    // Fallback path when pipeline_call_records query fails in deployed env.
    let fallback = supabase
      .from('pipeline_call_logs')
      .select('*')
      .eq('action', 'call_disposition_saved')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (input?.candidateIds && input.candidateIds.length > 0) {
      fallback = fallback.in('candidate_id', input.candidateIds);
    }
    if (input?.recruiterUserId) {
      fallback = fallback.eq('created_by_user_id', input.recruiterUserId);
    }
    if (input?.fromIso) {
      fallback = fallback.gte('created_at', input.fromIso);
    }
    if (input?.toIso) {
      fallback = fallback.lte('created_at', input.toIso);
    }
    const { data: logs, error: logsError } = await fallback;
    if (logsError) throw logsError;
    return mapLogsToRecords((logs || []) as PipelineCallLog[]);
  }
}

export async function listPipelineResumesForCandidates(candidateIds: string[]): Promise<PipelineResume[]> {
  if (!candidateIds.length) return [];
  const { data, error } = await supabase
    .from('pipeline_resumes')
    .select('*')
    .in('candidate_id', candidateIds)
    .order('created_at', { ascending: false })
    .limit(4000);
  if (error) throw error;
  return (data || []) as PipelineResume[];
}

export async function listPipelineIncomingEmailLogsByCandidates(
  candidateIds: string[],
  input?: { fromIso?: string | null; toIso?: string | null },
): Promise<PipelineIncomingEmailLog[]> {
  if (!candidateIds.length) return [];
  let query = supabase
    .from('email_inbox_logs')
    .select('*')
    .in('candidate_id', candidateIds)
    .order('received_at', { ascending: false })
    .limit(3000);
  if (input?.fromIso) query = query.gte('received_at', input.fromIso);
  if (input?.toIso) query = query.lte('received_at', input.toIso);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as PipelineIncomingEmailLog[];
}

export async function listPipelineCallLogs(input?: {
  candidateIds?: string[];
  createdByUserId?: string | null;
  actions?: string[];
  fromIso?: string | null;
  toIso?: string | null;
  limit?: number;
}): Promise<PipelineCallLog[]> {
  let query = supabase
    .from('pipeline_call_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(input?.limit ?? 3000);
  if (input?.candidateIds && input.candidateIds.length > 0) {
    query = query.in('candidate_id', input.candidateIds);
  }
  if (input?.createdByUserId) {
    query = query.eq('created_by_user_id', input.createdByUserId);
  }
  if (input?.actions && input.actions.length > 0) {
    query = query.in('action', input.actions);
  }
  if (input?.fromIso) {
    query = query.gte('created_at', input.fromIso);
  }
  if (input?.toIso) {
    query = query.lte('created_at', input.toIso);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as PipelineCallLog[];
}

export async function syncPipelineIncomingEmails(days = 10, limit = 80): Promise<{ synced: number; mapped: number }> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!supabaseUrl || !anonKey) throw new Error('Missing Supabase environment configuration.');
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('You are not signed in.');
  const res = await fetch(`${supabaseUrl}/functions/v1/email-inbox-sync`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ days, limit }),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = typeof json.error === 'string' ? json.error : (typeof json.message === 'string' ? json.message : `Sync failed (${res.status})`);
    throw new Error(err);
  }
  return {
    synced: Number(json.synced || 0),
    mapped: Number(json.mapped || 0),
  };
}

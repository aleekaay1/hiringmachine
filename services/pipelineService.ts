import { supabase } from './supabaseClient';
import mammoth from 'mammoth';
import { createWorker } from 'tesseract.js';
import {
  journeyStageForCallDisposition,
  type PipelineCallDisposition,
} from './pipelineCallDispositions';

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
  callerId?: string | null;
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
  caller_id: string | null;
  dialing_locale: string | null;
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

function normalizeName(value: string | null | undefined): string {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ');
}

function mergeCallContextMetadata(
  existing: Record<string, unknown> | null | undefined,
  callContext?: PipelineCallContext | null,
): Record<string, unknown> | null {
  if (!callContext) return existing ?? null;
  const extension = String(callContext.extension || '').trim();
  const callerId = String(callContext.callerId || '').trim();
  const dialingLocale = String(callContext.dialingLocale || '').trim();
  if (!extension && !callerId && !dialingLocale) return existing ?? null;
  return {
    ...(existing || {}),
    call_context: {
      extension: extension || null,
      caller_id: callerId || null,
      dialing_locale: dialingLocale || null,
    },
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

export function getPipelineResumeDisplayUrl(resume: PipelineResume): string | null {
  return resume.converted_pdf_url || resume.public_url;
}

export function getPipelineResumeViewerKind(resume: PipelineResume): 'pdf' | 'image' | 'other' {
  return fileViewerKind(resume);
}

export async function listPipelineCandidates(): Promise<PipelineCandidate[]> {
  const { data, error } = await supabase
    .from('pipeline_candidates')
    .select('id, full_name, phone, email, source, journey_stage, status, uploader_user_id, uploader_label, scheduled_for, metadata, created_at, updated_at')
    .order('updated_at', { ascending: false })
    .limit(2000);
  if (error) throw error;
  return (data || []) as PipelineCandidate[];
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
  callerId?: string | null;
  dialingLocale?: string | null;
}): Promise<PipelineUserCallSettings> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error('You must be signed in.');
  const payload = {
    user_id: userId,
    extension: input.extension?.trim() || null,
    caller_id: input.callerId?.trim() || null,
    dialing_locale: input.dialingLocale?.trim() || null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('pipeline_user_call_settings')
    .upsert(payload, { onConflict: 'user_id' })
    .select('*')
    .single();
  if (error) throw error;
  return data as PipelineUserCallSettings;
}

export async function listPipelineCandidateActivityTimeline(candidateId: string): Promise<PipelineActivityTimelineItem[]> {
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
      },
    });
  }
  output.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return output;
}

export async function syncJourneyResumesIntoPipeline(): Promise<{ importedCandidates: number; importedResumes: number }> {
  const { data: sourceRows, error: sourceError } = await supabase
    .from('candidates')
    .select('id, first_name, last_name, email, phone, applicant_questionnaire')
    .order('timestamp', { ascending: false })
    .limit(2000);
  if (sourceError) throw sourceError;
  const journeyRows = (sourceRows || []).filter((row) => {
    const aq = ((row as any).applicant_questionnaire || {}) as Record<string, unknown>;
    const resumeUrls = Array.isArray(aq.resumeUrls) ? aq.resumeUrls : [];
    return resumeUrls.some((x) => String(x || '').trim().length > 0);
  });
  if (journeyRows.length === 0) return { importedCandidates: 0, importedResumes: 0 };

  const existingCandidates = await listPipelineCandidates();
  const byEmail = new Map<string, PipelineCandidate>();
  const byPhone = new Map<string, PipelineCandidate>();
  const byName = new Map<string, PipelineCandidate[]>();
  for (const c of existingCandidates) {
    const em = normalizeEmail(c.email);
    const ph = normalizePhone(c.phone);
    const nm = normalizeName(c.full_name);
    if (em) byEmail.set(em, c);
    if (ph) byPhone.set(ph, c);
    if (nm) {
      const arr = byName.get(nm) || [];
      arr.push(c);
      byName.set(nm, arr);
    }
  }

  let importedCandidates = 0;
  let importedResumes = 0;
  for (const row of journeyRows) {
    const aq = (((row as any).applicant_questionnaire || {}) as Record<string, unknown>);
    const rawResumeUrls = Array.isArray(aq.resumeUrls) ? aq.resumeUrls : [];
    const resumeUrls = rawResumeUrls.map((x) => String(x || '').trim()).filter(Boolean);
    if (resumeUrls.length === 0) continue;
    const fullName = `${String((row as any).first_name || '').trim()} ${String((row as any).last_name || '').trim()}`.trim() || 'Unknown Candidate';
    const email = normalizeEmail((row as any).email);
    const phone = normalizePhone((row as any).phone);
    const name = normalizeName(fullName);
    let matched =
      (email && byEmail.get(email))
      || (phone && byPhone.get(phone))
      || (name && (byName.get(name) || [])[0])
      || null;

    if (!matched) {
      const { data: inserted, error: insertError } = await supabase
        .from('pipeline_candidates')
        .insert({
          full_name: fullName,
          email: email || null,
          phone: phone || null,
          source: 'journey_upload',
          metadata: {
            source_candidate_id: String((row as any).id),
            source_origin: 'checkin_journey',
          },
        })
        .select('id, full_name, phone, email, source, journey_stage, status, uploader_user_id, uploader_label, scheduled_for, metadata, created_at, updated_at')
        .single();
      if (insertError) throw insertError;
      matched = inserted as PipelineCandidate;
      importedCandidates += 1;
      if (email) byEmail.set(email, matched);
      if (phone) byPhone.set(phone, matched);
      if (name) {
        const arr = byName.get(name) || [];
        arr.push(matched);
        byName.set(name, arr);
      }
    }

    const { data: existingResumes, error: existingError } = await supabase
      .from('pipeline_resumes')
      .select('id, public_url, original_filename')
      .eq('candidate_id', matched.id);
    if (existingError) throw existingError;
    const knownUrls = new Set((existingResumes || []).map((x) => String((x as any).public_url || '').trim()).filter(Boolean));
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
          storage_path: `external:${String((row as any).id)}:${filenameGuess}`,
          public_url: resumeUrl,
          original_filename: filenameGuess,
          mime_type: inferredMime,
          size_bytes: null,
          conversion_status: 'not_required',
          converted_pdf_url: inferredMime === 'application/pdf' ? resumeUrl : null,
          resume_source: 'journey_upload',
          source_candidate_id: String((row as any).id),
          source_resume_url: resumeUrl,
        });
      if (resumeInsertError) throw resumeInsertError;
      importedResumes += 1;
      knownUrls.add(resumeUrl);
    }
  }

  return { importedCandidates, importedResumes };
}

export async function getPipelineCandidateBundle(candidateId: string): Promise<PipelineCandidateBundle | null> {
  const { data: candidate, error: cErr } = await supabase
    .from('pipeline_candidates')
    .select('id, full_name, phone, email, source, journey_stage, status, uploader_user_id, uploader_label, scheduled_for, metadata, created_at, updated_at')
    .eq('id', candidateId)
    .maybeSingle();
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
  const userId = auth.user?.id ?? null;
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
}): Promise<PipelineCallRecord> {
  const { data: auth } = await supabase.auth.getUser();
  const disposedAt = new Date().toISOString();
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
      threecx_metadata: mergeCallContextMetadata(input.threecxMetadata ?? {}, input.callContext) ?? {},
    })
    .select('*')
    .single();
  if (error) throw error;

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

  await logPipelineCallAction({
    candidateId: input.candidateId,
    resumeId: input.resumeId ?? null,
    action: 'call_disposition_saved',
    outcome: 'ok',
    requestPayload: {
      disposition: input.disposition,
      dialed_number: input.dialedNumber,
      dial_log_id: input.dialLogId ?? null,
      comment: input.comment?.trim() || null,
      call_context: input.callContext ?? null,
    },
    responsePayload: { call_record_id: data.id },
    actorLabel: input.actorLabel ?? null,
    callContext: input.callContext ?? null,
  });

  return data as PipelineCallRecord;
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

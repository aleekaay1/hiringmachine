import { supabase } from './supabaseClient';
import mammoth from 'mammoth';
import { createWorker } from 'tesseract.js';

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

export interface PipelineCandidateBundle {
  candidate: PipelineCandidate;
  resumes: PipelineResume[];
  notes: PipelineNote[];
  evaluations: PipelineEvaluation[];
  callLogs: PipelineCallLog[];
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

async function extractTextFromPdf(file: File): Promise<string> {
  try {
    const pdfjs = await import('pdfjs-dist');
    const workerSrc = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    (pdfjs as any).GlobalWorkerOptions.workerSrc = workerSrc.default;
    const buf = await file.arrayBuffer();
    const task = (pdfjs as any).getDocument({ data: buf });
    const doc = await task.promise;
    const pagesToRead = Math.min(doc.numPages, 5);
    let out = '';
    for (let i = 1; i <= pagesToRead; i += 1) {
      const page = await doc.getPage(i);
      const text = await page.getTextContent();
      out += `\n${text.items.map((it: any) => String(it.str || '')).join(' ')}`;
    }
    // OCR fallback for scanned PDFs with little/no text layer.
    if (normalizeExtractText(out).length < 80) {
      try {
        const firstPage = await doc.getPage(1);
        const viewport = firstPage.getViewport({ scale: 2 });
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (ctx) {
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          await firstPage.render({ canvasContext: ctx, viewport }).promise;
          const worker = await createWorker('eng');
          const result = await worker.recognize(canvas);
          await worker.terminate();
          const ocrText = String(result.data.text || '');
          if (normalizeExtractText(ocrText).length > normalizeExtractText(out).length) {
            out += `\n${ocrText}`;
          }
        }
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
  const mime = (file.type || '').toLowerCase();
  let parsed = '';
  if (mime.includes('pdf')) parsed = await extractTextFromPdf(file);
  else if (mime.startsWith('image/')) parsed = await extractTextFromImage(file);
  else if (mime.includes('word') || cleanName.toLowerCase().endsWith('.docx')) parsed = await extractTextFromWord(file);
  else if (mime.includes('text') || cleanName.toLowerCase().endsWith('.txt') || cleanName.toLowerCase().endsWith('.rtf')) {
    parsed = await file.text().catch(() => '');
  }
  return mergeHints(cleanName, parsed);
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

export async function getPipelineCandidateBundle(candidateId: string): Promise<PipelineCandidateBundle | null> {
  const { data: candidate, error: cErr } = await supabase
    .from('pipeline_candidates')
    .select('id, full_name, phone, email, source, journey_stage, status, uploader_user_id, uploader_label, scheduled_for, metadata, created_at, updated_at')
    .eq('id', candidateId)
    .maybeSingle();
  if (cErr) throw cErr;
  if (!candidate) return null;

  const [{ data: resumes, error: rErr }, { data: notes, error: nErr }, { data: evaluations, error: eErr }, { data: callLogs, error: lErr }] =
    await Promise.all([
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
    ]);

  if (rErr) throw rErr;
  if (nErr) throw nErr;
  if (eErr) throw eErr;
  if (lErr) throw lErr;

  return {
    candidate: candidate as PipelineCandidate,
    resumes: (resumes || []) as PipelineResume[],
    notes: (notes || []) as PipelineNote[],
    evaluations: (evaluations || []) as PipelineEvaluation[],
    callLogs: (callLogs || []) as PipelineCallLog[],
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

export async function bulkUploadPipelineResumes(files: File[], actorLabel?: string): Promise<{ created: PipelineCandidate[]; failed: Array<{ file: string; error: string }> }> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id ?? null;
  const created: PipelineCandidate[] = [];
  const failed: Array<{ file: string; error: string }> = [];

  for (const file of files) {
    try {
      const cleanName = sanitizeFilename(file.name);
      const hints = await extractCandidateHints(file, cleanName);
      const { data: cand, error: cErr } = await supabase
        .from('pipeline_candidates')
        .insert({
          full_name: hints.name,
          phone: hints.phone,
          email: hints.email,
          uploader_user_id: userId,
          uploader_label: actorLabel ?? null,
          source: 'bulk_upload',
          metadata: { original_file_name: file.name },
        })
        .select('id, full_name, phone, email, source, journey_stage, status, uploader_user_id, uploader_label, scheduled_for, metadata, created_at, updated_at')
        .single();
      if (cErr) throw cErr;
      const candidate = cand as PipelineCandidate;

      const path = `${candidate.id}/${Date.now()}-${cleanName}`;
      const { error: upErr } = await supabase.storage.from(PIPELINE_BUCKET).upload(path, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type || 'application/octet-stream',
      });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from(PIPELINE_BUCKET).getPublicUrl(path);

      const isPdf = (file.type || '').toLowerCase().includes('pdf');
      const isImage = (file.type || '').toLowerCase().startsWith('image/');
      const conversionStatus = isPdf || isImage ? 'not_required' : 'pending';

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
        })
        .select('*')
        .single();
      if (rErr) throw rErr;

      if (conversionStatus === 'pending') {
        void invokePipelineConvertResume({ resume_id: (resume as PipelineResume).id });
      }
      created.push(candidate);
    } catch (err) {
      failed.push({ file: file.name, error: err instanceof Error ? err.message : String(err) });
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

  return data as PipelineEvaluation;
}

export async function updatePipelineCandidateSchedule(candidateId: string, scheduledFor: string | null): Promise<void> {
  const { error } = await supabase
    .from('pipeline_candidates')
    .update({ scheduled_for: scheduledFor || null })
    .eq('id', candidateId);
  if (error) throw error;
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
      request_payload: input.requestPayload ?? null,
      response_payload: input.responsePayload ?? null,
      created_by_user_id: auth.user?.id ?? null,
      created_by_label: input.actorLabel ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as PipelineCallLog;
}

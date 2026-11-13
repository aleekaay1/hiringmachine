import { supabase } from './supabaseClient';
import { buildEmailSignatureHtml } from './emailSignatureHtml';
import {
  applyNurtureTokens,
  assembleNurtureHtml,
  parseVimeoRef,
  type NurturePerson,
} from './nurtureEmailHtml';

export const NURTURE_SEQUENCE_ID = 'webinar-no-questionnaire';

export const NURTURE_SQL_HINT =
  'The nurture tables are not in Supabase yet. Run supabase/sql/paste_hm_nurture_sequence.sql in the SQL editor, then refresh.';

export const NURTURE_PREVIEW_PERSON: NurturePerson = {
  firstName: 'Alex',
  lastName: 'Rivera',
  email: 'alex.rivera@example.com',
};

export type NurtureSequence = {
  id: string;
  name: string;
  enabled: boolean;
  updated_at: string;
};

export type NurtureStep = {
  id: string;
  step_number: number;
  subject: string;
  body_html: string;
  vimeo_url: string;
  delay_days: number;
};

export type NurtureEnrollment = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  source: 'auto' | 'manual';
  status: 'active' | 'completed' | 'stopped';
  stop_reason: string | null;
  watched_at: string | null;
  current_step: number;
  next_step: number;
  next_send_at: string | null;
  enrolled_at: string;
  last_error: string | null;
};

export type NurtureSend = {
  id: string;
  enrollment_id: string;
  step_number: number;
  email: string;
  subject: string | null;
  status: 'claimed' | 'sent' | 'failed';
  error: string | null;
  sent_at: string | null;
  created_at: string;
};

export type NurtureWatcher = {
  email: string;
  first_name: string | null;
  last_name: string | null;
  watched_at: string | null;
  questionnaire_submitted: boolean;
  enrollment_status: string | null;
  enrollment_id: string | null;
};

function schemaMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === 'PGRST205' || error.code === '42P01' || error.code === 'PGRST202') return true;
  const message = error.message || '';
  return /hm_nurture_/i.test(message) && /schema cache|does not exist|could not find/i.test(message);
}

function raise(error: { code?: string; message?: string } | null, fallback: string): never {
  if (schemaMissing(error)) throw new Error(NURTURE_SQL_HINT);
  throw new Error(error?.message || fallback);
}

export function previewNurtureSubject(subject: string): string {
  return applyNurtureTokens(subject, NURTURE_PREVIEW_PERSON, false);
}

export function previewNurtureHtml(step: Pick<NurtureStep, 'body_html' | 'vimeo_url'>): string {
  return assembleNurtureHtml({
    bodyHtml: step.body_html,
    vimeoUrl: step.vimeo_url,
    signatureHtml: buildEmailSignatureHtml(),
    person: NURTURE_PREVIEW_PERSON,
  });
}

export function vimeoFieldError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (parseVimeoRef(trimmed)) return null;
  return 'Use a Vimeo link or id, such as https://vimeo.com/123456789 or https://vimeo.com/123456789/hash.';
}

export async function loadNurtureSequence(): Promise<{
  sequence: NurtureSequence;
  steps: NurtureStep[];
}> {
  const { data: sequence, error } = await supabase
    .from('hm_nurture_sequences')
    .select('id, name, enabled, updated_at')
    .eq('id', NURTURE_SEQUENCE_ID)
    .maybeSingle();
  if (error) raise(error, 'Could not load the nurture sequence');
  if (!sequence) throw new Error(NURTURE_SQL_HINT);

  const { data: steps, error: stepError } = await supabase
    .from('hm_nurture_steps')
    .select('id, step_number, subject, body_html, vimeo_url, delay_days')
    .eq('sequence_id', NURTURE_SEQUENCE_ID)
    .order('step_number', { ascending: true });
  if (stepError) raise(stepError, 'Could not load nurture emails');
  const rows = (steps || []) as NurtureStep[];
  if (rows.length < 6) throw new Error(NURTURE_SQL_HINT);
  return { sequence: sequence as NurtureSequence, steps: rows };
}

export async function saveNurtureSequence(input: {
  enabled: boolean;
  steps: NurtureStep[];
}): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('hm_nurture_sequences')
    .update({
      enabled: input.enabled,
      updated_by: userData.user?.id ?? null,
      updated_at: now,
    })
    .eq('id', NURTURE_SEQUENCE_ID);
  if (error) raise(error, 'Could not save the sequence');

  for (const step of input.steps) {
    const delay = step.step_number === 1
      ? 0
      : Math.min(30, Math.max(0, Math.round(Number(step.delay_days) || 0)));
    const { error: stepError } = await supabase
      .from('hm_nurture_steps')
      .update({
        subject: step.subject,
        body_html: step.body_html,
        vimeo_url: step.vimeo_url.trim(),
        delay_days: delay,
        updated_at: now,
      })
      .eq('id', step.id);
    if (stepError) raise(stepError, `Could not save email ${step.step_number}`);
  }
}

export async function listNurtureEnrollments(): Promise<NurtureEnrollment[]> {
  const { data, error } = await supabase
    .from('hm_nurture_enrollments')
    .select(
      'id, email, first_name, last_name, source, status, stop_reason, watched_at, current_step, next_step, next_send_at, enrolled_at, last_error',
    )
    .eq('sequence_id', NURTURE_SEQUENCE_ID)
    .order('enrolled_at', { ascending: false })
    .limit(300);
  if (error) raise(error, 'Could not load people in the sequence');
  return (data || []) as NurtureEnrollment[];
}

export async function listNurtureSends(): Promise<NurtureSend[]> {
  const { data, error } = await supabase
    .from('hm_nurture_sends')
    .select('id, enrollment_id, step_number, email, subject, status, error, sent_at, created_at')
    .eq('sequence_id', NURTURE_SEQUENCE_ID)
    .order('created_at', { ascending: false })
    .limit(40);
  if (error) raise(error, 'Could not load send history');
  return (data || []) as NurtureSend[];
}

export async function searchNurtureWatchers(query: string): Promise<NurtureWatcher[]> {
  const { data, error } = await supabase.rpc('hm_nurture_search_watchers', {
    p_query: query.trim(),
    p_limit: 20,
  });
  if (error) raise(error, 'Could not search watchers');
  return (data || []) as NurtureWatcher[];
}

export async function enrollNurturePerson(input: {
  email: string;
  firstName?: string;
  lastName?: string;
}): Promise<{ already?: boolean; created?: boolean; resumed?: boolean }> {
  const { data, error } = await supabase.rpc('hm_nurture_manual_enroll', {
    p_email: input.email.trim(),
    p_first_name: input.firstName?.trim() || null,
    p_last_name: input.lastName?.trim() || null,
  });
  if (error) raise(error, 'Could not start the sequence');
  const result = (data || {}) as { ok?: boolean; error?: string; already?: boolean; created?: boolean; resumed?: boolean };
  if (result.ok === false) throw new Error(result.error || 'Could not start the sequence');
  return result;
}

export async function stopNurtureEnrollment(id: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('hm_nurture_enrollments')
    .update({
      status: 'stopped',
      stop_reason: 'manual',
      next_send_at: null,
      stopped_at: now,
      updated_at: now,
    })
    .eq('id', id)
    .eq('status', 'active');
  if (error) raise(error, 'Could not stop this person');
}

export type NurtureTickResult = {
  ok?: boolean;
  sent?: number;
  failed?: number;
  stopped?: number;
  skipped?: number;
  due?: number;
  auto_enroll?: { enabled?: boolean; enrolled?: number; stopped?: number } | null;
  auto_enroll_error?: string | null;
  error?: string;
};

export async function sendNurtureDueNow(): Promise<NurtureTickResult> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!supabaseUrl || !anon) throw new Error('Missing Supabase env');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sign in again to send nurture emails.');
  let res: Response;
  try {
    res = await fetch(`${supabaseUrl}/functions/v1/hm-nurture-sequence`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anon,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'send_due' }),
    });
  } catch {
    throw new Error('Could not reach the nurture sender. Deploy the hm-nurture-sequence edge function, then try again.');
  }
  const json = (await res.json().catch(() => ({}))) as NurtureTickResult;
  if (res.status === 404) {
    throw new Error('Deploy the hm-nurture-sequence edge function, then try Send due now again.');
  }
  if (!res.ok) throw new Error(json.error || `Send failed (${res.status})`);
  return json;
}

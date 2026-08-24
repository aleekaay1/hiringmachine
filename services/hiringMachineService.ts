import { supabase } from './supabaseClient';
import {
  listPipelineCallRecordsForCandidates,
  savePipelineCallDisposition,
  savePipelineCandidatePhoneOverride,
  type PipelineCallRecord,
} from './pipelineService';
import type { PipelineCallDisposition } from './pipelineCallDispositions';
import { listCheckInEntries, sendAoHubInviteForCheckIn, type CheckInRow } from './checkInService';
import { getCandidateById, saveCandidate } from './storageService';
import { DEFAULT_ADMIN_DATA } from '../types';

export type HmStage =
  | 'replied'
  | 'shortlisted'
  | 'call_ready'
  | 'called'
  | 'sent_to_hub'
  | 'not_interested'
  | 'ooo';

export type HmPerson = {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  extracted_email: string | null;
  extracted_phone: string | null;
  instantly_lead_id: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  instantly_email_id: string | null;
  unibox_url: string | null;
  reply_snippet: string | null;
  last_reply_text: string | null;
  last_reply_subject: string | null;
  stage: HmStage | string;
  positive_source: string | null;
  ai_summary: string | null;
  ai_score: number | null;
  ai_recommendation: string | null;
  shortlisted_email_sent_at: string | null;
  sent_to_hub_at: string | null;
  last_called_at: string | null;
  pipeline_candidate_id: string | null;
  created_at: string;
  updated_at: string;
  recordSource?: 'hm' | 'checkin';
};

export type InstantlyTotals = {
  sent: number;
  opened: number;
  replies: number;
  interested: number;
  bounced: number;
  unsubscribed: number;
};

export type InstantlyDailyPoint = { date: string; sent: number; opened: number; replies: number };

export type HmDashboardData = {
  instantly: InstantlyTotals;
  daily: InstantlyDailyPoint[];
  pulledAt: string | null;
  funnel: {
    shortlisted: number;
    callReady: number;
    calledToday: number;
    sentToHub: number;
  };
  needsCall: HmPerson[];
  sentAhead: HmPerson[];
};

/** Real hm_people columns from 20260817_120000_hiring_machine_instantly.sql */
const HM_SELECT =
  'id, email, full_name, phone, extracted_email, extracted_phone, instantly_lead_id, campaign_id, campaign_name, instantly_email_id, unibox_url, reply_snippet, last_reply_text, last_reply_subject, stage, positive_source, ai_summary, ai_score, ai_recommendation, shortlisted_email_sent_at, sent_to_hub_at, last_called_at, pipeline_candidate_id, created_at, updated_at';

function asText(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function mapHmDbRow(row: Record<string, unknown>): HmPerson {
  return {
    id: String(row.id || ''),
    email: String(row.email || ''),
    full_name: asText(row.full_name),
    phone: asText(row.phone),
    extracted_email: asText(row.extracted_email),
    extracted_phone: asText(row.extracted_phone),
    instantly_lead_id: asText(row.instantly_lead_id),
    campaign_id: asText(row.campaign_id),
    campaign_name: asText(row.campaign_name),
    instantly_email_id: asText(row.instantly_email_id),
    unibox_url: asText(row.unibox_url),
    reply_snippet: asText(row.reply_snippet),
    last_reply_text: asText(row.last_reply_text),
    last_reply_subject: asText(row.last_reply_subject),
    stage: String(row.stage || 'replied'),
    positive_source: asText(row.positive_source),
    ai_summary: asText(row.ai_summary),
    ai_score: asNumber(row.ai_score),
    ai_recommendation: asText(row.ai_recommendation),
    shortlisted_email_sent_at: asText(row.shortlisted_email_sent_at),
    sent_to_hub_at: asText(row.sent_to_hub_at),
    last_called_at: asText(row.last_called_at),
    pipeline_candidate_id: asText(row.pipeline_candidate_id),
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || ''),
    recordSource: 'hm',
  };
}

function fromCheckInRow(row: CheckInRow): HmPerson {
  const fullName = `${row.firstName} ${row.lastName}`.trim();
  const sentAt = row.aoHubInviteSentAt;
  const tags = row.adminData?.tags || [];
  const calledAt = typeof row.adminData?.lastCalledAt === 'string' ? row.adminData.lastCalledAt : null;
  const notInterested = tags.includes('not_interested') || tags.includes('do_not_call');
  let stage: HmStage = 'call_ready';
  if (sentAt) stage = 'sent_to_hub';
  else if (notInterested) stage = 'not_interested';
  else if (calledAt) stage = 'called';
  return {
    id: row.id,
    email: row.email,
    full_name: fullName || null,
    phone: row.phone || null,
    extracted_email: row.email || null,
    extracted_phone: row.phone || null,
    instantly_lead_id: null,
    campaign_id: null,
    campaign_name: 'Check-in form',
    instantly_email_id: null,
    unibox_url: null,
    reply_snippet: row.currentRole || row.city || 'Checked in',
    last_reply_text:
      [row.city, row.currentRole].filter(Boolean).join(' · ') || 'Submitted the AO Paz check-in form.',
    last_reply_subject: null,
    stage,
    positive_source: 'checkin',
    ai_summary: 'Came in through the Instantly check-in form.',
    ai_score: null,
    ai_recommendation: null,
    shortlisted_email_sent_at: sentAt,
    sent_to_hub_at: sentAt,
    last_called_at: calledAt,
    pipeline_candidate_id: null,
    created_at: row.timestamp,
    updated_at: row.adminData?.checkedInAt || row.timestamp,
    recordSource: 'checkin',
  };
}

function mergePeople(hm: HmPerson[], checkins: HmPerson[]): HmPerson[] {
  const byEmail = new Map<string, HmPerson>();
  for (const person of checkins) {
    if (person.email) byEmail.set(person.email.toLowerCase(), person);
  }
  for (const person of hm) {
    const key = person.email.toLowerCase();
    const existing = byEmail.get(key);
    if (!existing) {
      byEmail.set(key, person);
      continue;
    }
    byEmail.set(key, {
      ...person,
      phone: person.phone || existing.phone,
      extracted_phone: person.extracted_phone || existing.extracted_phone,
      sent_to_hub_at: person.sent_to_hub_at || existing.sent_to_hub_at,
      last_called_at: person.last_called_at || existing.last_called_at,
      stage: person.stage === 'sent_to_hub' || existing.stage === 'sent_to_hub' ? 'sent_to_hub' : person.stage,
    });
  }
  return [...byEmail.values()];
}

async function loadHmPeopleRows(): Promise<HmPerson[]> {
  const { data, error } = await supabase
    .from('hm_people')
    .select(HM_SELECT)
    .order('updated_at', { ascending: false })
    .limit(500);
  if (error) {
    console.warn('hm_people query failed:', error.message);
    return [];
  }
  return (data || []).map((row) => mapHmDbRow(row as Record<string, unknown>));
}

async function loadCheckInPeople(): Promise<HmPerson[]> {
  try {
    return (await listCheckInEntries()).map(fromCheckInRow);
  } catch (err) {
    console.warn('check-in list failed:', err);
    return [];
  }
}

async function loadMergedPeople(): Promise<HmPerson[]> {
  const [hm, checkins] = await Promise.all([loadHmPeopleRows(), loadCheckInPeople()]);
  return mergePeople(hm, checkins);
}

async function isCheckInRecord(personId: string, source?: HmPerson['recordSource']): Promise<boolean> {
  if (source === 'checkin') return true;
  if (source === 'hm') return false;
  const { data } = await supabase.from('hm_people').select('id').eq('id', personId).maybeSingle();
  return !data?.id;
}

function startOfTodayIso(): string {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return start.toISOString();
}

export function displayPhone(person: HmPerson): string {
  return String(person.extracted_phone || person.phone || '').trim();
}

export function displayName(person: HmPerson): string {
  return String(person.full_name || '').trim() || person.email;
}

export async function loadHmDashboard(): Promise<HmDashboardData> {
  const [metricsRes, people] = await Promise.all([
    supabase.from('hm_metrics_cache').select('payload, pulled_at').eq('cache_key', 'instantly_overview').maybeSingle(),
    loadMergedPeople(),
  ]);

  const payload = (metricsRes.data?.payload || {}) as Record<string, unknown>;
  const totalsRaw = (payload.totals || {}) as Partial<InstantlyTotals>;
  const instantly: InstantlyTotals = {
    sent: Number(totalsRaw.sent) || 0,
    opened: Number(totalsRaw.opened) || 0,
    replies: Number(totalsRaw.replies) || 0,
    interested: Number(totalsRaw.interested) || 0,
    bounced: Number(totalsRaw.bounced) || 0,
    unsubscribed: Number(totalsRaw.unsubscribed) || 0,
  };
  const daily = Array.isArray(payload.daily) ? (payload.daily as InstantlyDailyPoint[]) : [];
  const today = startOfTodayIso();

  return {
    instantly,
    daily,
    pulledAt: metricsRes.data?.pulled_at || null,
    funnel: {
      shortlisted: people.filter((p) => p.shortlisted_email_sent_at).length,
      callReady: people.filter((p) => p.stage === 'call_ready' || p.stage === 'called').length,
      calledToday: people.filter((p) => p.last_called_at && p.last_called_at >= today).length,
      sentToHub: people.filter((p) => p.stage === 'sent_to_hub' || p.sent_to_hub_at).length,
    },
    needsCall: people.filter((p) => displayPhone(p) && p.stage !== 'not_interested').slice(0, 8),
    sentAhead: people.filter((p) => p.stage === 'sent_to_hub' || p.sent_to_hub_at).slice(0, 8),
  };
}

export async function listHmCallQueue(): Promise<HmPerson[]> {
  const people = await loadMergedPeople();
  return people
    .filter((p) => displayPhone(p) && p.stage !== 'not_interested')
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}

export async function listHmSentAhead(): Promise<HmPerson[]> {
  const people = await loadMergedPeople();
  return people
    .filter((p) => p.stage === 'sent_to_hub' || Boolean(p.sent_to_hub_at))
    .sort((a, b) => String(b.sent_to_hub_at || '').localeCompare(String(a.sent_to_hub_at || '')));
}

export async function updateHmPersonPhone(personId: string, phone: string, pipelineCandidateId?: string | null): Promise<void> {
  const trimmed = phone.trim();
  if (await isCheckInRecord(personId)) {
    const full = await getCandidateById(personId);
    if (!full) throw new Error('Check-in not found.');
    await saveCandidate({ ...full, phone: trimmed });
    return;
  }
  const { error } = await supabase
    .from('hm_people')
    .update({ phone: trimmed, extracted_phone: trimmed, updated_at: new Date().toISOString() })
    .eq('id', personId);
  if (error) throw error;
  if (pipelineCandidateId) {
    await savePipelineCandidatePhoneOverride({ candidateId: pipelineCandidateId, phoneInput: trimmed });
  }
}

export async function markHmCalled(personId: string): Promise<void> {
  const now = new Date().toISOString();
  if (await isCheckInRecord(personId)) {
    const full = await getCandidateById(personId);
    if (!full) return;
    await saveCandidate({
      ...full,
      adminData: {
        ...DEFAULT_ADMIN_DATA,
        ...full.adminData,
        lastCalledAt: now,
        nextStep: full.adminData?.nextStep || 'Called from workspace',
      },
    });
    return;
  }
  const { error } = await supabase
    .from('hm_people')
    .update({ last_called_at: now, stage: 'called', updated_at: now })
    .eq('id', personId)
    .neq('stage', 'sent_to_hub');
  if (error) throw error;
}

export async function applyHmDisposition(input: {
  person: HmPerson;
  disposition: PipelineCallDisposition;
  comment?: string;
  callbackAt?: string | null;
  dialedNumber: string;
  dialStartedAt: string;
  actorLabel?: string | null;
}): Promise<void> {
  if (input.person.pipeline_candidate_id) {
    await savePipelineCallDisposition({
      candidateId: input.person.pipeline_candidate_id,
      disposition: input.disposition,
      comment: input.comment,
      dialedNumber: input.dialedNumber,
      dialStartedAt: input.dialStartedAt,
      actorLabel: input.actorLabel,
      callbackAt: input.callbackAt,
      candidateName: input.person.full_name,
      candidateEmail: input.person.email,
    });
  }

  const now = new Date().toISOString();
  if (await isCheckInRecord(input.person.id, input.person.recordSource)) {
    const full = await getCandidateById(input.person.id);
    if (!full) throw new Error('Check-in not found.');
    const tags = new Set(full.adminData?.tags || []);
    if (input.disposition === 'Not interested' || input.disposition === 'Do not call') {
      tags.add('not_interested');
    }
    await saveCandidate({
      ...full,
      adminData: {
        ...DEFAULT_ADMIN_DATA,
        ...full.adminData,
        lastCalledAt: now,
        tags: [...tags],
        nextStep: input.disposition === 'Send to AO Hub' ? 'Sent AO Interview Hub invite' : input.disposition,
      },
    });
    return;
  }

  const patch: Record<string, unknown> = { last_called_at: now, updated_at: now };
  if (input.disposition === 'Not interested' || input.disposition === 'Do not call') {
    patch.stage = 'not_interested';
  } else if (input.disposition === 'Send to AO Hub') {
    patch.stage = 'sent_to_hub';
    patch.sent_to_hub_at = now;
  } else if (input.person.stage !== 'sent_to_hub') {
    patch.stage = 'called';
  }
  const { error } = await supabase.from('hm_people').update(patch).eq('id', input.person.id);
  if (error) throw error;
}

async function invokeHmFunction(
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!supabaseUrl || !anon) throw new Error('Missing Supabase env');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sign in again to refresh Instantly.');
  const res = await fetch(`${supabaseUrl}/functions/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anon,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

export async function refreshInstantlyMetrics(): Promise<void> {
  await invokeHmFunction('hm-instantly-metrics', {});
}

export async function sendAoHubEmail(personId: string): Promise<void> {
  if (await isCheckInRecord(personId)) {
    await sendAoHubInviteForCheckIn(personId);
    return;
  }
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!supabaseUrl || !anon) throw new Error('Missing Supabase env');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sign in again to send email.');
  const res = await fetch(`${supabaseUrl}/functions/v1/hm-instantly-send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anon,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ person_id: personId, template_key: 'ao_hub' }),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(json.error || `Send failed (${res.status})`);
}

export async function listHmCallRecords(people: HmPerson[]): Promise<PipelineCallRecord[]> {
  const ids = people.map((p) => p.pipeline_candidate_id).filter((id): id is string => Boolean(id));
  if (!ids.length) return [];
  return listPipelineCallRecordsForCandidates(ids);
}

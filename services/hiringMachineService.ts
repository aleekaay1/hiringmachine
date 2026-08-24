import { supabase } from './supabaseClient';
import {
  listPipelineCallRecordsForCandidates,
  savePipelineCallDisposition,
  savePipelineCandidatePhoneOverride,
  type PipelineCallRecord,
} from './pipelineService';
import type { PipelineCallDisposition } from './pipelineCallDispositions';

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

const HM_SELECT =
  'id, email, full_name, phone, extracted_email, extracted_phone, instantly_lead_id, campaign_id, campaign_name, instantly_email_id, unibox_url, reply_snippet, last_reply_text, last_reply_subject, stage, positive_source, ai_summary, ai_score, ai_recommendation, shortlisted_email_sent_at, sent_to_hub_at, last_called_at, pipeline_candidate_id, created_at, updated_at';

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
  const [metricsRes, peopleRes] = await Promise.all([
    supabase.from('hm_metrics_cache').select('payload, pulled_at').eq('cache_key', 'instantly_overview').maybeSingle(),
    supabase.from('hm_people').select(HM_SELECT).order('updated_at', { ascending: false }).limit(500),
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
  const people = (peopleRes.data || []) as HmPerson[];
  const today = startOfTodayIso();

  return {
    instantly,
    daily,
    pulledAt: metricsRes.data?.pulled_at || null,
    funnel: {
      shortlisted: people.filter((p) => p.shortlisted_email_sent_at).length,
      callReady: people.filter((p) => p.stage === 'call_ready').length,
      calledToday: people.filter((p) => p.last_called_at && p.last_called_at >= today).length,
      sentToHub: people.filter((p) => p.stage === 'sent_to_hub' || p.sent_to_hub_at).length,
    },
    needsCall: people.filter((p) => p.stage === 'call_ready' && displayPhone(p)).slice(0, 8),
    sentAhead: people.filter((p) => p.stage === 'sent_to_hub' || p.sent_to_hub_at).slice(0, 8),
  };
}

export async function listHmCallQueue(): Promise<HmPerson[]> {
  const { data, error } = await supabase
    .from('hm_people')
    .select(HM_SELECT)
    .in('stage', ['call_ready', 'called'])
    .order('updated_at', { ascending: false })
    .limit(300);
  if (error) throw error;
  return ((data || []) as HmPerson[]).filter((p) => displayPhone(p));
}

export async function listHmSentAhead(): Promise<HmPerson[]> {
  const { data, error } = await supabase
    .from('hm_people')
    .select(HM_SELECT)
    .or('stage.eq.sent_to_hub,sent_to_hub_at.not.is.null')
    .order('sent_to_hub_at', { ascending: false, nullsFirst: false })
    .limit(400);
  if (error) throw error;
  return (data || []) as HmPerson[];
}

export async function updateHmPersonPhone(personId: string, phone: string, pipelineCandidateId?: string | null): Promise<void> {
  const trimmed = phone.trim();
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

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

export const AO_HUB_URL =
  Deno.env.get('AO_INTERVIEW_HUB_URL')?.trim() || 'https://www.aointerview.com/apply/chris-hintz';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, apikey, x-client-info, x-webhook-secret, x-cron-secret, x-instantly-secret',
};

export function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL') || '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeEmail(value: unknown): string {
  return str(value).toLowerCase();
}

export function firstNameFrom(fullName: string | null | undefined, email: string): string {
  const name = str(fullName);
  if (name) return name.split(/\s+/)[0];
  const local = email.split('@')[0] || 'there';
  return local.charAt(0).toUpperCase() + local.slice(1);
}

export type HmTemplateKey = 'shortlisted' | 'ao_hub';

export function buildEmailTemplate(
  template: HmTemplateKey,
  input: { fullName?: string | null; email: string },
): { subject: string; html: string; text: string } {
  const first = firstNameFrom(input.fullName, input.email);
  const hub = AO_HUB_URL;
  if (template === 'shortlisted') {
    const text =
      `Hi ${first},\n\n` +
      `Thanks for getting back to us — we've shortlisted you for the Life Insurance Specialist opportunity with AO Globe Life.\n\n` +
      `A member of our team will reach out by phone shortly to walk you through next steps.\n\n` +
      `Talk soon,\nAO Globe Life recruiting`;
    return {
      subject: 'You have been shortlisted — AO Globe Life',
      text,
      html: text.replace(/\n/g, '<br/>'),
    };
  }
  const text =
    `Hi ${first},\n\n` +
    `You're invited to continue to our interview hub and grab a spot on the next info session.\n\n` +
    `${hub}\n\n` +
    `It takes less than 2 minutes.\n\n` +
    `Best,\nAO Globe Life recruiting`;
  return {
    subject: 'Next step: AO Interview Hub',
    text,
    html:
      `Hi ${first},<br/><br/>` +
      `You're invited to continue to our interview hub and grab a spot on the next info session.<br/><br/>` +
      `<a href="${hub}">Register here → ${hub}</a><br/><br/>` +
      `It takes less than 2 minutes.<br/><br/>` +
      `Best,<br/>AO Globe Life recruiting`,
  };
}

export function webhookSecretOk(req: Request): boolean {
  const expected = Deno.env.get('INSTANTLY_WEBHOOK_SECRET')?.trim() || '';
  if (!expected) return false;
  const header =
    req.headers.get('x-webhook-secret')?.trim() ||
    req.headers.get('x-instantly-secret')?.trim() ||
    '';
  if (header && header === expected) return true;
  const auth = req.headers.get('authorization')?.trim() || '';
  if (auth.toLowerCase().startsWith('bearer ') && auth.slice(7).trim() === expected) return true;
  const query = new URL(req.url).searchParams.get('secret')?.trim() || '';
  return query.length > 0 && query === expected;
}

export function cronSecretOk(req: Request): boolean {
  const expected = Deno.env.get('HM_CRON_SECRET')?.trim() || '';
  if (!expected) return false;
  const header = req.headers.get('x-cron-secret')?.trim() || '';
  if (header && header === expected) return true;
  const auth = req.headers.get('authorization')?.trim() || '';
  if (auth.toLowerCase().startsWith('bearer ') && auth.slice(7).trim() === expected) return true;
  const query = new URL(req.url).searchParams.get('secret')?.trim() || '';
  return query.length > 0 && query === expected;
}

export async function userIsAuthenticated(req: Request, admin: SupabaseClient): Promise<boolean> {
  const auth = req.headers.get('authorization') || '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (!token) return false;
  const { data, error } = await admin.auth.getUser(token);
  return Boolean(!error && data.user);
}

function num(obj: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  }
  return 0;
}

export type InstantlyAnalyticsTotals = {
  sent: number;
  opened: number;
  replies: number;
  interested: number;
  bounced: number;
  unsubscribed: number;
};

export function sumInstantlyAnalytics(rows: unknown[]): InstantlyAnalyticsTotals {
  const totals: InstantlyAnalyticsTotals = {
    sent: 0,
    opened: 0,
    replies: 0,
    interested: 0,
    bounced: 0,
    unsubscribed: 0,
  };
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const obj = row as Record<string, unknown>;
    // Instantly's campaign "Sent" card follows sequence started (contacted), not only emails_sent_count.
    totals.sent += Math.max(
      num(obj, ['contacted_count', 'new_leads_contacted_count', 'leads_contacted']),
      num(obj, ['emails_sent_count', 'emails_sent_count', 'emails_sent', 'email_sent', 'sent']),
    );
    totals.opened += num(obj, [
      'open_count',
      'open_count_unique',
      'unique_open_count',
      'opened',
      'opens',
    ]);
    totals.replies += num(obj, [
      'reply_count',
      'reply_count_unique',
      'unique_reply_count',
      'replies',
      'replied',
    ]);
    totals.interested += num(obj, [
      'total_opportunities',
      'interested',
      'lead_interested',
      'interested_count',
    ]);
    totals.bounced += num(obj, ['bounced_count', 'bounced_count', 'bounce_count', 'bounced', 'email_bounced']);
    totals.unsubscribed += num(obj, [
      'unsubscribed_count',
      'unsubscribed_count',
      'unsubscribe_count',
      'unsubscribed',
    ]);
  }
  return totals;
}

export async function instantlyFetch(path: string, init?: RequestInit): Promise<Response> {
  const key = Deno.env.get('INSTANTLY_API_KEY')?.trim() || '';
  if (!key) throw new Error('INSTANTLY_API_KEY is not set');
  const url = path.startsWith('http') ? path : `https://api.instantly.ai${path.startsWith('/') ? path : `/${path}`}`;
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
}

export async function instantlyReply(input: {
  replyToUuid: string;
  eaccount?: string | null;
  subject: string;
  html: string;
  text: string;
}): Promise<{ id?: string; raw: Record<string, unknown> }> {
  const body: Record<string, unknown> = {
    reply_to_uuid: input.replyToUuid,
    subject: input.subject,
    body: { html: input.html, text: input.text },
  };
  if (input.eaccount) body.eaccount = input.eaccount;
  const res = await instantlyFetch('/api/v2/emails/reply', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = str(raw.error) || str(raw.message) || `Instantly reply failed (${res.status})`;
    throw new Error(msg);
  }
  return { id: str(raw.id) || undefined, raw };
}

export type GroqQualifyResult = {
  interested: boolean;
  ooo: boolean;
  not_interested: boolean;
  score: number;
  summary: string;
  phone: string | null;
  email: string | null;
  full_name: string | null;
  recommendation: string;
};

export async function groqQualify(input: {
  replyText: string;
  leadEmail: string;
  leadName?: string | null;
  extra?: string;
}): Promise<GroqQualifyResult> {
  const key = Deno.env.get('GROQ_API_KEY')?.trim() || '';
  if (!key) throw new Error('GROQ_API_KEY is not set');
  const model = Deno.env.get('GROQ_MODEL')?.trim() || 'llama-3.1-8b-instant';
  const prompt =
    `You qualify recruiting email replies for a Life Insurance Specialist role with AO Globe Life.\n` +
    `Return JSON only with keys: interested (bool), ooo (bool), not_interested (bool), score (0-100), ` +
    `summary (4-6 sentences for a caller), phone (string or null), email (string or null), ` +
    `full_name (string or null), recommendation (call_ready|hold|reject).\n` +
    `Extract any phone number in the reply. Interested means they want to learn more or are open to a call.\n` +
    `OOO means auto out-of-office. not_interested means they declined.\n\n` +
    `Lead email: ${input.leadEmail}\n` +
    `Lead name: ${input.leadName || '(unknown)'}\n` +
    `${input.extra ? `Context: ${input.extra}\n` : ''}` +
    `Reply:\n${input.replyText || '(no reply body — Instantly marked this lead interested)'}`;

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You return strict JSON for recruiting qualification.' },
        { role: 'user', content: prompt },
      ],
    }),
  });
  const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(str((raw as { error?: { message?: string } }).error?.message) || `Groq failed (${res.status})`);
  }
  const choices = Array.isArray(raw.choices) ? raw.choices : [];
  const content = str((choices[0] as { message?: { content?: string } } | undefined)?.message?.content);
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    throw new Error('Groq returned non-JSON content');
  }
  const scoreRaw = Number(parsed.score);
  return {
    interested: Boolean(parsed.interested),
    ooo: Boolean(parsed.ooo),
    not_interested: Boolean(parsed.not_interested),
    score: Number.isFinite(scoreRaw) ? Math.max(0, Math.min(100, Math.round(scoreRaw))) : 0,
    summary: str(parsed.summary) || 'No summary.',
    phone: str(parsed.phone) || null,
    email: normalizeEmail(parsed.email) || null,
    full_name: str(parsed.full_name) || null,
    recommendation: str(parsed.recommendation) || 'hold',
  };
}

export async function acquireGroqLock(admin: SupabaseClient): Promise<boolean> {
  const now = Date.now();
  const { data } = await admin.from('hm_rate_locks').select('last_ran_at').eq('lock_key', 'groq').maybeSingle();
  const last = data?.last_ran_at ? new Date(String(data.last_ran_at)).getTime() : 0;
  if (last && now - last < 60_000) return false;
  const { error } = await admin.from('hm_rate_locks').upsert({
    lock_key: 'groq',
    last_ran_at: new Date().toISOString(),
  });
  if (error) throw error;
  return true;
}

export async function enqueueEmailSend(
  admin: SupabaseClient,
  personId: string,
  template: HmTemplateKey,
  replyToUuid: string | null,
): Promise<void> {
  const { error } = await admin.from('hm_email_sends').insert({
    person_id: personId,
    template_key: template,
    status: 'pending',
    reply_to_uuid: replyToUuid,
  });
  if (error && !String(error.message || '').toLowerCase().includes('duplicate')) {
    throw error;
  }
}

export async function ensurePipelineCandidate(
  admin: SupabaseClient,
  person: {
    id: string;
    email: string;
    full_name: string | null;
    phone: string | null;
    pipeline_candidate_id: string | null;
  },
): Promise<string | null> {
  if (person.pipeline_candidate_id) return person.pipeline_candidate_id;
  const { data, error } = await admin
    .from('pipeline_candidates')
    .insert({
      full_name: person.full_name || person.email,
      email: person.email,
      phone: person.phone,
      source: 'hiring_machine',
      journey_stage: 'qualified',
      status: 'in_progress',
      metadata: { hm_person_id: person.id, source: 'instantly' },
    })
    .select('id')
    .single();
  if (error) {
    console.error('ensurePipelineCandidate', error);
    return null;
  }
  const id = String(data.id);
  await admin.from('hm_people').update({ pipeline_candidate_id: id, updated_at: new Date().toISOString() }).eq('id', person.id);
  return id;
}

export type HmPersonRow = {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  extracted_phone: string | null;
  extracted_email: string | null;
  instantly_email_id: string | null;
  instantly_email_account: string | null;
  stage: string;
  positive_source: string | null;
  shortlisted_email_sent_at: string | null;
  sent_to_hub_at: string | null;
  pipeline_candidate_id: string | null;
  last_reply_text: string | null;
  instantly_interested_at: string | null;
};

export async function sendPendingInstantlyEmails(admin: SupabaseClient, limit = 5): Promise<number> {
  const { data: rows, error } = await admin
    .from('hm_email_sends')
    .select('id, person_id, template_key, reply_to_uuid, status')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  let sent = 0;
  for (const row of rows || []) {
    const sendId = String(row.id);
    const personId = String(row.person_id);
    const template = row.template_key as HmTemplateKey;
    await admin.from('hm_email_sends').update({ status: 'sending', updated_at: new Date().toISOString() }).eq('id', sendId);
    const { data: person } = await admin.from('hm_people').select('*').eq('id', personId).maybeSingle();
    if (!person) {
      await admin.from('hm_email_sends').update({ status: 'failed', error: 'Person missing', updated_at: new Date().toISOString() }).eq('id', sendId);
      continue;
    }
    const replyTo = str(row.reply_to_uuid) || str(person.instantly_email_id);
    if (!replyTo) {
      await admin.from('hm_email_sends').update({
        status: 'failed',
        error: 'No Instantly email id to reply to',
        updated_at: new Date().toISOString(),
      }).eq('id', sendId);
      continue;
    }
    try {
      const tpl = buildEmailTemplate(template, { fullName: person.full_name, email: person.email });
      const result = await instantlyReply({
        replyToUuid: replyTo,
        eaccount: person.instantly_email_account,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
      });
      const now = new Date().toISOString();
      await admin.from('hm_email_sends').update({
        status: 'sent',
        instantly_reply_id: result.id || null,
        sent_at: now,
        updated_at: now,
        error: null,
      }).eq('id', sendId);
      const patch: Record<string, unknown> = { updated_at: now };
      if (template === 'shortlisted') {
        patch.shortlisted_email_sent_at = now;
        if (person.stage === 'replied') patch.stage = 'shortlisted';
      }
      if (template === 'ao_hub') {
        patch.sent_to_hub_at = now;
        patch.stage = 'sent_to_hub';
      }
      await admin.from('hm_people').update(patch).eq('id', personId);
      sent += 1;
    } catch (err) {
      await admin.from('hm_email_sends').update({
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
        updated_at: new Date().toISOString(),
      }).eq('id', sendId);
    }
  }
  return sent;
}

export function extractPhoneFromText(text: string): string | null {
  const match = text.replace(/\s+/g, ' ').match(/(\+?\d[\d().\-\s]{8,}\d)/);
  if (!match) return null;
  const digits = match[1].replace(/[^\d+]/g, '');
  return digits.length >= 10 ? digits : null;
}

export function pickLeadPhone(payload: Record<string, unknown>): string | null {
  const keys = ['phone', 'phone_number', 'mobile', 'lead_phone', 'Phone'];
  for (const key of keys) {
    const v = str(payload[key]);
    if (v) return v;
  }
  const custom = payload.custom_variables;
  if (custom && typeof custom === 'object') {
    for (const key of keys) {
      const v = str((custom as Record<string, unknown>)[key]);
      if (v) return v;
    }
  }
  return null;
}

export function pickLeadName(payload: Record<string, unknown>): string | null {
  const first = str(payload.first_name || payload.firstName);
  const last = str(payload.last_name || payload.lastName);
  const combined = `${first} ${last}`.trim();
  return combined || str(payload.full_name || payload.name || payload.lead_name) || null;
}

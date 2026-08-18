import {
  corsHeaders,
  enqueueEmailSend,
  extractPhoneFromText,
  json,
  normalizeEmail,
  pickLeadName,
  pickLeadPhone,
  serviceClient,
  str,
  webhookSecretOk,
} from '../_shared/hiringMachine.ts';

const TRACKED = new Set([
  'email_sent',
  'email_opened',
  'link_clicked',
  'email_bounced',
  'reply_received',
  'auto_reply_received',
  'lead_interested',
  'lead_not_interested',
  'lead_unsubscribed',
]);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

  if (req.method === 'GET') {
    return json(200, {
      ok: true,
      service: 'instantly-webhook',
      events: [...TRACKED],
    });
  }

  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  if (!Deno.env.get('INSTANTLY_WEBHOOK_SECRET')?.trim()) {
    return json(503, { error: 'INSTANTLY_WEBHOOK_SECRET is not configured' });
  }
  if (!webhookSecretOk(req)) return json(401, { error: 'Invalid webhook secret' });

  let payload: Record<string, unknown> = {};
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  const eventType = str(payload.event_type || payload.eventType || payload.type).toLowerCase();
  if (!eventType) return json(400, { error: 'Missing event_type' });

  const leadEmail = normalizeEmail(payload.lead_email || payload.email || payload.leadEmail);
  const campaignId = str(payload.campaign_id || payload.campaignId) || null;
  const campaignName = str(payload.campaign_name || payload.campaignName) || null;
  const emailId = str(payload.email_id || payload.emailId || payload.reply_to_uuid) || null;
  const timestampRaw = str(payload.timestamp);
  const eventTimestamp = timestampRaw ? new Date(timestampRaw).toISOString() : new Date().toISOString();

  const admin = serviceClient();

  const { error: insertErr } = await admin.from('hm_instantly_events').insert({
    event_type: eventType,
    lead_email: leadEmail || null,
    campaign_id: campaignId,
    campaign_name: campaignName,
    event_timestamp: eventTimestamp,
    instantly_email_id: emailId,
    payload,
  });
  if (insertErr && !String(insertErr.message || '').toLowerCase().includes('duplicate')) {
    return json(500, { error: insertErr.message });
  }

  if (!leadEmail || !TRACKED.has(eventType)) {
    return json(200, { ok: true, ignored: true, event_type: eventType });
  }

  const replyText = str(payload.reply_text || payload.replyText || payload.email_text);
  const replySnippet = str(payload.reply_text_snippet || payload.reply_snippet) || replyText.slice(0, 280);
  const replySubject = str(payload.reply_subject || payload.email_subject);
  const unibox = str(payload.unibox_url);
  const emailAccount = str(payload.email_account);
  const phoneFromPayload = pickLeadPhone(payload) || extractPhoneFromText(replyText);
  const nameFromPayload = pickLeadName(payload);

  const { data: existing } = await admin.from('hm_people').select('*').ilike('email', leadEmail).maybeSingle();

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    email: leadEmail,
    updated_at: now,
    campaign_id: campaignId || existing?.campaign_id || null,
    campaign_name: campaignName || existing?.campaign_name || null,
    raw_lead: payload,
  };
  if (emailId) patch.instantly_email_id = emailId;
  if (emailAccount) patch.instantly_email_account = emailAccount;
  if (unibox) patch.unibox_url = unibox;
  if (replySnippet) patch.reply_snippet = replySnippet;
  if (replyText) patch.last_reply_text = replyText;
  if (replySubject) patch.last_reply_subject = replySubject;
  if (phoneFromPayload && !existing?.phone) patch.phone = phoneFromPayload;
  if (nameFromPayload && !existing?.full_name) patch.full_name = nameFromPayload;

  const terminal = existing?.stage === 'sent_to_hub' || existing?.stage === 'not_interested';

  if (eventType === 'lead_not_interested' || eventType === 'lead_unsubscribed') {
    patch.stage = 'not_interested';
    patch.qualify_status = 'skipped';
  } else if (eventType === 'auto_reply_received') {
    if (!terminal) patch.stage = 'ooo';
    patch.qualify_status = existing?.qualify_status === 'done' ? existing.qualify_status : 'pending';
  } else if (eventType === 'lead_interested') {
    patch.instantly_interested_at = now;
    if (!existing?.positive_source) patch.positive_source = 'instantly';
    if (!terminal && existing?.stage !== 'call_ready' && existing?.stage !== 'called' && existing?.stage !== 'shortlisted') {
      patch.stage = 'replied';
    }
    if (existing?.qualify_status !== 'done') patch.qualify_status = 'pending';
  } else if (eventType === 'reply_received') {
    if (!terminal && !existing?.stage) patch.stage = 'replied';
    if (!terminal && existing?.stage !== 'call_ready' && existing?.stage !== 'called' && existing?.stage !== 'sent_to_hub') {
      patch.stage = existing?.stage && existing.stage !== 'ooo' ? existing.stage : 'replied';
    }
    if (existing?.qualify_status !== 'done') patch.qualify_status = 'pending';
  }

  if (existing?.id) {
    const { error } = await admin.from('hm_people').update(patch).eq('id', existing.id);
    if (error) return json(500, { error: error.message });
    if (eventType === 'lead_interested' && !existing.shortlisted_email_sent_at) {
      await enqueueEmailSend(admin, existing.id, 'shortlisted', emailId || existing.instantly_email_id);
    }
    return json(200, { ok: true, person_id: existing.id, event_type: eventType });
  }

  const insertRow = {
    ...patch,
    stage: patch.stage || 'replied',
    qualify_status: patch.qualify_status || (eventType === 'reply_received' || eventType === 'lead_interested' ? 'pending' : 'none'),
    created_at: now,
  };
  const { data: created, error: createErr } = await admin.from('hm_people').insert(insertRow).select('id').single();
  if (createErr) return json(500, { error: createErr.message });
  if (eventType === 'lead_interested') {
    await enqueueEmailSend(admin, created.id, 'shortlisted', emailId);
  }
  return json(200, { ok: true, person_id: created.id, event_type: eventType });
});

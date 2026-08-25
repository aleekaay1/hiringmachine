import {
  corsHeaders,
  cronSecretOk,
  extractPhoneFromText,
  instantlyFetch,
  json,
  normalizeEmail,
  pickLeadName,
  pickLeadPhone,
  serviceClient,
  str,
  userIsAuthenticated,
} from '../_shared/hiringMachine.ts';

type InstantlyEmail = Record<string, unknown>;

function asItems(payload: unknown): InstantlyEmail[] {
  if (Array.isArray(payload)) return payload as InstantlyEmail[];
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.items)) return obj.items as InstantlyEmail[];
    if (Array.isArray(obj.data)) return obj.data as InstantlyEmail[];
    if (Array.isArray(obj.emails)) return obj.emails as InstantlyEmail[];
  }
  return [];
}

function nextCursor(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const obj = payload as Record<string, unknown>;
  return str(
    obj.next_starting_after ||
      obj.next_starting_after_id ||
      obj.starting_after ||
      obj.next_cursor ||
      obj.next,
  );
}

function bodyText(item: InstantlyEmail): string {
  const body = item.body;
  if (typeof body === 'string') return body.trim();
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    const text = str(obj.text || obj.plain || obj.preview);
    if (text) return text;
    const html = str(obj.html);
    if (html) {
      return html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
  }
  return str(item.snippet || item.preview || item.text || item.reply_text);
}

function leadEmailFrom(item: InstantlyEmail): string {
  return normalizeEmail(
    item.lead ||
      item.lead_email ||
      item.from_address_email ||
      item.from_email ||
      item.from,
  );
}

async function fetchReceivedPage(params: URLSearchParams): Promise<{ items: InstantlyEmail[]; cursor: string; error?: string }> {
  const res = await instantlyFetch(`/api/v2/emails?${params.toString()}`);
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    return {
      items: [],
      cursor: '',
      error: str((payload as { message?: string; error?: string } | null)?.message) ||
        str((payload as { error?: string } | null)?.error) ||
        `Instantly emails failed (${res.status})`,
    };
  }
  return { items: asItems(payload), cursor: nextCursor(payload) };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method === 'GET') return json(200, { ok: true, service: 'hm-instantly-replies' });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const admin = serviceClient();
  const cronOk = cronSecretOk(req);
  const userOk = await userIsAuthenticated(req, admin);
  if (!cronOk && !userOk) return json(401, { error: 'Unauthorized' });

  const campaignIds = (Deno.env.get('INSTANTLY_CAMPAIGN_IDS') || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

  const queries: URLSearchParams[] = [];
  if (campaignIds.length) {
    for (const id of campaignIds) {
      const qs = new URLSearchParams({
        email_type: 'received',
        limit: '100',
        latest_of_thread: 'true',
        campaign_id: id,
      });
      queries.push(qs);
    }
  } else {
    queries.push(new URLSearchParams({
      email_type: 'received',
      limit: '100',
      latest_of_thread: 'true',
    }));
  }

  const seen = new Set<string>();
  const collected: InstantlyEmail[] = [];
  const errors: string[] = [];

  for (const base of queries) {
    let cursor = '';
    for (let page = 0; page < 5; page += 1) {
      const qs = new URLSearchParams(base);
      if (cursor) qs.set('starting_after', cursor);
      const pageRes = await fetchReceivedPage(qs);
      if (pageRes.error) {
        errors.push(pageRes.error);
        break;
      }
      for (const item of pageRes.items) {
        const id = str(item.id) || `${leadEmailFrom(item)}:${str(item.timestamp_created || item.timestamp)}`;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        collected.push(item);
      }
      if (!pageRes.cursor || pageRes.items.length === 0) break;
      cursor = pageRes.cursor;
    }
  }

  let upserted = 0;
  for (const item of collected) {
    const email = leadEmailFrom(item);
    if (!email) continue;
    const text = bodyText(item);
    const subject = str(item.subject || item.email_subject);
    const emailId = str(item.id);
    const threadId = str(item.thread_id || item.threadId);
    const campaignId = str(item.campaign_id || item.campaignId) || null;
    const account = str(item.eaccount || item.email_account);
    const timestampRaw = str(item.timestamp_created || item.timestamp_email || item.timestamp);
    const eventAt = timestampRaw ? new Date(timestampRaw).toISOString() : new Date().toISOString();
    const name =
      pickLeadName(item) ||
      str((item.from_address_json as Record<string, unknown> | undefined)?.name) ||
      null;
    const phone = pickLeadPhone(item) || extractPhoneFromText(text);
    const unibox = threadId
      ? `https://app.instantly.ai/app/unibox?thread=${encodeURIComponent(threadId)}`
      : '';

    const { error: eventErr } = await admin.from('hm_instantly_events').insert({
      event_type: 'reply_received',
      lead_email: email,
      campaign_id: campaignId,
      campaign_name: str(item.campaign_name) || null,
      event_timestamp: eventAt,
      instantly_email_id: emailId || null,
      payload: item,
    });
    if (eventErr && !String(eventErr.message || '').toLowerCase().includes('duplicate')) {
      console.warn('hm_instantly_events insert', eventErr.message);
    }

    const { data: existing } = await admin.from('hm_people').select('*').ilike('email', email).maybeSingle();
    const now = new Date().toISOString();
    const terminal = existing?.stage === 'sent_to_hub' || existing?.stage === 'not_interested';
    const patch: Record<string, unknown> = {
      email,
      updated_at: now,
      campaign_id: campaignId || existing?.campaign_id || null,
      campaign_name: str(item.campaign_name) || existing?.campaign_name || null,
      raw_lead: item,
    };
    if (emailId) patch.instantly_email_id = emailId;
    if (account) patch.instantly_email_account = account;
    if (unibox) patch.unibox_url = unibox;
    if (text) {
      patch.last_reply_text = text;
      patch.reply_snippet = text.slice(0, 280);
    }
    if (subject) patch.last_reply_subject = subject;
    if (phone && !existing?.phone && !existing?.extracted_phone) {
      patch.phone = phone;
      patch.extracted_phone = phone;
    }
    if (name && !existing?.full_name) patch.full_name = name;
    if (!terminal) {
      if (phone) patch.stage = existing?.stage === 'called' ? 'called' : 'call_ready';
      else if (!existing?.stage || existing.stage === 'ooo') patch.stage = 'replied';
      if (existing?.qualify_status !== 'done') patch.qualify_status = 'pending';
    }

    if (existing?.id) {
      const { error } = await admin.from('hm_people').update(patch).eq('id', existing.id);
      if (error) {
        errors.push(error.message);
        continue;
      }
    } else {
      const { error } = await admin.from('hm_people').insert({
        ...patch,
        stage: patch.stage || (phone ? 'call_ready' : 'replied'),
        qualify_status: patch.qualify_status || 'pending',
      });
      if (error) {
        errors.push(error.message);
        continue;
      }
    }
    upserted += 1;
  }

  return json(200, {
    ok: true,
    fetched: collected.length,
    upserted,
    errors: errors.slice(0, 5),
  });
});

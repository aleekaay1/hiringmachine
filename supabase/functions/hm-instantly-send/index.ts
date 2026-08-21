import {
  corsHeaders,
  cronSecretOk,
  enqueueEmailSend,
  instantlyReply,
  json,
  sendPendingInstantlyEmails,
  serviceClient,
  str,
  userIsAuthenticated,
} from '../_shared/hiringMachine.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method === 'GET') return json(200, { ok: true, service: 'hm-instantly-send' });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const admin = serviceClient();
  const cronOk = cronSecretOk(req);
  const userOk = await userIsAuthenticated(req, admin);
  if (!cronOk && !userOk) return json(401, { error: 'Unauthorized' });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const personId = str(body.person_id || body.personId);
  const template = str(body.template_key || body.template) as 'shortlisted' | 'ao_hub' | '';
  const customSubject = str(body.subject);
  const customText = str(body.body_text || body.bodyText || body.text);
  const customHtml = str(body.body_html || body.bodyHtml || body.html);

  // Admin-edited email: send immediately via Instantly thread reply.
  if (personId && customSubject && (customText || customHtml)) {
    const { data: person } = await admin.from('hm_people').select('*').eq('id', personId).maybeSingle();
    if (!person) return json(404, { error: 'Person not found' });
    const replyTo = str(person.instantly_email_id);
    if (!replyTo) return json(400, { error: 'No Instantly email id to reply to' });
    try {
      const html = customHtml || customText.replace(/\n/g, '<br/>');
      const text = customText || customHtml.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
      const result = await instantlyReply({
        replyToUuid: replyTo,
        eaccount: person.instantly_email_account,
        subject: customSubject,
        html,
        text,
      });
      const now = new Date().toISOString();
      await admin.from('hm_people').update({
        sent_to_hub_at: now,
        stage: 'sent_to_hub',
        updated_at: now,
      }).eq('id', personId);
      await admin.from('hm_email_sends').insert({
        person_id: personId,
        template_key: 'ao_hub',
        status: 'sent',
        reply_to_uuid: replyTo,
        instantly_reply_id: result.id || null,
        sent_at: now,
        payload: { subject: customSubject, custom: true },
      });
      return json(200, { ok: true, emails_sent: 1, channel: 'instantly_custom' });
    } catch (err) {
      return json(500, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (personId && (template === 'shortlisted' || template === 'ao_hub')) {
    const { data: person } = await admin.from('hm_people').select('*').eq('id', personId).maybeSingle();
    if (!person) return json(404, { error: 'Person not found' });
    await enqueueEmailSend(admin, person.id, template, person.instantly_email_id);
  }

  const sent = await sendPendingInstantlyEmails(admin, personId ? 3 : 8);
  return json(200, { ok: true, emails_sent: sent });
});

import {
  corsHeaders,
  cronSecretOk,
  enqueueEmailSend,
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

  if (personId && (template === 'shortlisted' || template === 'ao_hub')) {
    const { data: person } = await admin.from('hm_people').select('*').eq('id', personId).maybeSingle();
    if (!person) return json(404, { error: 'Person not found' });
    await enqueueEmailSend(admin, person.id, template, person.instantly_email_id);
  }

  const sent = await sendPendingInstantlyEmails(admin, personId ? 3 : 8);
  return json(200, { ok: true, emails_sent: sent });
});

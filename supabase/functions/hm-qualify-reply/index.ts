import {
  acquireGroqLock,
  corsHeaders,
  cronSecretOk,
  enqueueEmailSend,
  ensurePipelineCandidate,
  extractPhoneFromText,
  groqQualify,
  json,
  normalizeEmail,
  sendPendingInstantlyEmails,
  serviceClient,
  str,
} from '../_shared/hiringMachine.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method === 'GET') return json(200, { ok: true, service: 'hm-qualify-reply' });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  if (!cronSecretOk(req)) return json(401, { error: 'Invalid cron secret' });

  const admin = serviceClient();
  const locked = await acquireGroqLock(admin);
  if (!locked) return json(200, { ok: true, skipped: 'rate_limit' });

  const stale = new Date(Date.now() - 5 * 60_000).toISOString();
  await admin
    .from('hm_people')
    .update({ qualify_status: 'pending', qualify_claimed_at: null, updated_at: new Date().toISOString() })
    .eq('qualify_status', 'claimed')
    .lt('qualify_claimed_at', stale);

  const { data: person, error } = await admin
    .from('hm_people')
    .select('*')
    .eq('qualify_status', 'pending')
    .order('updated_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) return json(500, { error: error.message });
  if (!person) {
    const sent = await sendPendingInstantlyEmails(admin, 1);
    return json(200, { ok: true, qualified: 0, emails_sent: sent });
  }

  const claimedAt = new Date().toISOString();
  await admin.from('hm_people').update({
    qualify_status: 'claimed',
    qualify_claimed_at: claimedAt,
    updated_at: claimedAt,
  }).eq('id', person.id);

  try {
    const extra = person.instantly_interested_at
      ? 'Instantly already labeled this lead as interested.'
      : '';
    const result = await groqQualify({
      replyText: str(person.last_reply_text) || str(person.reply_snippet),
      leadEmail: person.email,
      leadName: person.full_name,
      extra,
    });

    const phone = result.phone || person.extracted_phone || person.phone || extractPhoneFromText(str(person.last_reply_text));
    const email = result.email || person.extracted_email || person.email;
    const fullName = result.full_name || person.full_name;
    const groqPositive = result.interested && !result.ooo && !result.not_interested;
    const instantlyPositive = Boolean(person.instantly_interested_at);
    const positive = groqPositive || instantlyPositive;

    let stage = person.stage as string;
    if (result.ooo && !positive) stage = 'ooo';
    if (result.not_interested && !instantlyPositive) stage = 'not_interested';

    if (positive && stage !== 'sent_to_hub' && stage !== 'not_interested') {
      if (phone) stage = 'call_ready';
      else if (person.shortlisted_email_sent_at) stage = 'shortlisted';
      else stage = 'replied';
    }

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {
      qualify_status: 'done',
      qualify_error: null,
      updated_at: now,
      ai_summary: result.summary,
      ai_score: result.score,
      ai_recommendation: result.recommendation,
      ai_raw: result,
      extracted_phone: phone,
      extracted_email: normalizeEmail(email) || person.email,
      phone: phone || person.phone,
      full_name: fullName || person.full_name,
      stage,
    };
    if (groqPositive) {
      patch.groq_positive_at = now;
      if (!person.positive_source) patch.positive_source = 'groq';
    }

    if (positive && phone) {
      const pipelineId = await ensurePipelineCandidate(admin, {
        id: person.id,
        email: person.email,
        full_name: fullName || person.full_name,
        phone,
        pipeline_candidate_id: person.pipeline_candidate_id,
      });
      if (pipelineId) patch.pipeline_candidate_id = pipelineId;
    }

    await admin.from('hm_people').update(patch).eq('id', person.id);

    if (positive && !person.shortlisted_email_sent_at) {
      await enqueueEmailSend(admin, person.id, 'shortlisted', person.instantly_email_id);
    }

    const sent = await sendPendingInstantlyEmails(admin, 1);
    return json(200, {
      ok: true,
      person_id: person.id,
      positive,
      stage,
      emails_sent: sent,
    });
  } catch (err) {
    await admin.from('hm_people').update({
      qualify_status: 'failed',
      qualify_error: err instanceof Error ? err.message : String(err),
      updated_at: new Date().toISOString(),
    }).eq('id', person.id);
    return json(500, { error: err instanceof Error ? err.message : String(err) });
  }
});

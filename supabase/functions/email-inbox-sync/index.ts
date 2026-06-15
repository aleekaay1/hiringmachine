import { ImapFlow } from 'npm:imapflow@1.0.181';
import { createClient } from 'npm:@supabase/supabase-js@2';
import PostalMime from 'npm:postal-mime@2.4.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SEND_LOG_SELECT =
  'id,source,trigger_label,from_email,to_email,cc_email,subject,candidate_id,status,created_at,error_message,metadata';

function isUuid(value: string): boolean {
  return UUID_RE.test(String(value || '').trim());
}

function emailFromAddress(addr?: { address?: string | null } | null): string {
  return String(addr?.address || '').trim().toLowerCase();
}

function toCsv(list?: Array<{ address?: string | null }> | null): string | null {
  const vals = (list || [])
    .map((x) => String(x?.address || '').trim().toLowerCase())
    .filter(Boolean);
  return vals.length ? vals.join(', ') : null;
}

function safeMessageId(id: string | null | undefined, uid: number): string {
  const clean = String(id || '').trim();
  if (clean) return clean;
  return `imap-uid-${uid}`;
}

function compactText(v: string): string {
  return v
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function stripHtml(v: string): string {
  return compactText(
    v
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>'),
  );
}

async function extractSnippetFromSource(source: Uint8Array | null | undefined): Promise<string | null> {
  if (!source || source.length === 0) return null;
  try {
    const parser = new PostalMime();
    const parsed = await parser.parse(source);
    const textBody = compactText(String(parsed.text || ''));
    if (textBody) return textBody.slice(0, 800);
    const htmlBody = stripHtml(String(parsed.html || ''));
    if (htmlBody) return htmlBody.slice(0, 800);
    return null;
  } catch {
    const fallback = compactText(new TextDecoder().decode(source));
    return fallback ? fallback.slice(0, 800) : null;
  }
}

function normalizeEmail(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function dedupeById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

async function buildPipelineCandidateEmailMap(
  admin: ReturnType<typeof createClient>,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await admin
      .from('pipeline_candidates')
      .select('id, email, metadata')
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    if (!rows.length) break;

    for (const row of rows) {
      const id = String((row as { id?: string }).id || '').trim();
      if (!id) continue;
      const record = row as { email?: string | null; metadata?: Record<string, unknown> | null };
      const metadata = record.metadata && typeof record.metadata === 'object' ? record.metadata : {};
      const emails = [record.email, metadata.email_override, metadata.email_original_extracted];
      for (const raw of emails) {
        const email = normalizeEmail(raw);
        if (email) map.set(email, id);
      }
    }

    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  return map;
}

async function remapUnmappedInboxLogs(
  admin: ReturnType<typeof createClient>,
  candidateByEmail: Map<string, string>,
): Promise<number> {
  let remapped = 0;
  let cursor = 0;
  const pageSize = 500;

  while (true) {
    const { data: unmappedRows, error } = await admin
      .from('email_inbox_logs')
      .select('id, from_email')
      .is('candidate_id', null)
      .range(cursor, cursor + pageSize - 1);
    if (error) throw error;
    if (!unmappedRows?.length) break;

    for (const row of unmappedRows) {
      const mappedId = candidateByEmail.get(normalizeEmail(row.from_email));
      if (!mappedId) continue;
      const { error: updateErr } = await admin
        .from('email_inbox_logs')
        .update({ candidate_id: mappedId, updated_at: new Date().toISOString() })
        .eq('id', row.id);
      if (!updateErr) remapped += 1;
    }

    if (unmappedRows.length < pageSize) break;
    cursor += pageSize;
  }

  return remapped;
}

async function upsertInboxRowsInChunks(
  admin: ReturnType<typeof createClient>,
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  const chunkSize = 75;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await admin.from('email_inbox_logs').upsert(chunk, { onConflict: 'message_id' });
    if (error) throw error;
  }
}

async function userCanAccessCandidate(
  admin: ReturnType<typeof createClient>,
  userId: string,
  candidateId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from('pipeline_candidates')
    .select('id')
    .eq('id', candidateId)
    .or(`uploader_user_id.eq.${userId},assigned_to_user_id.eq.${userId}`)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data?.id);
}

async function listInboxLogs(
  admin: ReturnType<typeof createClient>,
  candidateId: string,
  emails: string[],
  limit: number,
): Promise<Record<string, unknown>[]> {
  const normalizedEmails = [...new Set(emails.map(normalizeEmail).filter(Boolean))];
  const queries: Promise<{ data: unknown[] | null; error: { message: string } | null }>[] = [];

  if (isUuid(candidateId)) {
    queries.push(
      admin
        .from('email_inbox_logs')
        .select('*')
        .eq('candidate_id', candidateId)
        .order('received_at', { ascending: false })
        .limit(limit),
    );
  }
  if (normalizedEmails.length) {
    queries.push(
      admin
        .from('email_inbox_logs')
        .select('*')
        .in('from_email', normalizedEmails)
        .order('received_at', { ascending: false })
        .limit(limit),
    );
  }

  if (!queries.length) return [];

  const results = await Promise.all(queries);
  const firstError = results.find((result) => result.error)?.error;
  if (firstError) throw firstError;

  const merged = dedupeById(
    results.flatMap((result) => (result.data || []) as Array<{ id: string }>),
  );
  return merged
    .sort(
      (a, b) =>
        new Date(String((b as { received_at?: string }).received_at || 0)).getTime() -
        new Date(String((a as { received_at?: string }).received_at || 0)).getTime(),
    )
    .slice(0, limit) as Record<string, unknown>[];
}

async function listSendLogs(
  admin: ReturnType<typeof createClient>,
  candidateId: string,
  emails: string[],
  limit: number,
): Promise<Record<string, unknown>[]> {
  const normalizedEmails = [...new Set(emails.map(normalizeEmail).filter(Boolean))];
  const queries: Promise<{ data: unknown[] | null; error: { message: string } | null }>[] = [];

  if (isUuid(candidateId)) {
    queries.push(
      admin
        .from('email_send_logs')
        .select(SEND_LOG_SELECT)
        .eq('candidate_id', candidateId)
        .order('created_at', { ascending: false })
        .limit(limit),
    );
  }
  if (normalizedEmails.length) {
    queries.push(
      admin
        .from('email_send_logs')
        .select(SEND_LOG_SELECT)
        .in('to_email', normalizedEmails)
        .order('created_at', { ascending: false })
        .limit(limit),
    );
  }

  if (!queries.length) return [];

  const results = await Promise.all(queries);
  const firstError = results.find((result) => result.error)?.error;
  if (firstError) throw firstError;

  const merged = dedupeById(
    results.flatMap((result) => (result.data || []) as Array<{ id: string }>),
  );
  return merged
    .sort(
      (a, b) =>
        new Date(String((b as { created_at?: string }).created_at || 0)).getTime() -
        new Date(String((a as { created_at?: string }).created_at || 0)).getTime(),
    )
    .slice(0, limit) as Record<string, unknown>[];
}

async function handleListMail(
  admin: ReturnType<typeof createClient>,
  userId: string,
  body: { candidateId?: string; emails?: string[]; limit?: number },
): Promise<Response> {
  const candidateId = String(body.candidateId || '').trim();
  if (!isUuid(candidateId)) {
    return new Response(JSON.stringify({ error: 'Valid candidateId is required.' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const canAccess = await userCanAccessCandidate(admin, userId, candidateId);
  if (!canAccess) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const emails = Array.isArray(body.emails)
    ? body.emails.filter((v): v is string => typeof v === 'string')
    : [];
  const limit = Math.max(10, Math.min(1000, Number(body.limit || 1000)));

  const [incoming, sendLogs] = await Promise.all([
    listInboxLogs(admin, candidateId, emails, limit),
    listSendLogs(admin, candidateId, emails, Math.min(limit, 500)),
  ]);

  return new Response(JSON.stringify({ ok: true, incoming, sendLogs }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function handleSyncMail(
  admin: ReturnType<typeof createClient>,
  body: { days?: number; limit?: number; fullHistory?: boolean },
): Promise<Response> {
  const smtpUser = Deno.env.get('SMTP_USERNAME')?.trim();
  const smtpPass = Deno.env.get('SMTP_PASSWORD')?.trim();
  const imapHost = Deno.env.get('IMAP_HOSTNAME')?.trim() || 'imap.gmail.com';
  const imapPortRaw = Number(Deno.env.get('IMAP_PORT') || 993);
  const imapSecure = (Deno.env.get('IMAP_SECURE') ?? 'true') === 'true';

  if (!smtpUser || !smtpPass) {
    return new Response(JSON.stringify({ error: 'Missing SMTP_USERNAME or SMTP_PASSWORD for inbox sync.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const fullHistory = body.fullHistory === true;
  const days = Math.max(1, Math.min(fullHistory ? 540 : 90, Number(body.days || (fullHistory ? 365 : 30))));
  const limit = Math.max(10, Math.min(fullHistory ? 600 : 300, Number(body.limit || (fullHistory ? 400 : 150))));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const candidateByEmail = await buildPipelineCandidateEmailMap(admin);

  const imap = new ImapFlow({
    host: imapHost,
    port: Number.isFinite(imapPortRaw) ? imapPortRaw : 993,
    secure: imapSecure,
    auth: { user: smtpUser, pass: smtpPass },
    logger: false,
    connectionTimeout: 30000,
    greetingTimeout: 20000,
    socketTimeout: 120000,
  });

  await imap.connect();
  const lock = await imap.getMailboxLock('INBOX');

  const rows: Array<Record<string, unknown>> = [];
  try {
    const uids = await imap.search({ since });
    const selected = uids.length > limit ? uids.slice(-limit) : uids;
    for await (const msg of imap.fetch(selected, { uid: true, envelope: true, internalDate: true, source: true })) {
      const env = msg.envelope;
      const fromEmail = emailFromAddress(env?.from?.[0]);
      if (!fromEmail) continue;
      const messageId = safeMessageId(env?.messageId || null, Number(msg.uid || 0));
      const subject = String(env?.subject || '').trim() || null;
      const bodySnippet = await extractSnippetFromSource(msg.source as Uint8Array | null | undefined);
      const snippet = bodySnippet || (subject ? subject.slice(0, 220) : null);
      rows.push({
        provider: 'imap',
        message_id: messageId,
        thread_id: null,
        from_email: fromEmail,
        to_email: toCsv(env?.to || null),
        cc_email: toCsv(env?.cc || null),
        subject,
        snippet,
        received_at: (msg.internalDate || new Date()).toISOString(),
        raw_headers: {
          from_name: String(env?.from?.[0]?.name || ''),
          to_count: Array.isArray(env?.to) ? env.to.length : 0,
          cc_count: Array.isArray(env?.cc) ? env.cc.length : 0,
        },
      });
    }
  } finally {
    lock.release();
    await imap.logout();
  }

  if (rows.length === 0) {
    const remappedOnly = await remapUnmappedInboxLogs(admin, candidateByEmail);
    return new Response(JSON.stringify({ ok: true, synced: 0, mapped: 0, remapped: remappedOnly }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const withCandidate = rows.map((r) => ({
    ...r,
    candidate_id: candidateByEmail.get(normalizeEmail(r.from_email)) || null,
    updated_at: new Date().toISOString(),
  }));

  await upsertInboxRowsInChunks(admin, withCandidate);

  const remapped = await remapUnmappedInboxLogs(admin, candidateByEmail);
  const mapped = withCandidate.filter((r) => !!r.candidate_id).length + remapped;
  return new Response(
    JSON.stringify({
      ok: true,
      synced: withCandidate.length,
      mapped,
      remapped,
      scanned: rows.length,
      windowDays: days,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    },
  );
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: authData, error: authErr } = await supabase.auth.getUser();
    if (authErr || !authData.user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired session' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(supabaseUrl, serviceRole);
    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      candidateId?: string;
      emails?: string[];
      limit?: number;
      days?: number;
      fullHistory?: boolean;
    };

    if (body.action === 'list') {
      return await handleListMail(admin, authData.user.id, body);
    }

    return await handleSyncMail(admin, body);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const imapHint = /auth|invalid credentials|login|credentials/i.test(message)
      ? ' Check SMTP app password / IMAP access for the mailbox.'
      : '';
    return new Response(JSON.stringify({ error: `${message}${imapHint}` }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

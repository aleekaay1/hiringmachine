// Bulk mass email via SMTP with gaps + 500/day per from-address.
// Deploy: supabase functions deploy hm-bulk-email --project-ref ofhcnsuwrhyvxtvtdunw
// Extra senders: Edge secret BULK_SMTP_ACCOUNTS JSON
//   [{"email":"apply@globelife-pazao.com","password":"xxxx xxxx xxxx xxxx"}]

import nodemailer from 'npm:nodemailer@6.9.10';
import type { Transporter } from 'npm:nodemailer@6.9.10';
import {
  corsHeaders,
  cronSecretOk,
  json,
  normalizeEmail,
  serviceClient,
  str,
  userIsAuthenticated,
} from '../_shared/hiringMachine.ts';
import { insertEmailSendLog } from '../_shared/emailSendLog.ts';

const DEFAULT_GAP = 120;
const MIN_GAP = 90;
const DEFAULT_DAILY_CAP = 500;
const HARD_DAILY_CAP = 500;
const BUSINESS_TZ = 'America/Los_Angeles';

type RecipientInput = { name?: string; email?: string; row_index?: number; raw?: Record<string, unknown> };

type SmtpAccount = {
  email: string;
  user: string;
  pass: string;
  label: string;
};

function smtpHostConfig() {
  const host = Deno.env.get('SMTP_HOSTNAME')?.trim() || 'smtp.gmail.com';
  const port = Number(Deno.env.get('SMTP_PORT') ?? 587);
  const secure = (Deno.env.get('SMTP_SECURE') ?? 'false') === 'true';
  return {
    host,
    port: Number.isNaN(port) ? 587 : port,
    secure,
    ...(port === 587 && !secure ? { requireTLS: true } : {}),
  };
}

function listSmtpAccounts(): SmtpAccount[] {
  const accounts: SmtpAccount[] = [];
  const seen = new Set<string>();

  const push = (emailRaw: string, passRaw: string, userRaw?: string, label?: string) => {
    const email = bareEmailAddress(emailRaw);
    const pass = String(passRaw || '').replace(/\s+/g, '').trim();
    const user = bareEmailAddress(userRaw || emailRaw) || email;
    if (!email || !email.includes('@') || !pass || seen.has(email)) return;
    seen.add(email);
    accounts.push({ email, user, pass, label: label || email });
  };

  const primaryUser = Deno.env.get('SMTP_USERNAME')?.trim() || '';
  const primaryPass = Deno.env.get('SMTP_PASSWORD')?.trim() || '';
  const primaryFrom = Deno.env.get('SMTP_FROM')?.trim() || primaryUser;
  if (primaryUser && primaryPass) {
    push(primaryFrom || primaryUser, primaryPass, primaryUser, 'Primary SMTP');
  }

  const rawExtra = Deno.env.get('BULK_SMTP_ACCOUNTS')?.trim() || '';
  if (rawExtra) {
    try {
      const parsed = JSON.parse(rawExtra) as unknown;
      const list = Array.isArray(parsed) ? parsed : [];
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const row = item as Record<string, unknown>;
        const email = str(row.email || row.from || row.username || row.user);
        const pass = str(row.password || row.pass || row.app_password || row.appPassword);
        const user = str(row.user || row.username || email);
        const label = str(row.label) || email;
        if (email && pass) push(email, pass, user, label);
      }
    } catch (err) {
      console.error('Invalid BULK_SMTP_ACCOUNTS JSON', err);
    }
  }

  return accounts;
}

function getTransportFor(account: SmtpAccount): Transporter {
  const cfg = smtpHostConfig();
  return nodemailer.createTransport({
    ...cfg,
    auth: { user: account.user, pass: account.pass },
  });
}

/** Inbox display name — e.g. AO Globelife <apply@…> */
function smtpFromName(): string {
  return (Deno.env.get('SMTP_FROM_NAME')?.trim() || 'AO Globelife')
    .replace(/["<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'AO Globelife';
}

function bareEmailAddress(value: string): string {
  const raw = String(value || '').trim();
  const angled = raw.match(/<([^>]+)>/);
  if (angled?.[1]) return normalizeEmail(angled[1]);
  return normalizeEmail(raw);
}

function formatFromHeader(email: string): { name: string; address: string } {
  return {
    name: smtpFromName(),
    address: bareEmailAddress(email),
  };
}

function defaultFromEmail(): string {
  const accounts = listSmtpAccounts();
  if (accounts[0]) return accounts[0].email;
  return (
    Deno.env.get('SMTP_FROM')?.trim() ||
    Deno.env.get('SMTP_USERNAME')?.trim() ||
    'noreply@example.com'
  );
}

function findAccount(emailOrAuto: string | null | undefined): SmtpAccount | null {
  const accounts = listSmtpAccounts();
  if (!accounts.length) return null;
  const wanted = normalizeEmail(emailOrAuto);
  if (!wanted || wanted === 'auto') return accounts[0];
  return accounts.find((a) => a.email === wanted) || null;
}

async function dailySentFor(
  admin: ReturnType<typeof serviceClient>,
  fromEmail: string,
): Promise<number> {
  const email = bareEmailAddress(fromEmail) || normalizeEmail(fromEmail);
  const { data } = await admin
    .from('hm_bulk_daily_counts')
    .select('sent_count')
    .eq('send_date', businessDayDate())
    .eq('from_email', email)
    .maybeSingle();
  return data?.sent_count || 0;
}

async function bumpDailySent(
  admin: ReturnType<typeof serviceClient>,
  fromEmail: string,
): Promise<number> {
  const email = bareEmailAddress(fromEmail) || normalizeEmail(fromEmail);
  const { data, error } = await admin.rpc('hm_bulk_increment_daily', {
    p_from: email,
    p_day: businessDayDate(),
  });
  if (error) {
    // Fallback if RPC missing: read+write (may race, but better than failing the send).
    const current = await dailySentFor(admin, email);
    const next = current + 1;
    await admin.from('hm_bulk_daily_counts').upsert({
      send_date: businessDayDate(),
      from_email: email,
      sent_count: next,
      updated_at: new Date().toISOString(),
    });
    return next;
  }
  return Number(data) || 0;
}

async function resolveSendAccount(
  admin: ReturnType<typeof serviceClient>,
  preferred: string | null | undefined,
  dailyCap: number,
): Promise<{ account: SmtpAccount; dailySent: number } | { error: string; daily_cap_hit: true }> {
  const accounts = listSmtpAccounts();
  if (!accounts.length) {
    throw new Error('No SMTP accounts configured (SMTP_* / BULK_SMTP_ACCOUNTS)');
  }
  const wanted = normalizeEmail(preferred);
  const rotate = !wanted || wanted === 'auto';
  const candidates = rotate
    ? accounts
    : accounts.filter((a) => a.email === wanted);

  if (!rotate && !candidates.length) {
    throw new Error(`SMTP account not configured for ${wanted}`);
  }

  let best: { account: SmtpAccount; dailySent: number; remaining: number } | null = null;
  for (const account of candidates) {
    const dailySent = await dailySentFor(admin, account.email);
    const remaining = dailyCap - dailySent;
    if (remaining <= 0) continue;
    if (!best || remaining > best.remaining) {
      best = { account, dailySent, remaining };
    }
  }
  if (!best) {
    return {
      error: rotate
        ? `Daily cap reached (${dailyCap}) on all SMTP senders. Try again tomorrow.`
        : `Daily cap reached (${dailyCap}) for ${wanted}. Try another sender or wait until tomorrow.`,
      daily_cap_hit: true,
    };
  }
  return { account: best.account, dailySent: best.dailySent };
}

async function listAccountUsage(
  admin: ReturnType<typeof serviceClient>,
  dailyCap: number,
): Promise<Array<{ email: string; label: string; daily_sent: number; daily_cap: number; remaining: number }>> {
  const accounts = listSmtpAccounts();
  const out = [];
  for (const account of accounts) {
    const dailySent = await dailySentFor(admin, account.email);
    out.push({
      email: account.email,
      label: account.label,
      daily_sent: dailySent,
      daily_cap: dailyCap,
      remaining: Math.max(0, dailyCap - dailySent),
    });
  }
  return out;
}

function clampGap(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_GAP;
  return Math.min(3600, Math.max(MIN_GAP, Math.floor(n)));
}

function clampDailyCap(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_DAILY_CAP;
  return Math.min(HARD_DAILY_CAP, Math.max(1, Math.floor(n)));
}

function applyMerge(template: string, name: string, email: string): string {
  const first = name.trim().split(/\s+/)[0] || 'there';
  return template
    .replace(/\{\{\s*name\s*\}\}/gi, name.trim() || first)
    .replace(/\{\{\s*full_?name\s*\}\}/gi, name.trim() || first)
    .replace(/\{\{\s*first_?name\s*\}\}/gi, first)
    .replace(/\{\{\s*email\s*\}\}/gi, email);
}

/** Calendar date in America/Los_Angeles (AO Paz business day), not UTC midnight. */
function businessDayDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function todayUtcDate(): string {
  // Kept for compatibility; daily caps use Pacific business day.
  return businessDayDate();
}

function summarizeTickResult(one: Record<string, unknown>): Record<string, unknown> {
  return {
    ok: one.ok,
    done: one.done,
    paused: one.paused,
    daily_cap_hit: one.daily_cap_hit,
    waiting_gap: one.waiting_gap,
    wait_ms: one.wait_ms,
    sent_one: one.sent_one,
    failed_one: one.failed_one,
    raced: one.raced,
    to: one.to,
    error: one.error,
    pending: one.pending,
    sent: one.sent,
    failed: one.failed,
    gap_seconds: one.gap_seconds,
    from_email: one.from_email,
    reason: one.reason,
  };
}

async function getAuthUserId(req: Request): Promise<string | null> {
  const admin = serviceClient();
  const auth = req.headers.get('authorization') || '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

async function campaignProgress(admin: ReturnType<typeof serviceClient>, campaignId: string) {
  const { data: campaign } = await admin
    .from('hm_bulk_campaigns')
    .select(
      'id, name, subject, status, total_count, sent_count, failed_count, gap_seconds, daily_cap, provider, from_email, created_at, updated_at, started_at, completed_at, last_error',
    )
    .eq('id', campaignId)
    .maybeSingle();
  if (!campaign) return null;
  const { count: pending } = await admin
    .from('hm_bulk_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .eq('status', 'pending');
  const { count: sending } = await admin
    .from('hm_bulk_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .eq('status', 'sending');
  const { count: sent } = await admin
    .from('hm_bulk_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .eq('status', 'sent');
  const { count: failed } = await admin
    .from('hm_bulk_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .eq('status', 'failed');
  const fromEmail = normalizeEmail(campaign.from_email) || 'auto';
  const usage = await listAccountUsage(admin, clampDailyCap(campaign.daily_cap));
  const matched = fromEmail === 'auto' ? null : usage.find((u) => u.email === fromEmail);
  const dailySent = matched
    ? matched.daily_sent
    : usage.reduce((sum, u) => sum + u.daily_sent, 0);
  return {
    campaign,
    pending: pending || 0,
    sending: sending || 0,
    sent: sent || 0,
    failed: failed || 0,
    daily_sent: dailySent,
    daily_cap: campaign.daily_cap || DEFAULT_DAILY_CAP,
    from_email: fromEmail,
    smtp_accounts: usage,
  };
}

async function syncCampaignCounters(admin: ReturnType<typeof serviceClient>, campaignId: string) {
  const progress = await campaignProgress(admin, campaignId);
  if (!progress) return null;
  const { pending, sending, sent, failed, campaign } = progress;
  const total = Number(campaign.total_count) || pending + sending + sent + failed;
  let status = campaign.status as string;
  if (status !== 'cancelled' && status !== 'paused') {
    if (pending === 0 && sending === 0 && (sent > 0 || failed > 0)) {
      status = 'completed';
    } else if (status === 'queued' && sent === 0 && failed === 0 && sending === 0) {
      status = 'queued';
    } else {
      status = 'sending';
    }
  }
  const patch: Record<string, unknown> = {
    sent_count: sent,
    failed_count: failed,
    total_count: total,
    status,
    updated_at: new Date().toISOString(),
  };
  if (status === 'completed') patch.completed_at = new Date().toISOString();
  await admin.from('hm_bulk_campaigns').update(patch).eq('id', campaignId);
  return campaignProgress(admin, campaignId);
}

async function lastRecipientSentAtMs(
  admin: ReturnType<typeof serviceClient>,
  campaignId: string,
): Promise<number | null> {
  const { data } = await admin
    .from('hm_bulk_recipients')
    .select('sent_at')
    .eq('campaign_id', campaignId)
    .eq('status', 'sent')
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const iso = str((data as { sent_at?: string } | null)?.sent_at);
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

async function recoverStuckSending(
  admin: ReturnType<typeof serviceClient>,
  campaignId: string,
): Promise<void> {
  // Browser tab close can abort mid-send and leave rows stuck in "sending".
  const cutoff = new Date(Date.now() - 90 * 1000).toISOString();
  await admin
    .from('hm_bulk_recipients')
    .update({ status: 'pending', updated_at: new Date().toISOString() })
    .eq('campaign_id', campaignId)
    .eq('status', 'sending')
    .lt('updated_at', cutoff);
}

async function sendNextForCampaign(
  admin: ReturnType<typeof serviceClient>,
  campaignId: string,
  userId: string | null,
  opts?: { respectGap?: boolean },
): Promise<Record<string, unknown>> {
  const respectGap = opts?.respectGap !== false;

  const { data: campaign, error: campErr } = await admin
    .from('hm_bulk_campaigns')
    .select('*')
    .eq('id', campaignId)
    .maybeSingle();
  if (campErr) throw campErr;
  if (!campaign) return { ok: false, error: 'Campaign not found', http_status: 404 };

  if (campaign.status === 'cancelled' || campaign.status === 'completed') {
    return { ok: true, done: true, reason: campaign.status, ...(await syncCampaignCounters(admin, campaignId)) };
  }
  if (campaign.status === 'paused') {
    return { ok: true, done: false, paused: true, ...(await syncCampaignCounters(admin, campaignId)) };
  }
  if (campaign.provider !== 'smtp') {
    return { ok: false, error: 'Only SMTP sending is enabled. Switch provider to SMTP.', http_status: 400 };
  }

  await recoverStuckSending(admin, campaignId);

  const gapSeconds = Math.max(MIN_GAP, Number(campaign.gap_seconds) || DEFAULT_GAP);
  if (respectGap) {
    const lastMs = await lastRecipientSentAtMs(admin, campaignId);
    const campaignLast = campaign.last_sent_at ? Date.parse(String(campaign.last_sent_at)) : NaN;
    const latestMs = Math.max(lastMs || 0, Number.isFinite(campaignLast) ? campaignLast : 0) || null;
    if (latestMs != null && Date.now() - latestMs < gapSeconds * 1000) {
      return {
        ok: true,
        done: false,
        waiting_gap: true,
        gap_seconds: gapSeconds,
        wait_ms: gapSeconds * 1000 - (Date.now() - latestMs),
        ...(await syncCampaignCounters(admin, campaignId)),
      };
    }
  }

  const dailyCap = clampDailyCap(campaign.daily_cap);
  const preferred = str(campaign.from_email) || 'auto';
  const resolved = await resolveSendAccount(admin, preferred, dailyCap);
  if ('daily_cap_hit' in resolved) {
    await admin
      .from('hm_bulk_campaigns')
      .update({
        status: 'paused',
        last_error: resolved.error,
        updated_at: new Date().toISOString(),
      })
      .eq('id', campaignId);
    return {
      ok: true,
      done: false,
      daily_cap_hit: true,
      daily_cap: dailyCap,
      ...(await syncCampaignCounters(admin, campaignId)),
    };
  }
  const { account } = resolved;
  const fromEmail = account.email;

  const { data: nextRows, error: nextErr } = await admin
    .from('hm_bulk_recipients')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('status', 'pending')
    .order('row_index', { ascending: true })
    .limit(1);
  if (nextErr) throw nextErr;
  const next = nextRows?.[0];
  if (!next) {
    const progress = await syncCampaignCounters(admin, campaignId);
    return { ok: true, done: true, reason: 'completed', ...progress };
  }

  // Atomic pacing lock so cron + browser cannot burst-send.
  const { data: claimedSlot, error: lockErr } = await admin.rpc('hm_bulk_claim_send_slot', {
    p_campaign_id: campaignId,
    p_gap_seconds: gapSeconds,
  });
  if (lockErr) throw lockErr;
  if (!claimedSlot) {
    return {
      ok: true,
      done: false,
      waiting_gap: true,
      gap_seconds: gapSeconds,
      wait_ms: gapSeconds * 1000,
      ...(await syncCampaignCounters(admin, campaignId)),
    };
  }

  const { data: claimed, error: claimErr } = await admin
    .from('hm_bulk_recipients')
    .update({ status: 'sending', updated_at: new Date().toISOString() })
    .eq('id', next.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  if (claimErr) throw claimErr;
  if (!claimed) {
    return {
      ok: true,
      done: false,
      raced: true,
      ...(await syncCampaignCounters(admin, campaignId)),
    };
  }

  const to = normalizeEmail(next.email);
  const displayName = str(next.full_name);
  const subject = applyMerge(String(campaign.subject || ''), displayName, to);
  const text = applyMerge(String(campaign.body_text || ''), displayName, to);
  const htmlRaw = campaign.body_html ? applyMerge(String(campaign.body_html), displayName, to) : '';
  const html = htmlRaw || text.replace(/\n/g, '<br/>');

  try {
    const transport = getTransportFor(account);
    await new Promise<void>((resolve, reject) => {
      transport.sendMail(
        {
          from: formatFromHeader(fromEmail),
          to,
          subject,
          text,
          html,
        },
        (err: Error | null) => (err ? reject(err) : resolve()),
      );
    });

    const now = new Date().toISOString();
    await admin
      .from('hm_bulk_recipients')
      .update({ status: 'sent', sent_at: now, error: null, updated_at: now })
      .eq('id', next.id);

    const nextDaily = await bumpDailySent(admin, fromEmail);

    await insertEmailSendLog(admin, {
      source: 'hm-bulk-email',
      trigger_label: `bulk:${campaignId}`,
      from_email: fromEmail,
      to_email: to,
      subject,
      sent_by_user_id: userId,
      status: 'sent',
      metadata: {
        campaign_id: campaignId,
        recipient_id: next.id,
        body_text: text.slice(0, 20000),
      },
    });

    const progress = await syncCampaignCounters(admin, campaignId);
    return {
      ok: true,
      done: (progress?.pending || 0) === 0,
      sent_one: true,
      to,
      from_email: fromEmail,
      daily_sent: nextDaily,
      daily_cap: dailyCap,
      gap_seconds: gapSeconds,
      ...progress,
    };
  } catch (sendErr) {
    const msg = sendErr instanceof Error ? sendErr.message : String(sendErr);
    const now = new Date().toISOString();
    await admin
      .from('hm_bulk_recipients')
      .update({ status: 'failed', error: msg, updated_at: now })
      .eq('id', next.id);
    await admin
      .from('hm_bulk_campaigns')
      .update({ last_error: msg, updated_at: now })
      .eq('id', campaignId);
    await insertEmailSendLog(admin, {
      source: 'hm-bulk-email',
      trigger_label: `bulk:${campaignId}`,
      from_email: fromEmail,
      to_email: to,
      subject,
      sent_by_user_id: userId,
      status: 'failed',
      error_message: msg,
      metadata: { campaign_id: campaignId, recipient_id: next.id },
    });
    const progress = await syncCampaignCounters(admin, campaignId);
    return {
      ok: true,
      done: false,
      sent_one: false,
      failed_one: true,
      error: msg,
      from_email: fromEmail,
      gap_seconds: gapSeconds,
      ...progress,
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method === 'GET') return json(200, { ok: true, service: 'hm-bulk-email' });
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

  const action = str(body.action || body.mode).toLowerCase() || 'status';
  const userId = userOk ? await getAuthUserId(req) : null;

  try {
    if (action === 'test_send' || action === 'send_test') {
      const to = normalizeEmail(body.to || body.email);
      const displayName = str(body.name || body.full_name || body.fullName) || 'there';
      const subjectTpl = str(body.subject);
      const bodyTextTpl = str(body.body_text || body.bodyText || body.text);
      const bodyHtmlTpl = str(body.body_html || body.bodyHtml || body.html);
      if (!to || !to.includes('@')) return json(400, { error: 'Valid test email is required' });
      if (!subjectTpl || (!bodyTextTpl && !bodyHtmlTpl)) {
        return json(400, { error: 'Subject and body are required' });
      }

      const preferred = str(body.from_email || body.fromEmail) || 'auto';
      const resolved = await resolveSendAccount(admin, preferred, HARD_DAILY_CAP);
      if ('daily_cap_hit' in resolved) {
        return json(429, { error: resolved.error, daily_cap_hit: true, daily_cap: HARD_DAILY_CAP });
      }
      const { account, dailySent } = resolved;
      const fromEmail = account.email;

      const subject = applyMerge(subjectTpl, displayName, to);
      const text = applyMerge(
        bodyTextTpl || bodyHtmlTpl.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''),
        displayName,
        to,
      );
      const html = bodyHtmlTpl
        ? applyMerge(bodyHtmlTpl, displayName, to)
        : text.replace(/\n/g, '<br/>');

      try {
        const transport = getTransportFor(account);
        await new Promise<void>((resolve, reject) => {
          transport.sendMail(
            {
              from: formatFromHeader(fromEmail),
              to,
              subject,
              text,
              html,
            },
            (err: Error | null) => (err ? reject(err) : resolve()),
          );
        });
      } catch (sendErr) {
        const msg = sendErr instanceof Error ? sendErr.message : String(sendErr);
        await insertEmailSendLog(admin, {
          source: 'hm-bulk-email',
          trigger_label: 'bulk:test',
          from_email: fromEmail,
          to_email: to,
          subject,
          sent_by_user_id: userId,
          status: 'failed',
          error_message: msg,
          metadata: { test: true },
        });
        throw sendErr;
      }

      const nextDaily = await bumpDailySent(admin, fromEmail);
      await insertEmailSendLog(admin, {
        source: 'hm-bulk-email',
        trigger_label: 'bulk:test',
        from_email: fromEmail,
        to_email: to,
        subject,
        sent_by_user_id: userId,
        status: 'sent',
        metadata: { test: true, body_text: text.slice(0, 20000) },
      });

      return json(200, {
        ok: true,
        test: true,
        to,
        from_email: fromEmail,
        subject,
        daily_sent: nextDaily,
        daily_cap: HARD_DAILY_CAP,
        smtp_accounts: await listAccountUsage(admin, HARD_DAILY_CAP),
      });
    }

    if (action === 'get_settings') {
      const { data } = await admin.from('hm_bulk_app_settings').select('*').eq('id', 1).maybeSingle();
      const dailyCap = clampDailyCap(data?.daily_cap ?? DEFAULT_DAILY_CAP);
      // Reconcile counter from actual Pacific-day sends so the UI can't drift.
      const { data: realToday } = await admin.rpc('hm_bulk_sent_today_count');
      const reconciled = Number(realToday) || 0;
      if (reconciled > 0) {
        const fromEmailBare = bareEmailAddress(defaultFromEmail()) || normalizeEmail(defaultFromEmail());
        await admin.from('hm_bulk_daily_counts').upsert({
          send_date: businessDayDate(),
          from_email: fromEmailBare,
          sent_count: reconciled,
          updated_at: new Date().toISOString(),
        });
      }
      const usage = await listAccountUsage(admin, dailyCap);
      const fromEmail = defaultFromEmail();
      const primary = usage.find((u) => u.email === bareEmailAddress(fromEmail) || u.email === normalizeEmail(fromEmail)) || usage[0];
      const totalToday = usage.reduce((sum, u) => sum + u.daily_sent, 0) || reconciled;
      const { count: draftCount } = await admin
        .from('hm_bulk_draft_leads')
        .select('id', { count: 'exact', head: true });
      return json(200, {
        ok: true,
        settings: data || {
          id: 1,
          gap_seconds: DEFAULT_GAP,
          daily_cap: DEFAULT_DAILY_CAP,
          default_provider: 'smtp',
          smtp: {},
          instantly: {},
          apollo: {},
          billionmail: {},
        },
        smtp_from: fromEmail,
        daily_sent: totalToday || primary?.daily_sent || 0,
        hard_daily_cap: HARD_DAILY_CAP,
        smtp_accounts: usage,
        draft_leads_count: draftCount || 0,
        business_day: businessDayDate(),
        business_tz: BUSINESS_TZ,
      });
    }

    if (action === 'stats' || action === 'dashboard') {
      if (!userOk) return json(401, { error: 'Sign in required' });
      const campaignId = str(body.campaign_id || body.campaignId);
      let campsQuery = admin
        .from('hm_bulk_campaigns')
        .select('id, name, status, total_count, sent_count, failed_count, gap_seconds, created_at, updated_at, started_at, completed_at');
      if (campaignId) campsQuery = campsQuery.eq('id', campaignId);
      else campsQuery = campsQuery.order('updated_at', { ascending: false }).limit(50);
      const { data: camps, error: campsErr } = await campsQuery;
      if (campsErr) throw campsErr;

      const { count: sentAll } = await admin
        .from('hm_bulk_recipients')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'sent');
      const { count: failedAll } = await admin
        .from('hm_bulk_recipients')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'failed');
      const { count: pendingAll } = await admin
        .from('hm_bulk_recipients')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending');
      const { data: sentTodayRaw } = await admin.rpc('hm_bulk_sent_today_count');
      const sentToday = Number(sentTodayRaw) || 0;

      // SMTP has no native bounce/reply webhooks; surface log-based failures + Instantly if present.
      const { count: bouncedLogs } = await admin
        .from('email_send_logs')
        .select('id', { count: 'exact', head: true })
        .eq('source', 'hm-bulk-email')
        .ilike('error_message', '%bounce%');
      const { count: failedLogs } = await admin
        .from('email_send_logs')
        .select('id', { count: 'exact', head: true })
        .eq('source', 'hm-bulk-email')
        .eq('status', 'failed');
      const { count: sentLogs } = await admin
        .from('email_send_logs')
        .select('id', { count: 'exact', head: true })
        .eq('source', 'hm-bulk-email')
        .eq('status', 'sent');

      let campaignStats = null;
      if (campaignId) {
        const progress = await campaignProgress(admin, campaignId);
        campaignStats = progress;
      }

      const sent = sentAll || 0;
      const failed = failedAll || 0;
      const deliveredLike = Math.max(0, sent - (bouncedLogs || 0));
      return json(200, {
        ok: true,
        business_day: businessDayDate(),
        business_tz: BUSINESS_TZ,
        totals: {
          sent: sent,
          failed: failed,
          pending: pendingAll || 0,
          sent_today: sentToday,
          bounced: bouncedLogs || 0,
          failed_logs: failedLogs || 0,
          sent_logs: sentLogs || 0,
          reply_rate: null,
          replies: 0,
          reply_note: 'SMTP bulk does not track inbox replies yet.',
          bounce_note: 'Bounces are estimated from send-log errors (SMTP has no bounce webhook).',
        },
        campaigns: camps || [],
        campaign: campaignStats,
        delivered_estimate: deliveredLike,
      });
    }

    if (action === 'list_draft_leads') {
      const limitRaw = Number(body.limit ?? 1000);
      const offsetRaw = Number(body.offset ?? 0);
      const limit = Math.min(2000, Math.max(1, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 1000));
      const offset = Math.max(0, Number.isFinite(offsetRaw) ? Math.floor(offsetRaw) : 0);
      const { data: draftLeads, error: draftErr } = await admin
        .from('hm_bulk_draft_leads')
        .select('id, full_name, email, row_index, raw, created_at')
        .order('row_index', { ascending: true })
        .range(offset, offset + limit - 1);
      if (draftErr) throw draftErr;
      const { count } = await admin
        .from('hm_bulk_draft_leads')
        .select('id', { count: 'exact', head: true });
      return json(200, {
        ok: true,
        draft_leads: draftLeads || [],
        total: count || 0,
        offset,
        limit,
      });
    }

    if (action === 'save_template') {
      const subject = str(body.subject);
      const templateBody = typeof body.body === 'string'
        ? body.body
        : str(body.template_body || body.templateBody || body.body_html || body.bodyHtml);
      const patch = {
        template_subject: subject || null,
        template_body: templateBody || null,
        draft_campaign_name: str(body.campaign_name || body.campaignName) || null,
        draft_from_email: str(body.from_email || body.fromEmail) || null,
        draft_source_file: str(body.source_file || body.sourceFile) || null,
        draft_name_column: str(body.name_column || body.nameColumn) || null,
        draft_email_column: str(body.email_column || body.emailColumn) || null,
        draft_gap_seconds: clampGap(body.gap_seconds ?? body.gapSeconds ?? DEFAULT_GAP),
        draft_daily_cap: clampDailyCap(body.daily_cap ?? body.dailyCap ?? DEFAULT_DAILY_CAP),
        updated_by: userId,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await admin
        .from('hm_bulk_app_settings')
        .upsert({ id: 1, ...patch })
        .select('*')
        .single();
      if (error) throw error;
      return json(200, { ok: true, settings: data });
    }

    if (action === 'save_draft_leads') {
      const rawRecipients = Array.isArray(body.recipients) ? (body.recipients as RecipientInput[]) : [];
      const seen = new Set<string>();
      const leads: Array<{
        full_name: string | null;
        email: string;
        row_index: number | null;
        raw: Record<string, unknown>;
        updated_at: string;
      }> = [];
      const now = new Date().toISOString();
      for (let i = 0; i < rawRecipients.length; i++) {
        const row = rawRecipients[i] || {};
        const email = normalizeEmail(row.email);
        if (!email || !email.includes('@') || seen.has(email)) continue;
        seen.add(email);
        leads.push({
          full_name: str(row.name) || null,
          email,
          row_index: typeof row.row_index === 'number' ? row.row_index : i,
          raw: row.raw && typeof row.raw === 'object' ? row.raw : {},
          updated_at: now,
        });
      }

      const { error: delErr } = await admin.from('hm_bulk_draft_leads').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      if (delErr) throw delErr;

      const chunkSize = 500;
      for (let i = 0; i < leads.length; i += chunkSize) {
        const chunk = leads.slice(i, i + chunkSize);
        if (!chunk.length) continue;
        const { error: insErr } = await admin.from('hm_bulk_draft_leads').insert(chunk);
        if (insErr) throw insErr;
      }

      // Also stash mapping metadata on settings when provided.
      const metaPatch: Record<string, unknown> = {
        updated_by: userId,
        updated_at: now,
      };
      if (str(body.source_file || body.sourceFile)) metaPatch.draft_source_file = str(body.source_file || body.sourceFile);
      if (str(body.name_column || body.nameColumn) || body.name_column === '') {
        metaPatch.draft_name_column = str(body.name_column || body.nameColumn) || null;
      }
      if (str(body.email_column || body.emailColumn)) {
        metaPatch.draft_email_column = str(body.email_column || body.emailColumn);
      }
      if (str(body.campaign_name || body.campaignName)) {
        metaPatch.draft_campaign_name = str(body.campaign_name || body.campaignName);
      }
      await admin.from('hm_bulk_app_settings').upsert({ id: 1, ...metaPatch });

      const { data: draftLeads } = await admin
        .from('hm_bulk_draft_leads')
        .select('id, full_name, email, row_index, raw, created_at')
        .order('row_index', { ascending: true });
      return json(200, { ok: true, total: leads.length, draft_leads: draftLeads || [] });
    }

    if (action === 'clear_draft_leads') {
      const { error } = await admin.from('hm_bulk_draft_leads').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      if (error) throw error;
      await admin.from('hm_bulk_app_settings').upsert({
        id: 1,
        draft_source_file: null,
        draft_name_column: null,
        draft_email_column: null,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      });
      return json(200, { ok: true, draft_leads: [] });
    }

    if (action === 'save_settings') {
      const gap = clampGap(body.gap_seconds ?? body.gapSeconds);
      const dailyCap = clampDailyCap(body.daily_cap ?? body.dailyCap);
      const defaultProvider = str(body.default_provider || body.defaultProvider) || 'smtp';
      const provider =
        ['smtp', 'instantly', 'apollo', 'billionmail'].includes(defaultProvider)
          ? defaultProvider
          : 'smtp';
      const patch = {
        gap_seconds: gap,
        daily_cap: dailyCap,
        default_provider: provider,
        smtp: typeof body.smtp === 'object' && body.smtp ? body.smtp : {},
        instantly: typeof body.instantly === 'object' && body.instantly ? body.instantly : {},
        apollo: typeof body.apollo === 'object' && body.apollo ? body.apollo : {},
        billionmail: typeof body.billionmail === 'object' && body.billionmail ? body.billionmail : {},
        updated_by: userId,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await admin
        .from('hm_bulk_app_settings')
        .upsert({ id: 1, ...patch })
        .select('*')
        .single();
      if (error) throw error;
      return json(200, {
        ok: true,
        settings: data,
        smtp_accounts: await listAccountUsage(admin, dailyCap),
      });
    }

    if (action === 'list') {
      const { data, error } = await admin
        .from('hm_bulk_campaigns')
        .select('id, name, subject, status, total_count, sent_count, failed_count, gap_seconds, daily_cap, provider, from_email, created_at, updated_at, started_at, completed_at')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return json(200, { ok: true, campaigns: data || [] });
    }

    if (action === 'status') {
      const campaignId = str(body.campaign_id || body.campaignId);
      if (!campaignId) return json(400, { error: 'Missing campaign_id' });
      const progress = await syncCampaignCounters(admin, campaignId);
      if (!progress) return json(404, { error: 'Campaign not found' });
      return json(200, { ok: true, ...progress });
    }

    if (action === 'create') {
      const subject = str(body.subject);
      const bodyText = str(body.body_text || body.bodyText || body.text);
      const bodyHtml = str(body.body_html || body.bodyHtml || body.html);
      const name = str(body.name) || `Bulk ${new Date().toISOString().slice(0, 16)}`;
      if (!subject || (!bodyText && !bodyHtml)) {
        return json(400, { error: 'Subject and body are required' });
      }
      const rawRecipients = Array.isArray(body.recipients) ? (body.recipients as RecipientInput[]) : [];
      if (!rawRecipients.length) return json(400, { error: 'No recipients' });

      const seen = new Set<string>();
      const recipients: Array<{
        full_name: string | null;
        email: string;
        row_index: number | null;
        raw: Record<string, unknown>;
        status: string;
      }> = [];
      for (let i = 0; i < rawRecipients.length; i++) {
        const row = rawRecipients[i] || {};
        const email = normalizeEmail(row.email);
        if (!email || !email.includes('@')) continue;
        if (seen.has(email)) continue;
        seen.add(email);
        recipients.push({
          full_name: str(row.name) || null,
          email,
          row_index: typeof row.row_index === 'number' ? row.row_index : i,
          raw: row.raw && typeof row.raw === 'object' ? row.raw : {},
          status: 'pending',
        });
      }
      if (!recipients.length) return json(400, { error: 'No valid emails in recipients' });

      const gap = clampGap(body.gap_seconds ?? body.gapSeconds);
      const dailyCap = clampDailyCap(body.daily_cap ?? body.dailyCap);
      const providerRaw = str(body.provider) || 'smtp';
      const provider = ['smtp', 'instantly', 'apollo', 'billionmail'].includes(providerRaw)
        ? providerRaw
        : 'smtp';
      if (provider !== 'smtp') {
        return json(400, {
          error: `${provider} sending is configured in Settings but not enabled yet. Use SMTP to send.`,
        });
      }

      const preferredRaw = str(body.from_email || body.fromEmail) || 'auto';
      const preferred = preferredRaw.toLowerCase() === 'auto' ? 'auto' : normalizeEmail(preferredRaw);
      if (preferred !== 'auto' && !findAccount(preferred)) {
        return json(400, { error: `SMTP account not configured for ${preferred}` });
      }

      const { data: campaign, error: campErr } = await admin
        .from('hm_bulk_campaigns')
        .insert({
          name,
          subject,
          body_text: bodyText || bodyHtml.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''),
          body_html: bodyHtml || null,
          status: 'sending',
          gap_seconds: gap,
          daily_cap: dailyCap,
          from_email: preferred,
          provider,
          total_count: recipients.length,
          sent_count: 0,
          failed_count: 0,
          created_by: userId,
          started_at: new Date().toISOString(),
          settings: {
            source_file: str(body.source_file || body.sourceFile) || null,
            email_column: str(body.email_column || body.emailColumn) || null,
            name_column: str(body.name_column || body.nameColumn) || null,
            rotate: preferred === 'auto',
          },
        })
        .select('*')
        .single();
      if (campErr || !campaign) throw campErr || new Error('Failed to create campaign');

      const chunkSize = 500;
      for (let i = 0; i < recipients.length; i += chunkSize) {
        const chunk = recipients.slice(i, i + chunkSize).map((r) => ({
          ...r,
          campaign_id: campaign.id,
        }));
        const { error: recErr } = await admin.from('hm_bulk_recipients').insert(chunk);
        if (recErr) throw recErr;
      }

      return json(200, {
        ok: true,
        campaign_id: campaign.id,
        total: recipients.length,
        campaign,
      });
    }

    if (action === 'pause' || action === 'resume' || action === 'cancel') {
      const campaignId = str(body.campaign_id || body.campaignId);
      if (!campaignId) return json(400, { error: 'Missing campaign_id' });
      const nextStatus = action === 'pause' ? 'paused' : action === 'resume' ? 'queued' : 'cancelled';
      const { error } = await admin
        .from('hm_bulk_campaigns')
        .update({
          status: nextStatus,
          updated_at: new Date().toISOString(),
          ...(action === 'pause' ? { last_error: 'Paused by user' } : { last_error: null }),
        })
        .eq('id', campaignId);
      if (error) throw error;
      if (action === 'cancel') {
        await admin
          .from('hm_bulk_recipients')
          .update({ status: 'skipped', updated_at: new Date().toISOString() })
          .eq('campaign_id', campaignId)
          .eq('status', 'pending');
      }
      const progress = await syncCampaignCounters(admin, campaignId);
      return json(200, { ok: true, paused: nextStatus === 'paused', ...progress });
    }

    if (action === 'get_campaign') {
      const campaignId = str(body.campaign_id || body.campaignId);
      if (!campaignId) return json(400, { error: 'Missing campaign_id' });
      const { data: campaign, error } = await admin
        .from('hm_bulk_campaigns')
        .select('*')
        .eq('id', campaignId)
        .maybeSingle();
      if (error) throw error;
      if (!campaign) return json(404, { error: 'Campaign not found' });
      const progress = await syncCampaignCounters(admin, campaignId);
      return json(200, { ok: true, campaign, ...progress });
    }

    if (action === 'update_campaign') {
      const campaignId = str(body.campaign_id || body.campaignId);
      if (!campaignId) return json(400, { error: 'Missing campaign_id' });
      const { data: existing, error: existingErr } = await admin
        .from('hm_bulk_campaigns')
        .select('id, status')
        .eq('id', campaignId)
        .maybeSingle();
      if (existingErr) throw existingErr;
      if (!existing) return json(404, { error: 'Campaign not found' });
      if (existing.status === 'completed' || existing.status === 'cancelled') {
        return json(400, { error: `Cannot edit a ${existing.status} campaign` });
      }

      const subject = str(body.subject);
      const bodyText = str(body.body_text || body.bodyText || body.text);
      const bodyHtml = str(body.body_html || body.bodyHtml || body.html);
      if (!subject || (!bodyText && !bodyHtml)) {
        return json(400, { error: 'Subject and body are required' });
      }

      const preferredRaw = str(body.from_email || body.fromEmail) || 'auto';
      const preferred = preferredRaw.toLowerCase() === 'auto' ? 'auto' : normalizeEmail(preferredRaw);
      if (preferred !== 'auto' && !findAccount(preferred)) {
        return json(400, { error: `SMTP account not configured for ${preferred}` });
      }

      const patch = {
        name: str(body.name) || undefined,
        subject,
        body_text: bodyText || bodyHtml.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''),
        body_html: bodyHtml || null,
        gap_seconds: clampGap(body.gap_seconds ?? body.gapSeconds),
        daily_cap: clampDailyCap(body.daily_cap ?? body.dailyCap),
        from_email: preferred,
        updated_at: new Date().toISOString(),
        last_error: null,
      };
      const cleanPatch = Object.fromEntries(
        Object.entries(patch).filter(([, v]) => v !== undefined),
      );

      const { data: campaign, error } = await admin
        .from('hm_bulk_campaigns')
        .update(cleanPatch)
        .eq('id', campaignId)
        .select('*')
        .single();
      if (error) throw error;
      return json(200, { ok: true, campaign });
    }

    if (action === 'list_recipients') {
      if (!userOk) return json(401, { error: 'Sign in required' });
      const campaignId = str(body.campaign_id || body.campaignId);
      if (!campaignId) return json(400, { error: 'Missing campaign_id' });
      const statusFilter = str(body.status).toLowerCase();
      const q = str(body.q || body.query).toLowerCase();
      const limit = Math.min(5000, Math.max(1, Number(body.limit) || 2000));

      let query = admin
        .from('hm_bulk_recipients')
        .select('id, full_name, email, status, error, row_index, sent_at, created_at, updated_at')
        .eq('campaign_id', campaignId)
        .order('row_index', { ascending: true })
        .limit(limit);
      if (['pending', 'sending', 'sent', 'failed', 'skipped'].includes(statusFilter)) {
        query = query.eq('status', statusFilter);
      }
      const { data, error } = await query;
      if (error) throw error;
      let rows = data || [];
      if (q) {
        rows = rows.filter((row) => {
          const hay = `${row.full_name || ''} ${row.email || ''} ${row.error || ''}`.toLowerCase();
          return hay.includes(q);
        });
      }
      const progress = await campaignProgress(admin, campaignId);
      return json(200, { ok: true, recipients: rows, ...(progress || {}) });
    }

    if (action === 'tick' || action === 'worker') {
      // Server-side sender: keeps campaigns moving even if the browser is closed.
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const { data: camps, error: listErr } = await admin
        .from('hm_bulk_campaigns')
        .select('id, status, gap_seconds')
        .in('status', ['queued', 'sending'])
        .order('updated_at', { ascending: true })
        .limit(20);
      if (listErr) throw listErr;

      const results: Array<Record<string, unknown>> = [];
      const deadline = Date.now() + 50_000;
      for (const camp of camps || []) {
        if (Date.now() >= deadline) break;
        const campaignId = String(camp.id);
        const gapSeconds = Math.max(5, Number(camp.gap_seconds) || DEFAULT_GAP);
        // Stay inside this tick and wait out gaps so closing the browser never stalls the campaign.
        const maxSends = Math.max(1, Math.min(20, Math.floor(50_000 / Math.max(gapSeconds * 1000, 5000)) + 1));
        let sends = 0;
        while (sends < maxSends && Date.now() < deadline) {
          const one = await sendNextForCampaign(admin, campaignId, userId, { respectGap: true });
          if (one.http_status) {
            results.push({ campaign_id: campaignId, ...summarizeTickResult(one) });
            break;
          }
          if (one.paused || one.daily_cap_hit || one.done) {
            results.push({ campaign_id: campaignId, ...summarizeTickResult(one) });
            break;
          }
          if (one.waiting_gap) {
            const waitMs = Math.max(0, Number(one.wait_ms) || 0);
            const remaining = deadline - Date.now() - 500;
            if (waitMs > remaining) {
              results.push({
                campaign_id: campaignId,
                waiting_gap: true,
                wait_ms: waitMs,
                sends,
              });
              break;
            }
            if (waitMs > 0) await sleep(waitMs);
            continue;
          }
          if (one.raced) continue;
          if (one.sent_one || one.failed_one) {
            sends += 1;
            results.push({ campaign_id: campaignId, ...summarizeTickResult(one) });
            if (one.failed_one) break;
            continue;
          }
          results.push({ campaign_id: campaignId, ...summarizeTickResult(one) });
          break;
        }
        if (!results.some((r) => r.campaign_id === campaignId)) {
          results.push({ campaign_id: campaignId, ok: true, sends });
        }
      }
      return json(200, {
        ok: true,
        campaigns: (camps || []).length,
        results,
        server_driven: true,
      });
    }

    if (action === 'process' || action === 'send_next') {
      const campaignId = str(body.campaign_id || body.campaignId);
      if (!campaignId) return json(400, { error: 'Missing campaign_id' });
      // Always respect gap — multi-worker bursts were landing in spam.
      const result = await sendNextForCampaign(admin, campaignId, userId, { respectGap: true });
      if (result.http_status === 404) return json(404, result);
      if (result.http_status === 400) return json(400, result);
      return json(200, result);
    }

    return json(400, { error: `Unknown action: ${action}` });
  } catch (err) {
    console.error('hm-bulk-email error', err);
    return json(500, { error: err instanceof Error ? err.message : String(err) });
  }
});

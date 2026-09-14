// Bulk mass email via SMTP with gaps + 500/day per from-address.
// Deploy: supabase functions deploy hm-bulk-email --project-ref ofhcnsuwrhyvxtvtdunw

import nodemailer from 'npm:nodemailer@6.9.10';
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
import { mergePortalBcc } from '../_shared/portalEmailBcc.ts';

const DEFAULT_GAP = 60;
const DEFAULT_DAILY_CAP = 500;
const HARD_DAILY_CAP = 500;

type RecipientInput = { name?: string; email?: string; row_index?: number; raw?: Record<string, unknown> };

function getTransport() {
  const host = Deno.env.get('SMTP_HOSTNAME')?.trim();
  const port = Number(Deno.env.get('SMTP_PORT') ?? 587);
  const secure = (Deno.env.get('SMTP_SECURE') ?? 'false') === 'true';
  const user = Deno.env.get('SMTP_USERNAME')?.trim();
  const pass = Deno.env.get('SMTP_PASSWORD')?.trim();
  if (!host || !user || !pass) {
    throw new Error('Missing SMTP config (SMTP_HOSTNAME, SMTP_USERNAME, SMTP_PASSWORD)');
  }
  return nodemailer.createTransport({
    host,
    port: Number.isNaN(port) ? 587 : port,
    secure,
    auth: { user, pass },
    ...(port === 587 && !secure ? { requireTLS: true } : {}),
  });
}

function defaultFromEmail(): string {
  return (
    Deno.env.get('SMTP_FROM')?.trim() ||
    Deno.env.get('SMTP_USERNAME')?.trim() ||
    'noreply@example.com'
  );
}

function clampGap(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_GAP;
  return Math.min(3600, Math.max(5, Math.floor(n)));
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

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
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
  const { data: campaign } = await admin.from('hm_bulk_campaigns').select('*').eq('id', campaignId).maybeSingle();
  if (!campaign) return null;
  const { count: pending } = await admin
    .from('hm_bulk_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .eq('status', 'pending');
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
  const fromEmail = normalizeEmail(campaign.from_email) || normalizeEmail(defaultFromEmail());
  const { data: daily } = await admin
    .from('hm_bulk_daily_counts')
    .select('sent_count')
    .eq('send_date', todayUtcDate())
    .eq('from_email', fromEmail)
    .maybeSingle();
  return {
    campaign,
    pending: pending || 0,
    sent: sent || 0,
    failed: failed || 0,
    daily_sent: daily?.sent_count || 0,
    daily_cap: campaign.daily_cap || DEFAULT_DAILY_CAP,
    from_email: fromEmail,
  };
}

async function syncCampaignCounters(admin: ReturnType<typeof serviceClient>, campaignId: string) {
  const progress = await campaignProgress(admin, campaignId);
  if (!progress) return null;
  const { pending, sent, failed, campaign } = progress;
  const total = Number(campaign.total_count) || pending + sent + failed;
  let status = campaign.status as string;
  if (status !== 'cancelled' && status !== 'paused') {
    if (pending === 0 && (sent > 0 || failed > 0)) status = 'completed';
    else if (sent > 0 || failed > 0) status = 'sending';
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
    if (action === 'get_settings') {
      const { data } = await admin.from('hm_bulk_app_settings').select('*').eq('id', 1).maybeSingle();
      const fromEmail = defaultFromEmail();
      const { data: daily } = await admin
        .from('hm_bulk_daily_counts')
        .select('sent_count')
        .eq('send_date', todayUtcDate())
        .eq('from_email', normalizeEmail(fromEmail))
        .maybeSingle();
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
        daily_sent: daily?.sent_count || 0,
        hard_daily_cap: HARD_DAILY_CAP,
      });
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
      return json(200, { ok: true, settings: data });
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
      const fromEmail = normalizeEmail(body.from_email || body.fromEmail) || normalizeEmail(defaultFromEmail());

      const { data: campaign, error: campErr } = await admin
        .from('hm_bulk_campaigns')
        .insert({
          name,
          subject,
          body_text: bodyText || bodyHtml.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''),
          body_html: bodyHtml || null,
          status: 'queued',
          gap_seconds: gap,
          daily_cap: dailyCap,
          from_email: fromEmail,
          provider,
          total_count: recipients.length,
          sent_count: 0,
          failed_count: 0,
          created_by: userId,
          settings: {
            source_file: str(body.source_file || body.sourceFile) || null,
            email_column: str(body.email_column || body.emailColumn) || null,
            name_column: str(body.name_column || body.nameColumn) || null,
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
        .update({ status: nextStatus, updated_at: new Date().toISOString() })
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
      return json(200, { ok: true, ...progress });
    }

    if (action === 'process' || action === 'send_next') {
      const campaignId = str(body.campaign_id || body.campaignId);
      if (!campaignId) return json(400, { error: 'Missing campaign_id' });

      const { data: campaign, error: campErr } = await admin
        .from('hm_bulk_campaigns')
        .select('*')
        .eq('id', campaignId)
        .maybeSingle();
      if (campErr) throw campErr;
      if (!campaign) return json(404, { error: 'Campaign not found' });
      if (campaign.status === 'cancelled' || campaign.status === 'completed') {
        return json(200, { ok: true, done: true, reason: campaign.status, ...(await syncCampaignCounters(admin, campaignId)) });
      }
      if (campaign.status === 'paused') {
        return json(200, { ok: true, done: false, paused: true, ...(await syncCampaignCounters(admin, campaignId)) });
      }
      if (campaign.provider !== 'smtp') {
        return json(400, { error: 'Only SMTP sending is enabled. Switch provider to SMTP.' });
      }

      const fromEmail = normalizeEmail(campaign.from_email) || normalizeEmail(defaultFromEmail());
      const dailyCap = clampDailyCap(campaign.daily_cap);
      const sendDate = todayUtcDate();
      const { data: dailyRow } = await admin
        .from('hm_bulk_daily_counts')
        .select('sent_count')
        .eq('send_date', sendDate)
        .eq('from_email', fromEmail)
        .maybeSingle();
      const dailySent = dailyRow?.sent_count || 0;
      if (dailySent >= dailyCap) {
        await admin
          .from('hm_bulk_campaigns')
          .update({
            status: 'paused',
            last_error: `Daily cap reached (${dailyCap}) for ${fromEmail}. Resumes tomorrow or raise gap / wait.`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', campaignId);
        return json(200, {
          ok: true,
          done: false,
          daily_cap_hit: true,
          daily_sent: dailySent,
          daily_cap: dailyCap,
          ...(await syncCampaignCounters(admin, campaignId)),
        });
      }

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
        return json(200, { ok: true, done: true, reason: 'completed', ...progress });
      }

      await admin
        .from('hm_bulk_campaigns')
        .update({
          status: 'sending',
          started_at: campaign.started_at || new Date().toISOString(),
          updated_at: new Date().toISOString(),
          last_error: null,
        })
        .eq('id', campaignId);
      await admin
        .from('hm_bulk_recipients')
        .update({ status: 'sending', updated_at: new Date().toISOString() })
        .eq('id', next.id);

      const to = normalizeEmail(next.email);
      const displayName = str(next.full_name);
      const subject = applyMerge(String(campaign.subject || ''), displayName, to);
      const text = applyMerge(String(campaign.body_text || ''), displayName, to);
      const htmlRaw = campaign.body_html ? applyMerge(String(campaign.body_html), displayName, to) : '';
      const html = htmlRaw || text.replace(/\n/g, '<br/>');

      try {
        const transport = getTransport();
        await new Promise<void>((resolve, reject) => {
          transport.sendMail(
            {
              from: fromEmail,
              to,
              bcc: mergePortalBcc(),
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

        const nextDaily = dailySent + 1;
        await admin.from('hm_bulk_daily_counts').upsert({
          send_date: sendDate,
          from_email: fromEmail,
          sent_count: nextDaily,
          updated_at: now,
        });

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
        return json(200, {
          ok: true,
          done: (progress?.pending || 0) === 0,
          sent_one: true,
          to,
          daily_sent: nextDaily,
          daily_cap: dailyCap,
          gap_seconds: campaign.gap_seconds || DEFAULT_GAP,
          ...progress,
        });
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
        return json(200, {
          ok: true,
          done: false,
          sent_one: false,
          failed_one: true,
          error: msg,
          gap_seconds: campaign.gap_seconds || DEFAULT_GAP,
          ...progress,
        });
      }
    }

    return json(400, { error: `Unknown action: ${action}` });
  } catch (err) {
    console.error('hm-bulk-email error', err);
    return json(500, { error: err instanceof Error ? err.message : String(err) });
  }
});

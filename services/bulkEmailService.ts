import { supabase } from './supabaseClient';

export type BulkProvider = 'smtp' | 'instantly' | 'apollo' | 'billionmail';

export type BulkAppSettings = {
  id: number;
  gap_seconds: number;
  daily_cap: number;
  default_provider: BulkProvider;
  smtp: Record<string, unknown>;
  instantly: Record<string, unknown>;
  apollo: Record<string, unknown>;
  billionmail: Record<string, unknown>;
  updated_at?: string;
};

export type BulkCampaign = {
  id: string;
  name: string;
  subject: string;
  status: string;
  total_count: number;
  sent_count: number;
  failed_count: number;
  gap_seconds: number;
  daily_cap: number;
  provider: BulkProvider | string;
  from_email: string | null;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  last_error?: string | null;
  body_text?: string;
  body_html?: string | null;
};

export type BulkProgress = {
  campaign: BulkCampaign;
  pending: number;
  sent: number;
  failed: number;
  daily_sent: number;
  daily_cap: number;
  from_email: string;
  done?: boolean;
  paused?: boolean;
  daily_cap_hit?: boolean;
  sent_one?: boolean;
  failed_one?: boolean;
  gap_seconds?: number;
  error?: string;
  to?: string;
};

async function invokeBulk(
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!supabaseUrl || !anon) throw new Error('Missing Supabase env');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sign in again to use bulk email.');
  const res = await fetch(`${supabaseUrl}/functions/v1/hm-bulk-email`, {
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

export type BulkSmtpAccountUsage = {
  email: string;
  label: string;
  daily_sent: number;
  daily_cap: number;
  remaining: number;
};

export async function getBulkSettings(): Promise<{
  settings: BulkAppSettings;
  smtp_from: string;
  daily_sent: number;
  hard_daily_cap: number;
  smtp_accounts: BulkSmtpAccountUsage[];
}> {
  const json = await invokeBulk({ action: 'get_settings' });
  return {
    settings: json.settings as BulkAppSettings,
    smtp_from: String(json.smtp_from || ''),
    daily_sent: Number(json.daily_sent) || 0,
    hard_daily_cap: Number(json.hard_daily_cap) || 500,
    smtp_accounts: (json.smtp_accounts as BulkSmtpAccountUsage[]) || [],
  };
}

export async function saveBulkSettings(input: {
  gap_seconds: number;
  daily_cap: number;
  default_provider: BulkProvider;
  smtp?: Record<string, unknown>;
  instantly?: Record<string, unknown>;
  apollo?: Record<string, unknown>;
  billionmail?: Record<string, unknown>;
}): Promise<BulkAppSettings> {
  const json = await invokeBulk({ action: 'save_settings', ...input });
  return json.settings as BulkAppSettings;
}

export async function listBulkCampaigns(): Promise<BulkCampaign[]> {
  const json = await invokeBulk({ action: 'list' });
  return (json.campaigns as BulkCampaign[]) || [];
}

export async function createBulkCampaign(input: {
  name?: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  gapSeconds: number;
  dailyCap: number;
  provider?: BulkProvider;
  fromEmail?: string;
  sourceFile?: string;
  emailColumn?: string;
  nameColumn?: string;
  recipients: Array<{ name: string; email: string; row_index?: number; raw?: Record<string, string> }>;
}): Promise<{ campaign_id: string; total: number; campaign: BulkCampaign }> {
  const json = await invokeBulk({
    action: 'create',
    name: input.name,
    subject: input.subject,
    body_text: input.bodyText,
    body_html: input.bodyHtml,
    gap_seconds: input.gapSeconds,
    daily_cap: input.dailyCap,
    provider: input.provider || 'smtp',
    from_email: input.fromEmail,
    source_file: input.sourceFile,
    email_column: input.emailColumn,
    name_column: input.nameColumn,
    recipients: input.recipients,
  });
  return {
    campaign_id: String(json.campaign_id),
    total: Number(json.total) || 0,
    campaign: json.campaign as BulkCampaign,
  };
}

export async function getBulkCampaignStatus(campaignId: string): Promise<BulkProgress> {
  const json = await invokeBulk({ action: 'status', campaign_id: campaignId });
  return json as unknown as BulkProgress;
}

export async function processBulkNext(campaignId: string): Promise<BulkProgress> {
  const json = await invokeBulk({ action: 'process', campaign_id: campaignId });
  return json as unknown as BulkProgress;
}

export async function pauseBulkCampaign(campaignId: string): Promise<BulkProgress> {
  const json = await invokeBulk({ action: 'pause', campaign_id: campaignId });
  return json as unknown as BulkProgress;
}

export async function resumeBulkCampaign(campaignId: string): Promise<BulkProgress> {
  const json = await invokeBulk({ action: 'resume', campaign_id: campaignId });
  return json as unknown as BulkProgress;
}

export async function cancelBulkCampaign(campaignId: string): Promise<BulkProgress> {
  const json = await invokeBulk({ action: 'cancel', campaign_id: campaignId });
  return json as unknown as BulkProgress;
}

export async function sendBulkTestEmail(input: {
  to: string;
  name?: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  fromEmail?: string;
}): Promise<{
  to: string;
  subject: string;
  from_email: string;
  daily_sent: number;
  daily_cap: number;
  smtp_accounts: BulkSmtpAccountUsage[];
}> {
  const json = await invokeBulk({
    action: 'test_send',
    to: input.to,
    name: input.name,
    subject: input.subject,
    body_text: input.bodyText,
    body_html: input.bodyHtml,
    from_email: input.fromEmail,
  });
  return {
    to: String(json.to || input.to),
    subject: String(json.subject || input.subject),
    from_email: String(json.from_email || ''),
    daily_sent: Number(json.daily_sent) || 0,
    daily_cap: Number(json.daily_cap) || 500,
    smtp_accounts: (json.smtp_accounts as BulkSmtpAccountUsage[]) || [],
  };
}

export function defaultBulkEmailBody(): string {
  return (
    `<p>Hi {{first_name}},</p>\n` +
    `<p>We're reaching out about an opportunity with AO Globe Life.</p>\n` +
    `<p>Reply to this email if you'd like to learn more.</p>\n` +
    `<p>Best,<br/>AO Paz Globelife recruiting</p>`
  );
}

export function looksLikeHtml(value: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

export function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Split compose body into SMTP text + html parts. Plain text is wrapped with <br/>. */
export function splitBulkEmailBody(body: string): { bodyText: string; bodyHtml: string } {
  const raw = body.trim();
  if (!raw) return { bodyText: '', bodyHtml: '' };
  if (looksLikeHtml(raw)) {
    return { bodyText: htmlToPlainText(raw) || raw, bodyHtml: raw };
  }
  return {
    bodyText: raw,
    bodyHtml: raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>\n'),
  };
}

export function applyBulkMerge(template: string, name: string, email: string): string {
  const first = name.trim().split(/\s+/)[0] || 'there';
  return template
    .replace(/\{\{\s*name\s*\}\}/gi, name.trim() || first)
    .replace(/\{\{\s*full_?name\s*\}\}/gi, name.trim() || first)
    .replace(/\{\{\s*first_?name\s*\}\}/gi, first)
    .replace(/\{\{\s*email\s*\}\}/gi, email);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

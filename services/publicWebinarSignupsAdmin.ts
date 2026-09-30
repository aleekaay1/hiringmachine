import { supabase } from './supabaseClient';
import { formatBroadcastWhen } from './publicWebinarSchedule';

export type PublicWebinarLeadSource = 'cold_email' | 'elsewhere';

export type PublicWebinarSignupRow = {
  id: string;
  created_at: string;
  first_name: string;
  last_name: string | null;
  email: string;
  phone: string | null;
  schedule_mode: 'pick' | 'quick' | string;
  session_at: string | null;
  session_label: string | null;
  broadcast_id: string | null;
  webinar_id: string | null;
  wg_subscription_id: string | null;
  already_registered: boolean;
  email_verified: boolean | null;
  watch_link: string | null;
  confirmation_link: string | null;
  custom_field: string | null;
  reference: string | null;
  lead_source: PublicWebinarLeadSource | null;
  matched_campaign_id: string | null;
  matched_campaign_name: string | null;
  matched_recipient_id: string | null;
  matched_recipient_status: string | null;
  matched_at: string | null;
};

const SIGNUP_SELECT_FULL =
  'id, created_at, first_name, last_name, email, phone, schedule_mode, session_at, session_label, broadcast_id, webinar_id, wg_subscription_id, already_registered, email_verified, watch_link, confirmation_link, custom_field, reference, lead_source, matched_campaign_id, matched_campaign_name, matched_recipient_id, matched_recipient_status, matched_at';

const SIGNUP_SELECT_WITHOUT_REFERENCE =
  'id, created_at, first_name, last_name, email, phone, schedule_mode, session_at, session_label, broadcast_id, webinar_id, wg_subscription_id, already_registered, email_verified, watch_link, confirmation_link, custom_field, lead_source, matched_campaign_id, matched_campaign_name, matched_recipient_id, matched_recipient_status, matched_at';

const SIGNUP_SELECT_CORE =
  'id, created_at, first_name, last_name, email, phone, schedule_mode, session_at, session_label, broadcast_id, webinar_id, wg_subscription_id, already_registered, email_verified, watch_link, confirmation_link, custom_field';

function isMissingColumnError(message: string): boolean {
  return /column|schema cache|does not exist/i.test(message);
}

export async function listPublicWebinarSignups(limit = 500): Promise<PublicWebinarSignupRow[]> {
  const selects = [SIGNUP_SELECT_FULL, SIGNUP_SELECT_WITHOUT_REFERENCE, SIGNUP_SELECT_CORE];
  let lastError: Error | null = null;
  for (const select of selects) {
    const { data, error } = await supabase
      .from('hm_public_webinar_signups')
      .select(select)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (!error) {
      return (data || []).map((row) => ({
        reference: null,
        lead_source: null,
        matched_campaign_id: null,
        matched_campaign_name: null,
        matched_recipient_id: null,
        matched_recipient_status: null,
        matched_at: null,
        ...(row as PublicWebinarSignupRow),
      }));
    }
    lastError = error;
    if (!isMissingColumnError(error.message || '')) throw error;
  }
  throw lastError || new Error('Could not load webinar form signups');
}

export type FormSignupMatchResult = {
  total: number;
  cold_email: number;
  elsewhere: number;
  campaign_leads: number;
  matched_at: string | null;
};

export async function matchFormSignupsToCampaignLeads(): Promise<FormSignupMatchResult> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!supabaseUrl || !anon) throw new Error('Missing Supabase env');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sign in again to match form signups.');
  const res = await fetch(`${supabaseUrl}/functions/v1/hm-bulk-email`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anon,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'match_form_signups' }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    total?: number;
    cold_email?: number;
    elsewhere?: number;
    campaign_leads?: number;
    matched_at?: string;
  };
  if (!res.ok) throw new Error(json.error || `Match failed (${res.status})`);
  return {
    total: Number(json.total) || 0,
    cold_email: Number(json.cold_email) || 0,
    elsewhere: Number(json.elsewhere) || 0,
    campaign_leads: Number(json.campaign_leads) || 0,
    matched_at: json.matched_at ? String(json.matched_at) : null,
  };
}

export function formatSignupSubmittedAt(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-CA', {
      timeZone: 'America/Toronto',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function formatSignupSessionAt(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  return formatBroadcastWhen(Math.floor(ms / 1000));
}

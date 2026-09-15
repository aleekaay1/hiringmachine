import { supabase } from './supabaseClient';
import { formatBroadcastWhen } from './publicWebinarSchedule';

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
};

export async function listPublicWebinarSignups(limit = 500): Promise<PublicWebinarSignupRow[]> {
  const { data, error } = await supabase
    .from('hm_public_webinar_signups')
    .select(
      'id, created_at, first_name, last_name, email, phone, schedule_mode, session_at, session_label, broadcast_id, webinar_id, wg_subscription_id, already_registered, email_verified, watch_link, confirmation_link, custom_field',
    )
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []) as PublicWebinarSignupRow[];
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

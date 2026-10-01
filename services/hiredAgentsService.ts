import { supabase } from './supabaseClient';
import { defaultWelcomePackageHtml } from './agentOnboardingHtml';

export { defaultWelcomePackageHtml };

export type HiredMatch = {
  source: 'signup' | 'pipeline' | 'manual' | string;
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  created_at?: string | null;
};

export type HiredAgent = {
  id: string;
  created_at: string;
  hired_at: string;
  source: string;
  full_name: string;
  email: string;
  portal_email: string | null;
  title: string;
  office_phone: string | null;
  office_ext: string | null;
  direct_phone: string | null;
  contact_slug: string;
  portal_user_id: string | null;
  welcome_sent_at: string | null;
  signature_sent_at: string | null;
  invite_sent_at: string | null;
  last_error: string | null;
};

export type HiredPublicCard = {
  fullName: string;
  title: string;
  teamLine: string;
  tagline: string;
  email: string;
  officePhone: string | null;
  officeExt: string | null;
  directPhone: string | null;
  address: string;
  websiteUrl: string;
  logoUrl: string;
  contactUrl: string;
};

async function invokeHired(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!supabaseUrl || !anon) throw new Error('Missing Supabase env');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`${supabaseUrl}/functions/v1/hm-hired`, {
    method: 'POST',
    headers: {
      apikey: anon,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(String(json.error || `Request failed (${res.status})`));
  return json;
}

export async function searchHiredCandidates(q: string): Promise<HiredMatch[]> {
  const json = await invokeHired({ action: 'search', q });
  return Array.isArray(json.matches) ? (json.matches as HiredMatch[]) : [];
}

export async function listHiredAgents(): Promise<HiredAgent[]> {
  const json = await invokeHired({ action: 'list' });
  return Array.isArray(json.agents) ? (json.agents as HiredAgent[]) : [];
}

export async function markCandidateHired(input: {
  fullName: string;
  email: string;
  portalEmail?: string;
  title?: string;
  officePhone?: string;
  officeExt?: string;
  directPhone?: string;
  source?: string;
  signupId?: string;
  personId?: string;
}): Promise<{ agent: HiredAgent }> {
  const json = await invokeHired({
    action: 'mark_hired',
    full_name: input.fullName,
    email: input.email,
    portal_email: input.portalEmail,
    title: input.title,
    office_phone: input.officePhone,
    office_ext: input.officeExt,
    direct_phone: input.directPhone,
    source: input.source || 'manual',
    signup_id: input.signupId,
    person_id: input.personId,
    send_welcome: true,
    send_signature: true,
    invite_portal: true,
  });
  return { agent: json.agent as HiredAgent };
}

export async function resendHiredEmail(
  id: string,
  which: 'welcome' | 'signature' | 'invite' | 'all',
): Promise<void> {
  await invokeHired({ action: 'resend', id, which });
}

export async function loadPublicAgentCard(slug: string): Promise<{
  card: HiredPublicCard;
  signature_html: string;
  vcard: string;
}> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!supabaseUrl || !anon) throw new Error('Missing Supabase env');
  const res = await fetch(`${supabaseUrl}/functions/v1/hm-hired`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'public_card', slug }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    card?: HiredPublicCard;
    signature_html?: string;
    vcard?: string;
  };
  if (!res.ok || !json.card) throw new Error(json.error || 'Contact not found');
  return {
    card: json.card,
    signature_html: json.signature_html || '',
    vcard: json.vcard || '',
  };
}

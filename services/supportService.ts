import { supabase } from './supabaseClient';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export type SupportTicketCategory =
  | 'bug'
  | 'access'
  | 'pipeline'
  | 'leaderboard'
  | 'email'
  | 'feature'
  | 'other';

export type SupportTicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

export type SupportTicket = {
  id: string;
  user_id: string;
  submitter_email: string;
  submitter_name: string | null;
  category: SupportTicketCategory;
  subject: string;
  body: string;
  status: SupportTicketStatus;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
};

export type SupportTicketEvent = {
  id: string;
  ticket_id: string;
  actor_user_id: string | null;
  actor_email: string | null;
  event_type: 'created' | 'status_change' | 'staff_reply' | 'resolution';
  message: string | null;
  new_status: string | null;
  visible_to_user: boolean;
  created_at: string;
};

export const SUPPORT_CATEGORIES: Array<{ id: SupportTicketCategory; label: string; hint: string }> = [
  { id: 'bug', label: 'Bug / error', hint: 'Something broke or shows an error' },
  { id: 'access', label: 'Access / login', hint: 'Cannot sign in or missing permissions' },
  { id: 'pipeline', label: 'Pipeline / calls', hint: 'Call workspace, uploads, dispositions' },
  { id: 'leaderboard', label: 'Leaderboard / stats', hint: 'Rankings, KPIs, or dashboard numbers' },
  { id: 'email', label: 'Email', hint: 'Outbound email or inbox sync issues' },
  { id: 'feature', label: 'Feature request', hint: 'Suggest an improvement' },
  { id: 'other', label: 'Other', hint: 'Anything else' },
];

export const SUPPORT_STATUS_LABELS: Record<SupportTicketStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
};

async function authToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not authenticated.');
  return token;
}

export async function createSupportTicket(input: {
  category: SupportTicketCategory;
  subject: string;
  body: string;
  submitterName?: string | null;
}): Promise<{ ticket: SupportTicket; emailSent: boolean }> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('App is not configured for support tickets.');
  }
  const token = await authToken();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/support-tickets`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(String(json.error || `Ticket submit failed (${res.status})`));
  }
  return { ticket: json.ticket as SupportTicket, emailSent: Boolean(json.emailSent) };
}

export async function listMySupportTickets(): Promise<SupportTicket[]> {
  const { data, error } = await supabase
    .from('support_tickets')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []) as SupportTicket[];
}

export async function listMySupportTicketEvents(ticketId: string): Promise<SupportTicketEvent[]> {
  const { data, error } = await supabase
    .from('support_ticket_events')
    .select('*')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []) as SupportTicketEvent[];
}

import type { SupportTicket, SupportTicketEvent, SupportTicketStatus } from './supportService';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export type OpsHealthCheck = {
  label: string;
  ok?: boolean;
  url?: string;
  status?: number;
  latencyMs?: number;
  detail?: string;
  error?: string;
};

export type OpsHealthPayload = {
  capturedAt: string;
  durationMs: number;
  overallOk: boolean;
  checks: OpsHealthCheck[];
  appUrl: string;
};

export type OpsHealthSnapshot = {
  id: string;
  created_at: string;
  payload: OpsHealthPayload;
};

import { supabase } from './supabaseClient';

async function opsFetch(path: string, init?: RequestInit): Promise<Response> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('App is not configured for ops console.');
  }
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not authenticated.');
  return fetch(`${SUPABASE_URL}/functions/v1/ops-console${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });
}
export async function runOpsHealthCheck(): Promise<{
  health: OpsHealthPayload;
  saved: { id: string; created_at: string } | null;
  saveError: string | null;
}> {
  const res = await opsFetch('?action=health', { method: 'GET' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(json.error || `Health check failed (${res.status})`));
  return {
    health: json.health as OpsHealthPayload,
    saved: json.saved ?? null,
    saveError: json.saveError ?? null,
  };
}

export async function listOpsHealthHistory(): Promise<OpsHealthSnapshot[]> {
  const res = await opsFetch('?action=health_history', { method: 'GET' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(json.error || `History failed (${res.status})`));
  return (json.snapshots || []) as OpsHealthSnapshot[];
}

export async function listAllSupportTickets(status?: SupportTicketStatus): Promise<SupportTicket[]> {
  const q = status ? `?action=tickets&status=${encodeURIComponent(status)}` : '?action=tickets';
  const res = await opsFetch(q, { method: 'GET' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(json.error || `Tickets load failed (${res.status})`));
  return (json.tickets || []) as SupportTicket[];
}

export async function listOpsTicketEvents(ticketId: string): Promise<SupportTicketEvent[]> {
  const res = await opsFetch(`?action=ticket_events&ticketId=${encodeURIComponent(ticketId)}`, { method: 'GET' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(json.error || `Events load failed (${res.status})`));
  return (json.events || []) as SupportTicketEvent[];
}

export async function updateSupportTicketAsOps(input: {
  ticketId: string;
  status: SupportTicketStatus;
  resolutionNote?: string;
  staffMessage?: string;
}): Promise<SupportTicket> {
  const res = await opsFetch('', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'update_ticket', ...input }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(json.error || `Update failed (${res.status})`));
  return json.ticket as SupportTicket;
}

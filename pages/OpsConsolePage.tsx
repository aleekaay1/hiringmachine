import React from 'react';
import { Activity, CheckCircle2, RefreshCw, Shield, Ticket, XCircle } from 'lucide-react';
import PipelineAuthShell from '../components/PipelineAuthShell';
import { Button } from '../components/UI';
import { formatDateTimeCanadaEastern } from '../services/dateDisplay';
import { canAccessOpsConsole } from '../services/accessControl';
import {
  listAllSupportTickets,
  listOpsHealthHistory,
  listOpsTicketEvents,
  runOpsHealthCheck,
  updateSupportTicketAsOps,
  type OpsHealthPayload,
  type OpsHealthSnapshot,
} from '../services/opsConsoleService';
import {
  SUPPORT_STATUS_LABELS,
  type SupportTicket,
  type SupportTicketEvent,
  type SupportTicketStatus,
} from '../services/supportService';
import { Navigate } from 'react-router-dom';
import { createStaffNotification } from '../services/notificationService';

function CheckRow({ label, ok, detail }: { label: string; ok?: boolean; detail?: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-[#e3eef9] bg-white px-3 py-2 text-xs">
      {ok === false ? <XCircle size={14} className="mt-0.5 shrink-0 text-rose-500" /> : <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-600" />}
      <div>
        <p className="font-semibold text-[#0B1B34]">{label}</p>
        {detail && <p className="text-[#6a839f]">{detail}</p>}
      </div>
    </div>
  );
}

const OpsConsolePage: React.FC = () => {
  const [allowed, setAllowed] = React.useState<boolean | null>(null);
  const [health, setHealth] = React.useState<OpsHealthPayload | null>(null);
  const [history, setHistory] = React.useState<OpsHealthSnapshot[]>([]);
  const [tickets, setTickets] = React.useState<SupportTicket[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [events, setEvents] = React.useState<SupportTicketEvent[]>([]);
  const [statusFilter, setStatusFilter] = React.useState<SupportTicketStatus | 'all'>('open');
  const [resolutionNote, setResolutionNote] = React.useState('');
  const [staffMessage, setStaffMessage] = React.useState('');
  const [newStatus, setNewStatus] = React.useState<SupportTicketStatus>('in_progress');
  const [loadingHealth, setLoadingHealth] = React.useState(false);
  const [loadingTickets, setLoadingTickets] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [broadcastTitle, setBroadcastTitle] = React.useState('');
  const [broadcastBody, setBroadcastBody] = React.useState('');
  const [broadcastRoles, setBroadcastRoles] = React.useState<string[]>(['recruiter', 'leadership', 'webinar']);
  const [broadcasting, setBroadcasting] = React.useState(false);

  React.useEffect(() => {
    void canAccessOpsConsole().then(setAllowed);
  }, []);

  const refreshHealth = React.useCallback(async () => {
    setLoadingHealth(true);
    setError(null);
    try {
      const result = await runOpsHealthCheck();
      setHealth(result.health);
      const hist = await listOpsHealthHistory();
      setHistory(hist);
      if (result.saveError) setMessage(`Health saved with warning: ${result.saveError}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingHealth(false);
    }
  }, []);

  const refreshTickets = React.useCallback(async () => {
    setLoadingTickets(true);
    setError(null);
    try {
      const rows = await listAllSupportTickets(statusFilter === 'all' ? undefined : statusFilter);
      setTickets(rows);
      if (!selectedId && rows[0]) setSelectedId(rows[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingTickets(false);
    }
  }, [selectedId, statusFilter]);

  React.useEffect(() => {
    if (!allowed) return;
    void refreshTickets();
    void listOpsHealthHistory().then(setHistory).catch(() => undefined);
  }, [allowed, refreshTickets]);

  React.useEffect(() => {
    if (!selectedId || !allowed) return;
    void listOpsTicketEvents(selectedId).then(setEvents).catch(() => setEvents([]));
  }, [selectedId, allowed]);

  const selected = tickets.find((t) => t.id === selectedId) ?? null;

  React.useEffect(() => {
    if (!selected) return;
    setNewStatus(selected.status);
    setResolutionNote(selected.resolution_note || '');
    setStaffMessage('');
  }, [selected?.id, selected?.status, selected?.resolution_note]);

  const sendBroadcast = async () => {
    if (!broadcastTitle.trim()) {
      setError('Broadcast title is required.');
      return;
    }
    setBroadcasting(true);
    setError(null);
    setMessage(null);
    try {
      await createStaffNotification({
        title: broadcastTitle.trim(),
        body: broadcastBody.trim() || undefined,
        category: 'ops',
        targetRoles: broadcastRoles.length ? broadcastRoles : null,
        linkRoute: '/home',
        linkLabel: 'Open dashboard',
      });
      setMessage('Broadcast notification sent to staff.');
      setBroadcastTitle('');
      setBroadcastBody('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBroadcasting(false);
    }
  };

  const saveTicketUpdate = async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await updateSupportTicketAsOps({
        ticketId: selected.id,
        status: newStatus,
        resolutionNote,
        staffMessage,
      });
      setMessage('Ticket updated — user will see the update on their Support page.');
      await refreshTickets();
      const ev = await listOpsTicketEvents(selected.id);
      setEvents(ev);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (allowed === null) {
    return (
      <PipelineAuthShell title="Ops" subtitle="Checking access…" redirectPath="/ops-console">
        <p className="p-6 text-sm text-[#5c7594]">Verifying access…</p>
      </PipelineAuthShell>
    );
  }

  if (!allowed) {
    return <Navigate to="/home" replace />;
  }

  return (
    <PipelineAuthShell title="Ops Console" subtitle="Ali-only monitoring & support backend" redirectPath="/ops-console">
      <div className="mx-auto w-full max-w-[1320px] space-y-4 p-1">
        <div className="rounded-3xl border border-[#0B1B34]/10 bg-gradient-to-br from-[#0B1B34] via-[#132d52] to-[#1a3d66] p-5 text-white shadow-lg">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.28em] text-cyan-200/80">Private ops</p>
              <h1 className="text-2xl font-semibold">Paz Ops Console</h1>
              <p className="mt-1 text-sm text-slate-300">Manual refresh only — no auto polling (saves egress).</p>
            </div>
            <Shield size={28} className="text-cyan-300" />
          </div>
        </div>

        {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">{error}</div>}
        {message && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{message}</div>}

        <section className="rounded-2xl border border-[#d9e5f6] bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Activity size={16} className="text-[#4e9ae8]" />
              <h2 className="text-sm font-semibold text-[#0B1B34]">System health</h2>
            </div>
            <Button variant="outline" className="!min-h-0 h-9 px-3 text-xs" onClick={() => void refreshHealth()} disabled={loadingHealth}>
              <RefreshCw size={14} className={loadingHealth ? 'mr-1 animate-spin' : 'mr-1'} />
              Run health check
            </Button>
          </div>
          {health ? (
            <div className="space-y-2">
              <p className={`text-xs font-semibold ${health.overallOk ? 'text-emerald-700' : 'text-amber-700'}`}>
                {health.overallOk ? 'All checks passed' : 'Some checks need attention'} · {formatDateTimeCanadaEastern(health.capturedAt)}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {health.checks.map((check) => (
                  <CheckRow
                    key={check.label}
                    label={check.label}
                    ok={check.ok}
                    detail={
                      check.detail ||
                      check.error ||
                      (check.status ? `HTTP ${check.status} · ${check.latencyMs}ms` : undefined)
                    }
                  />
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-[#5c7594]">Click “Run health check” to probe Supabase, Vercel, edge functions, and email logs.</p>
          )}
          {history.length > 0 && (
            <div className="mt-4 border-t border-[#e3eef9] pt-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[#4e79a9]">Recent snapshots (DB)</p>
              <div className="flex flex-wrap gap-2">
                {history.slice(0, 6).map((snap) => (
                  <button
                    key={snap.id}
                    type="button"
                    onClick={() => setHealth(snap.payload)}
                    className="rounded-lg border border-[#cde0f4] bg-[#f8fbff] px-2 py-1 text-[10px] text-[#365274]"
                  >
                    {formatDateTimeCanadaEastern(snap.created_at)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-[#d9e5f6] bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-[#0B1B34]">Staff broadcast notification</h2>
          <p className="mb-3 text-xs text-[#5c7594]">
            Pushes to the bell icon for selected roles (email replies, check-ins, and pipeline alerts sync automatically).
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-[#5c7594]">Title</span>
              <input
                className="w-full rounded-xl border border-[#c9d9ee] px-3 py-2"
                value={broadcastTitle}
                onChange={(e) => setBroadcastTitle(e.target.value)}
                placeholder="System maintenance tonight"
              />
            </label>
            <label className="block text-sm md:col-span-2">
              <span className="mb-1 block text-xs font-medium text-[#5c7594]">Message</span>
              <textarea
                className="min-h-[80px] w-full rounded-xl border border-[#c9d9ee] px-3 py-2"
                value={broadcastBody}
                onChange={(e) => setBroadcastBody(e.target.value)}
                placeholder="Optional details for recruiters and leadership."
              />
            </label>
            <div className="flex flex-wrap gap-2 md:col-span-2">
              {['recruiter', 'leadership', 'webinar', 'admin'].map((role) => (
                <label key={role} className="inline-flex items-center gap-2 rounded-lg border border-[#d4e4f7] px-3 py-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={broadcastRoles.includes(role)}
                    onChange={(e) => {
                      setBroadcastRoles((prev) =>
                        e.target.checked ? [...prev, role] : prev.filter((r) => r !== role),
                      );
                    }}
                  />
                  {role}
                </label>
              ))}
            </div>
            <div className="md:col-span-2">
              <Button onClick={() => void sendBroadcast()} disabled={broadcasting}>
                {broadcasting ? 'Sending…' : 'Send broadcast'}
              </Button>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-[#d9e5f6] bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Ticket size={16} className="text-[#4e9ae8]" />
              <h2 className="text-sm font-semibold text-[#0B1B34]">Support tickets</h2>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as SupportTicketStatus | 'all')}
                className="rounded-lg border border-[#bfd6ee] px-2 py-1 text-xs"
              >
                <option value="all">All</option>
                <option value="open">Open</option>
                <option value="in_progress">In progress</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
              </select>
              <Button variant="outline" className="!min-h-0 h-8 px-2 text-xs" onClick={() => void refreshTickets()} disabled={loadingTickets}>
                Refresh
              </Button>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(260px,340px)_1fr]">
            <div className="max-h-[420px] space-y-2 overflow-y-auto">
              {tickets.map((ticket) => (
                <button
                  key={ticket.id}
                  type="button"
                  onClick={() => setSelectedId(ticket.id)}
                  className={`w-full rounded-xl border px-3 py-2 text-left text-xs ${
                    selectedId === ticket.id ? 'border-[#7eb3e7] bg-[#eef6ff]' : 'border-[#e3eef9] bg-white'
                  }`}
                >
                  <p className="font-semibold text-[#0B1B34]">{ticket.subject}</p>
                  <p className="text-[#6a839f]">
                    {ticket.submitter_email} · {ticket.category}
                  </p>
                  <p className="text-[#6a839f]">{SUPPORT_STATUS_LABELS[ticket.status]}</p>
                </button>
              ))}
              {!tickets.length && !loadingTickets && (
                <p className="text-xs text-[#6a839f]">No tickets in this filter.</p>
              )}
            </div>

            {selected ? (
              <div className="space-y-3 rounded-xl border border-[#e3eef9] bg-[#f9fcff] p-3">
                <div>
                  <p className="text-sm font-semibold text-[#0B1B34]">{selected.subject}</p>
                  <p className="text-xs text-[#6a839f]">
                    {selected.submitter_name || selected.submitter_email} · {formatDateTimeCanadaEastern(selected.created_at)}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-[#365274]">{selected.body}</p>
                </div>
                <label className="block text-xs text-[#365274]">
                  Status
                  <select
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value as SupportTicketStatus)}
                    className="mt-1 w-full rounded-lg border border-[#bfd6ee] px-2 py-1.5 text-sm"
                  >
                    {Object.entries(SUPPORT_STATUS_LABELS).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs text-[#365274]">
                  Resolution / reply note (visible to user)
                  <textarea
                    value={resolutionNote}
                    onChange={(e) => setResolutionNote(e.target.value)}
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-[#bfd6ee] px-2 py-1.5 text-sm"
                    placeholder="Fixed by… / Please try…"
                  />
                </label>
                <label className="block text-xs text-[#365274]">
                  Optional staff message
                  <textarea
                    value={staffMessage}
                    onChange={(e) => setStaffMessage(e.target.value)}
                    rows={2}
                    className="mt-1 w-full rounded-lg border border-[#bfd6ee] px-2 py-1.5 text-sm"
                  />
                </label>
                <Button onClick={() => void saveTicketUpdate()} disabled={saving}>
                  {saving ? 'Saving…' : 'Update ticket'}
                </Button>
                <div className="space-y-1 border-t border-[#e3eef9] pt-2">
                  {events.map((ev) => (
                    <div key={ev.id} className="text-[11px] text-[#6a839f]">
                      {ev.event_type} · {formatDateTimeCanadaEastern(ev.created_at)}
                      {ev.message ? ` — ${ev.message}` : ''}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-[#5c7594]">Select a ticket to respond.</p>
            )}
          </div>
        </section>
      </div>
    </PipelineAuthShell>
  );
};

export default OpsConsolePage;

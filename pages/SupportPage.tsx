import React from 'react';
import { LifeBuoy, Send, Ticket } from 'lucide-react';
import PipelineAuthShell from '../components/PipelineAuthShell';
import PageGuidePanel from '../components/tour/PageGuidePanel';
import { Button } from '../components/UI';
import { PORTAL_FAQS } from '../content/portalTourContent';
import { WALKTHROUGH_CATALOG } from '../content/taskWalkthroughs';
import { requestTaskWalkthrough } from '../services/portalTourService';
import { formatDateTimeCanadaEastern } from '../services/dateDisplay';
import { getCurrentUserProfile } from '../services/accessControl';
import {
  SUPPORT_CATEGORIES,
  SUPPORT_STATUS_LABELS,
  createSupportTicket,
  listMySupportTicketEvents,
  listMySupportTickets,
  type SupportTicket,
  type SupportTicketCategory,
  type SupportTicketEvent,
} from '../services/supportService';

function statusPill(status: string): string {
  if (status === 'resolved') return 'bg-emerald-100 text-emerald-800';
  if (status === 'closed') return 'bg-slate-100 text-slate-700';
  if (status === 'in_progress') return 'bg-amber-100 text-amber-800';
  return 'bg-sky-100 text-sky-800';
}

const SupportPage: React.FC = () => {
  const [category, setCategory] = React.useState<SupportTicketCategory>('bug');
  const [subject, setSubject] = React.useState('');
  const [body, setBody] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [tickets, setTickets] = React.useState<SupportTicket[]>([]);
  const [loadingTickets, setLoadingTickets] = React.useState(true);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [events, setEvents] = React.useState<SupportTicketEvent[]>([]);

  const loadTickets = React.useCallback(async () => {
    setLoadingTickets(true);
    try {
      const rows = await listMySupportTickets();
      setTickets(rows);
      if (!selectedId && rows[0]) setSelectedId(rows[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingTickets(false);
    }
  }, [selectedId]);

  React.useEffect(() => {
    void loadTickets();
  }, [loadTickets]);

  React.useEffect(() => {
    if (!selectedId) {
      setEvents([]);
      return;
    }
    let cancelled = false;
    void listMySupportTicketEvents(selectedId)
      .then((rows) => {
        if (!cancelled) setEvents(rows);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const submitTicket = async () => {
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const profile = await getCurrentUserProfile();
      const result = await createSupportTicket({
        category,
        subject,
        body,
        submitterName: profile?.full_name ?? null,
      });
      setSubject('');
      setBody('');
      setSelectedId(result.ticket.id);
      setMessage(
        result.emailSent
          ? 'Ticket submitted. Ali was notified by email — you can track updates below.'
          : 'Ticket saved. Email notification could not be sent, but your ticket is on file.',
      );
      await loadTickets();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const selected = tickets.find((t) => t.id === selectedId) ?? null;

  return (
    <PipelineAuthShell title="Support" subtitle="Sign in to submit a ticket" redirectPath="/support">
      <div className="mx-auto w-full max-w-[1180px] space-y-4 p-1">
        <div className="rounded-3xl border border-[#d4e4f7] bg-gradient-to-br from-white via-[#f7fbff] to-[#eef6ff] p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.24em] text-[#4e79a9]">Help center</p>
              <h1 className="text-2xl font-semibold text-[#0B1B34]">Support</h1>
              <p className="mt-1 text-sm text-[#5c7594]">
                Report an issue in one click. Tickets go to Ali and updates appear here on your account.
              </p>
            </div>
            <LifeBuoy className="text-[#4e9ae8]" size={28} />
          </div>
        </div>

        {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">{error}</div>}
        {message && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{message}</div>}

        <section className="rounded-2xl border border-[#d9e5f6] bg-white p-4 shadow-sm">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-[#0B1B34]">Interactive training guides</h2>
            <p className="mt-1 text-xs text-[#5c7594]">
              Pick a task below. Each guide opens the right page, highlights where to click, and walks you through step by step.
            </p>
          </div>
          <div className="space-y-4">
            {WALKTHROUGH_CATALOG.map((section) => (
              <div key={section.page} className="rounded-xl border border-[#e8eef5] bg-[#f8fbff] p-3">
                <div className="mb-2">
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#4e79a9]">{section.page}</p>
                  <p className="text-[11px] text-[#6a839f]">{section.description}</p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {section.guides.map((guide) => (
                    <button
                      key={`${section.page}-${guide.id}`}
                      type="button"
                      onClick={() => requestTaskWalkthrough(guide.id)}
                      className="rounded-xl border border-[#d6e6f8] bg-white px-3 py-2.5 text-left transition hover:border-[#9bc8f6] hover:bg-[#f0f7ff]"
                    >
                      <p className="text-sm font-semibold text-[#0B1B34]">{guide.title}</p>
                      <p className="mt-0.5 text-xs text-[#5c7594]">{guide.summary}</p>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <PageGuidePanel guideId="support" />

        <section className="rounded-2xl border border-[#d9e5f6] bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-[#0B1B34]">Frequently asked questions</h2>
          <div className="mt-3 space-y-2">
            {PORTAL_FAQS.map((item) => (
              <details key={item.q} className="rounded-xl border border-[#e8eef5] bg-[#f8fbff] px-3 py-2">
                <summary className="cursor-pointer text-sm font-medium text-[#0B1B34]">{item.q}</summary>
                <p className="mt-2 pb-1 text-sm text-[#4b6d95]">{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <section className="rounded-2xl border border-[#d9e5f6] bg-white p-4 shadow-sm" data-tour="support-ticket-form">
            <h2 className="text-sm font-semibold text-[#0B1B34]">Submit a ticket</h2>
            <div className="mt-3 space-y-3">
              <label className="block text-xs text-[#365274]">
                Category
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as SupportTicketCategory)}
                  className="mt-1 w-full rounded-xl border border-[#bfd6ee] px-3 py-2 text-sm"
                >
                  {SUPPORT_CATEGORIES.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-[11px] text-[#6a839f]">
                  {SUPPORT_CATEGORIES.find((c) => c.id === category)?.hint}
                </span>
              </label>
              <label className="block text-xs text-[#365274]">
                Subject
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Short summary of the issue"
                  className="mt-1 w-full rounded-xl border border-[#bfd6ee] px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-xs text-[#365274]">
                Details
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={6}
                  placeholder="What happened? Steps to reproduce, screenshots links, etc."
                  className="mt-1 w-full rounded-xl border border-[#bfd6ee] px-3 py-2 text-sm"
                />
              </label>
              <Button className="w-full" onClick={() => void submitTicket()} disabled={submitting}>
                <Send size={16} className="mr-2" />
                {submitting ? 'Submitting…' : 'Submit ticket'}
              </Button>
            </div>
          </section>

          <section className="rounded-2xl border border-[#d9e5f6] bg-white p-4 shadow-sm" data-tour="support-ticket-list">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-[#0B1B34]">Your tickets</h2>
              <button type="button" onClick={() => void loadTickets()} className="text-xs font-semibold text-[#005EB8]">
                Refresh
              </button>
            </div>
            {loadingTickets ? (
              <p className="text-sm text-[#5c7594]">Loading tickets…</p>
            ) : !tickets.length ? (
              <p className="rounded-xl border border-dashed border-[#cde0f4] px-4 py-8 text-center text-sm text-[#5c7594]">
                No tickets yet. Submit one on the left.
              </p>
            ) : (
              <div className="space-y-2">
                {tickets.map((ticket) => (
                  <button
                    key={ticket.id}
                    type="button"
                    onClick={() => setSelectedId(ticket.id)}
                    className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${
                      selectedId === ticket.id ? 'border-[#7eb3e7] bg-[#eef6ff]' : 'border-[#e3eef9] bg-white hover:bg-[#f8fbff]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[#0B1B34]">{ticket.subject}</p>
                        <p className="text-[11px] text-[#6a839f]">
                          {ticket.category} · {formatDateTimeCanadaEastern(ticket.updated_at)}
                        </p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusPill(ticket.status)}`}>
                        {SUPPORT_STATUS_LABELS[ticket.status as keyof typeof SUPPORT_STATUS_LABELS] || ticket.status}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>

        {selected && (
          <section className="rounded-2xl border border-[#d9e5f6] bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <Ticket size={16} className="text-[#4e9ae8]" />
              <h2 className="text-sm font-semibold text-[#0B1B34]">{selected.subject}</h2>
            </div>
            <p className="whitespace-pre-wrap text-sm text-[#365274]">{selected.body}</p>
            {selected.resolution_note && (
              <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                <p className="text-[10px] font-semibold uppercase tracking-wide">Resolution note</p>
                <p className="mt-1">{selected.resolution_note}</p>
              </div>
            )}
            <div className="mt-4 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#4e79a9]">Updates</p>
              {events.map((event) => (
                <div key={event.id} className="rounded-xl border border-[#e3eef9] bg-[#f9fcff] px-3 py-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-[#0B1B34]">{event.event_type.replace(/_/g, ' ')}</span>
                    <span className="text-[#6a839f]">{formatDateTimeCanadaEastern(event.created_at)}</span>
                  </div>
                  {event.message && <p className="mt-1 text-[#365274]">{event.message}</p>}
                  {event.new_status && (
                    <p className="mt-1 text-[#6a839f]">Status → {SUPPORT_STATUS_LABELS[event.new_status as keyof typeof SUPPORT_STATUS_LABELS] || event.new_status}</p>
                  )}
                </div>
              ))}
              {!events.length && <p className="text-xs text-[#6a839f]">No updates yet — Ali will reply here when resolved.</p>}
            </div>
          </section>
        )}
      </div>
    </PipelineAuthShell>
  );
};

export default SupportPage;

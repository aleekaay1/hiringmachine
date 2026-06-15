import React from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Mail, Phone, Search, X } from 'lucide-react';
import { formatDateTimeCanadaEastern } from '../../services/dateDisplay';
import { liveSessionStatusLabel } from '../../services/candidateActivityStats';
import { matchesCallHistorySearch, dispositionBadgeClass, type CallHistoryRow } from '../../services/callHistoryRows';
import type { LiveSessionRegistrantRow } from '../../services/liveSessionBookedOutcomes';
import type { PipelineCandidate } from '../../services/pipelineService';

export type CallHistorySheetTone = {
  glassPanel: string;
  panelTitle: string;
  panelMuted: string;
  panelLabel: string;
  input: string;
  actionButton: string;
  subtle: string;
  modalBackdrop: string;
};

type CallHistorySheetProps = {
  open: boolean;
  rows: CallHistoryRow[];
  registrants: LiveSessionRegistrantRow[];
  candidates: PipelineCandidate[];
  onClose: () => void;
  onCallLead: (candidateId: string) => void;
  onEmailLead: (candidateId: string) => void;
  tone: CallHistorySheetTone;
};

const CallHistorySheet: React.FC<CallHistorySheetProps> = ({
  open,
  rows,
  registrants,
  candidates,
  onClose,
  onCallLead,
  onEmailLead,
  tone,
}) => {
  const candidateById = React.useMemo(
    () => new Map(candidates.map((c) => [c.id, c])),
    [candidates],
  );
  const [query, setQuery] = React.useState('');

  React.useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const filtered = React.useMemo(() => {
    if (!query.trim()) return rows;
    return rows.filter((row) => matchesCallHistorySearch(row, query));
  }, [rows, query]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className={`fixed inset-0 z-[250] flex flex-col ${tone.modalBackdrop}`}
          role="presentation"
        >
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className={`mx-auto flex h-full w-full max-w-[1600px] flex-col border shadow-2xl ${tone.glassPanel}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="call-history-title"
          >
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[#d4e4f7]/80 px-4 py-3 md:px-6">
              <div>
                <p className={`text-[10px] uppercase tracking-[0.22em] ${tone.panelLabel}`}>Call history</p>
                <h2 id="call-history-title" className={`text-lg font-semibold ${tone.panelTitle}`}>
                  Your dialed leads
                </h2>
                <p className={`text-xs ${tone.panelMuted}`}>
                  {filtered.length} lead{filtered.length === 1 ? '' : 's'}
                  {query.trim() ? ` matching “${query.trim()}”` : ' · most recent first'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[220px] flex-1 sm:min-w-[280px]">
                  <Search size={14} className={`absolute left-2.5 top-1/2 -translate-y-1/2 ${tone.panelLabel}`} />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search name, phone, email, disposition, comment…"
                    className={`w-full rounded-xl border py-2 pl-8 pr-3 text-sm ${tone.input}`}
                    autoFocus
                  />
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border ${tone.actionButton}`}
                  aria-label="Close call history"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-2 py-2 md:px-4 md:py-3">
              {filtered.length === 0 ? (
                <p className={`rounded-xl border border-dashed p-8 text-center text-sm ${tone.panelMuted}`}>
                  {query.trim() ? 'No leads match your search.' : 'No call history yet — place a call and save a disposition.'}
                </p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-[#d4e4f7]/80">
                  <table className="w-full min-w-[1080px] border-collapse text-left text-sm">
                    <thead className="sticky top-0 z-10 border-b border-[#d4e4f7] bg-[#f0f7ff]/95 backdrop-blur">
                      <tr>
                        <th className={`px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide ${tone.panelLabel}`}>Name</th>
                        <th className={`px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide ${tone.panelLabel}`}>Phone</th>
                        <th className={`px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide ${tone.panelLabel}`}>Email</th>
                        <th className={`px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide ${tone.panelLabel}`}>Role</th>
                        <th className={`px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide ${tone.panelLabel}`}>Disposition</th>
                        <th className={`min-w-[200px] px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide ${tone.panelLabel}`}>Comment</th>
                        <th className={`px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide ${tone.panelLabel}`}>Live session</th>
                        <th className={`px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide ${tone.panelLabel}`}>Last call</th>
                        <th className={`px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide ${tone.panelLabel}`}>Batch</th>
                        <th className={`px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide ${tone.panelLabel}`}>Calls</th>
                        <th className={`px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide ${tone.panelLabel}`}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((row, index) => (
                        <tr
                          key={row.candidateId}
                          className={`border-b border-[#e8f1fb] ${index % 2 === 0 ? 'bg-white/90' : 'bg-[#f8fbff]/90'} hover:bg-[#edf5ff]/90`}
                        >
                          <td className={`px-3 py-2.5 font-semibold ${tone.panelTitle}`}>{row.displayName}</td>
                          <td className={`px-3 py-2.5 tabular-nums ${tone.panelMuted}`}>{row.phone || '—'}</td>
                          <td className={`max-w-[180px] truncate px-3 py-2.5 ${tone.panelMuted}`} title={row.email}>
                            {row.email || '—'}
                          </td>
                          <td className={`max-w-[140px] truncate px-3 py-2.5 ${tone.panelMuted}`} title={row.title || ''}>
                            {row.title || '—'}
                          </td>
                          <td className="px-3 py-2.5">
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${dispositionBadgeClass(row.disposition)}`}
                            >
                              {row.disposition}
                            </span>
                          </td>
                          <td className={`max-w-[280px] px-3 py-2.5 text-xs ${tone.panelMuted}`}>
                            {row.latestComment ? (
                              <p className="line-clamp-2 whitespace-pre-wrap text-[#0B1B34]" title={row.latestComment}>
                                {row.latestComment}
                              </p>
                            ) : (
                              <span className="italic opacity-70">—</span>
                            )}
                          </td>
                          <td className={`px-3 py-2.5 text-xs ${tone.panelMuted}`}>
                            {liveSessionStatusLabel(
                              row.latestRecord,
                              row.candidate ?? candidateById.get(row.candidateId) ?? null,
                              registrants,
                            )}
                          </td>
                          <td className={`whitespace-nowrap px-3 py-2.5 text-xs ${tone.panelMuted}`}>
                            {formatDateTimeCanadaEastern(row.disposedAt)}
                          </td>
                          <td className={`max-w-[120px] truncate px-3 py-2.5 text-xs ${tone.panelMuted}`} title={row.batchTitle}>
                            {row.batchTitle}
                          </td>
                          <td className={`px-3 py-2.5 text-center tabular-nums ${tone.panelMuted}`}>{row.callCount}</td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                title="Open lead to call again"
                                onClick={() => onCallLead(row.candidateId)}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#7eb3e7] bg-[#e8f3ff] text-[#285082] hover:bg-[#d9ebff]"
                              >
                                <Phone size={14} />
                              </button>
                              <button
                                type="button"
                                title="Send email"
                                onClick={() => onEmailLead(row.candidateId)}
                                className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border ${tone.actionButton}`}
                              >
                                <Mail size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
};

export default CallHistorySheet;

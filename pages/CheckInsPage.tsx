import React from 'react';
import { RefreshCw, RotateCcw, Send, Trash2 } from 'lucide-react';
import {
  AO_HUB_URL,
  applyCheckInEmailMerge,
  defaultAoHubEmailTemplate,
  deleteCheckInEntry,
  listCheckInEntries,
  sendAoHubInviteForCheckIn,
  type CheckInEmailTemplate,
  type CheckInRow,
} from '../services/checkInService';

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-CA', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

const PROVINCE_LABELS: Record<string, string> = {
  AB: 'Alberta',
  BC: 'British Columbia',
  MB: 'Manitoba',
  NB: 'New Brunswick',
  NL: 'Newfoundland and Labrador',
  NS: 'Nova Scotia',
  NT: 'Northwest Territories',
  NU: 'Nunavut',
  ON: 'Ontario',
  PE: 'Prince Edward Island',
  QC: 'Quebec',
  SK: 'Saskatchewan',
  YT: 'Yukon',
};

function yesNo(value?: string | null): string {
  if (value === 'yes') return 'Yes';
  if (value === 'no') return 'No';
  return '—';
}

function isNotEligibleCanada(row: CheckInRow): boolean {
  return (
    row.applicantQuestionnaire?.legallyEntitledCanada === 'no' ||
    (row.adminData?.tags || []).includes('not_eligible_canada')
  );
}

const CheckInsPage: React.FC = () => {
  const defaults = React.useMemo(() => defaultAoHubEmailTemplate(), []);
  const [rows, setRows] = React.useState<CheckInRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [sendingId, setSendingId] = React.useState<string | null>(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [actionMsg, setActionMsg] = React.useState<string | null>(null);
  const [subject, setSubject] = React.useState(defaults.subject);
  const [body, setBody] = React.useState(defaults.body);
  const [previewId, setPreviewId] = React.useState<string | null>(null);
  const [openId, setOpenId] = React.useState<string | null>(null);

  const template: CheckInEmailTemplate = { subject, body };

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const next = await listCheckInEntries();
      setRows(next);
      setPreviewId((prev) => prev || next[0]?.id || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load check-ins');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const pending = rows.filter((r) => !r.aoHubInviteSentAt && !isNotEligibleCanada(r)).length;
  const sent = rows.filter((r) => r.aoHubInviteSentAt).length;
  const notEligible = rows.filter((r) => isNotEligibleCanada(r)).length;
  const previewRow = rows.find((r) => r.id === previewId) || rows[0] || null;
  const preview = previewRow
    ? applyCheckInEmailMerge(template, {
        firstName: previewRow.firstName,
        email: previewRow.email,
        aoHubUrl: AO_HUB_URL,
      })
    : applyCheckInEmailMerge(template, { firstName: 'Alex', aoHubUrl: AO_HUB_URL });

  const resetTemplate = () => {
    const d = defaultAoHubEmailTemplate();
    setSubject(d.subject);
    setBody(d.body);
  };

  const sendOne = async (row: CheckInRow) => {
    if (!subject.trim() || !body.trim()) {
      setError('Subject and body are required before sending.');
      return;
    }
    setSendingId(row.id);
    setError(null);
    setActionMsg(null);
    try {
      const result = await sendAoHubInviteForCheckIn(row.id, template);
      setActionMsg(
        `Email sent to ${row.firstName} ${row.lastName} from aopaz@globelife-paz.com.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setSendingId(null);
    }
  };

  const deleteOne = async (row: CheckInRow) => {
    const label = `${row.firstName} ${row.lastName}`.trim() || row.email;
    if (!window.confirm(`Delete check-in for ${label}? This removes it from stats and cannot be undone.`)) {
      return;
    }
    setDeletingId(row.id);
    setError(null);
    setActionMsg(null);
    try {
      await deleteCheckInEntry(row.id);
      setActionMsg(`Deleted ${label}.`);
      if (previewId === row.id) setPreviewId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="hm-shell mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[#d9cfc0] pb-5">
        <div>
          <p className="hm-kicker">Tracking</p>
          <h1 className="font-display text-4xl text-[#1c1915]">Check-ins</h1>
          <p className="mt-2 max-w-xl text-sm text-[#5c554c]">
            Click a name to see the full form. People who are not eligible to work in Canada are flagged and cannot be sent the AO Hub invite.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            void load();
          }}
          className="hm-btn-ghost inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </header>

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="hm-card rounded-2xl px-4 py-4">
          <p className="hm-kicker">Total check-ins</p>
          <p className="mt-2 font-display text-3xl tabular-nums text-[#1c1915]">{rows.length}</p>
        </div>
        <div className="hm-card rounded-2xl px-4 py-4">
          <p className="hm-kicker">Awaiting AO Hub</p>
          <p className="mt-2 font-display text-3xl tabular-nums text-[#1c1915]">{pending}</p>
        </div>
        <div className="hm-card rounded-2xl px-4 py-4">
          <p className="hm-kicker">AO Hub sent</p>
          <p className="mt-2 font-display text-3xl tabular-nums text-[#1c1915]">{sent}</p>
        </div>
        <div className="hm-card rounded-2xl px-4 py-4">
          <p className="hm-kicker">Not eligible (Canada)</p>
          <p className="mt-2 font-display text-3xl tabular-nums text-[#1c1915]">{notEligible}</p>
        </div>
      </div>

      <section className="hm-card space-y-4 rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="hm-kicker">Email template</p>
            <h2 className="font-display text-2xl text-[#1c1915]">Shortlist / AO Hub invite</h2>
          </div>
          <button
            type="button"
            onClick={resetTemplate}
            className="hm-btn-ghost inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs"
          >
            <RotateCcw size={12} /> Reset to default
          </button>
        </div>

        <label className="block text-sm">
          <span className="text-[#6f675c]">Subject</span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="mt-1 w-full rounded-xl border border-[#d9cfc0] bg-white px-3 py-2.5 text-[#1c1915]"
          />
        </label>

        <label className="block text-sm">
          <span className="text-[#6f675c]">Body</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={10}
            className="mt-1 w-full rounded-xl border border-[#d9cfc0] bg-white px-3 py-2.5 font-mono text-sm leading-6 text-[#1c1915]"
          />
        </label>

        <div className="rounded-xl border border-[#eadfce] bg-[#faf6ef] px-4 py-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="hm-kicker">Preview</p>
            {rows.length > 0 && (
              <select
                value={previewRow?.id || ''}
                onChange={(e) => setPreviewId(e.target.value)}
                className="rounded-lg border border-[#d9cfc0] bg-white px-2 py-1 text-xs text-[#1c1915]"
              >
                {rows.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.firstName} {r.lastName} · {r.email}
                  </option>
                ))}
              </select>
            )}
          </div>
          <p className="text-sm font-semibold text-[#1c1915]">{preview.subject}</p>
          <pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-6 text-[#4a453e]">{preview.text}</pre>
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}
      {actionMsg && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {actionMsg}
        </div>
      )}

      <div className="hm-card overflow-hidden rounded-2xl">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-[#1c1915] text-[11px] uppercase tracking-[0.16em] text-[#d4c4a8]">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Phone</th>
                <th className="px-4 py-3 font-medium">Location</th>
                <th className="px-4 py-3 font-medium">Eligible</th>
                <th className="px-4 py-3 font-medium">Checked in</th>
                <th className="px-4 py-3 font-medium">AO Hub</th>
                <th className="px-4 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-[#6f675c]">
                    No check-ins yet. Put your site check-in URL in Instantly instead of the AO Hub link.
                  </td>
                </tr>
              )}
              {rows.map((row) => {
                const already = Boolean(row.aoHubInviteSentAt);
                const notEligible = isNotEligibleCanada(row);
                const open = openId === row.id;
                const province = row.applicantQuestionnaire?.province || '';
                const q = row.applicantQuestionnaire;
                return (
                  <React.Fragment key={row.id}>
                  <tr className={`border-t border-[#eadfce] ${notEligible ? 'bg-red-50/70' : ''}`}>
                    <td className="px-4 py-3 font-medium text-[#1c1915]">
                      <button type="button" onClick={() => setOpenId(open ? null : row.id)} className="text-left">
                        {row.firstName} {row.lastName}
                      </button>
                      {notEligible && (
                        <span className="ml-2 inline-flex rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-800">
                          Not eligible
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[#5c554c]">{row.email}</td>
                    <td className="px-4 py-3 tabular-nums text-[#5c554c]">{row.phone || '—'}</td>
                    <td className="px-4 py-3 text-[#5c554c]">
                      {[row.city, PROVINCE_LABELS[province] || province].filter(Boolean).join(', ') || '—'}
                    </td>
                    <td className="px-4 py-3 text-[#5c554c]">
                      {[
                        q?.legallyEntitledCanada === 'yes'
                          ? 'Work-eligible'
                          : q?.legallyEntitledCanada === 'no'
                            ? 'Not eligible'
                            : null,
                        q?.comfortableVirtualEnvironment === 'yes'
                          ? 'Remote OK'
                          : q?.comfortableVirtualEnvironment === 'no'
                            ? 'Not remote'
                            : null,
                      ]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </td>
                    <td className="px-4 py-3 text-[#5c554c]">
                      {formatWhen(row.adminData?.checkedInAt || row.timestamp)}
                    </td>
                    <td className="px-4 py-3 text-[#5c554c]">
                      {already ? formatWhen(row.aoHubInviteSentAt) : notEligible ? 'Blocked' : 'Not sent'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={already || notEligible || sendingId === row.id || deletingId === row.id}
                          onClick={() => void sendOne(row)}
                          className="hm-btn-brass inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Send size={12} />
                          {already ? 'Sent' : notEligible ? 'Blocked' : sendingId === row.id ? 'Sending…' : 'Send email'}
                        </button>
                        <button
                          type="button"
                          disabled={deletingId === row.id || sendingId === row.id}
                          onClick={() => void deleteOne(row)}
                          className="hm-btn-ghost inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-red-800 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Trash2 size={12} />
                          {deletingId === row.id ? 'Deleting…' : 'Delete'}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {open && (
                    <tr className="border-t border-[#eadfce] bg-[#faf6ef]">
                      <td colSpan={8} className="px-4 py-4">
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm text-[#3f3a34]">
                          <p><span className="hm-kicker">First name</span><br />{row.firstName || '—'}</p>
                          <p><span className="hm-kicker">Last name</span><br />{row.lastName || '—'}</p>
                          <p><span className="hm-kicker">Email</span><br />{row.email || '—'}</p>
                          <p><span className="hm-kicker">Phone</span><br />{row.phone || '—'}</p>
                          <p><span className="hm-kicker">City</span><br />{row.city || '—'}</p>
                          <p><span className="hm-kicker">Province</span><br />{PROVINCE_LABELS[province] || province || '—'}</p>
                          <p><span className="hm-kicker">Legally entitled to work in Canada</span><br />{yesNo(q?.legallyEntitledCanada)}</p>
                          <p><span className="hm-kicker">Comfortable 100% remote</span><br />{yesNo(q?.comfortableVirtualEnvironment)}</p>
                          <p><span className="hm-kicker">Checked in</span><br />{formatWhen(row.adminData?.checkedInAt || row.timestamp)}</p>
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default CheckInsPage;

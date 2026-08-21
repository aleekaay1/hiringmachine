import React from 'react';
import { RefreshCw, Send } from 'lucide-react';
import {
  listCheckInEntries,
  sendAoHubInviteForCheckIn,
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

const CheckInsPage: React.FC = () => {
  const [rows, setRows] = React.useState<CheckInRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [sendingId, setSendingId] = React.useState<string | null>(null);
  const [actionMsg, setActionMsg] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setError(null);
    try {
      setRows(await listCheckInEntries());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load check-ins');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const pending = rows.filter((r) => !r.aoHubInviteSentAt).length;
  const sent = rows.filter((r) => r.aoHubInviteSentAt).length;

  const sendOne = async (row: CheckInRow) => {
    setSendingId(row.id);
    setError(null);
    setActionMsg(null);
    try {
      const result = await sendAoHubInviteForCheckIn(row.id);
      setActionMsg(
        `AO Hub invite sent to ${row.firstName} ${row.lastName} via ${result.channel === 'instantly' ? 'Instantly' : 'email'}.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setSendingId(null);
    }
  };

  return (
    <div className="hm-shell mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[#d9cfc0] pb-5">
        <div>
          <p className="hm-kicker">Tracking</p>
          <h1 className="font-display text-4xl text-[#1c1915]">Check-ins</h1>
          <p className="mt-2 max-w-xl text-sm text-[#5c554c]">
            People who opened your Instantly link and submitted the form. Send the AO Interview Hub invite when you shortlist them.
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

      <div className="grid gap-3 sm:grid-cols-3">
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
      </div>

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
                <th className="px-4 py-3 font-medium">City / role</th>
                <th className="px-4 py-3 font-medium">Checked in</th>
                <th className="px-4 py-3 font-medium">AO Hub</th>
                <th className="px-4 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-[#6f675c]">
                    No check-ins yet. Put your site check-in URL in Instantly instead of the AO Hub link.
                  </td>
                </tr>
              )}
              {rows.map((row) => {
                const already = Boolean(row.aoHubInviteSentAt);
                return (
                  <tr key={row.id} className="border-t border-[#eadfce]">
                    <td className="px-4 py-3 font-medium text-[#1c1915]">
                      {row.firstName} {row.lastName}
                    </td>
                    <td className="px-4 py-3 text-[#5c554c]">{row.email}</td>
                    <td className="px-4 py-3 tabular-nums text-[#5c554c]">{row.phone || '—'}</td>
                    <td className="px-4 py-3 text-[#5c554c]">
                      {[row.city, row.currentRole].filter(Boolean).join(' · ') || '—'}
                    </td>
                    <td className="px-4 py-3 text-[#5c554c]">
                      {formatWhen(row.adminData?.checkedInAt || row.timestamp)}
                    </td>
                    <td className="px-4 py-3 text-[#5c554c]">
                      {already ? formatWhen(row.aoHubInviteSentAt) : 'Not sent'}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        disabled={already || sendingId === row.id}
                        onClick={() => void sendOne(row)}
                        className="hm-btn-brass inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Send size={12} />
                        {already ? 'Sent' : sendingId === row.id ? 'Sending…' : 'Send AO Hub'}
                      </button>
                    </td>
                  </tr>
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

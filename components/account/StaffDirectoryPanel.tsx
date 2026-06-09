import React from 'react';
import { ChevronDown, Users } from 'lucide-react';
import { listAllUserProfiles, type UserProfile } from '../../services/accessControl';

type StaffDirectoryPanelProps = {
  defaultOpen?: boolean;
  canAccess: boolean;
};

const StaffDirectoryPanel: React.FC<StaffDirectoryPanelProps> = ({ defaultOpen = false, canAccess }) => {
  const [expanded, setExpanded] = React.useState(defaultOpen);
  const [loaded, setLoaded] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<UserProfile[]>([]);

  React.useEffect(() => {
    if (!expanded || loaded || !canAccess) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await listAllUserProfiles();
        if (!cancelled) {
          setRows(data);
          setLoaded(true);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [expanded, loaded, canAccess]);

  if (!canAccess) return null;

  return (
    <section className="overflow-hidden rounded-2xl border border-[#d6deea] bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition hover:bg-[#f8fbff]"
      >
        <span className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#eef2f7] text-[#0B1B34]">
            <Users size={18} />
          </span>
          <span>
            <span className="block text-sm font-semibold text-[#0B1B34]">Staff directory</span>
            <span className="block text-xs text-[#6b84a8]">Admin view — loads only when opened</span>
          </span>
        </span>
        <ChevronDown size={18} className={`shrink-0 text-[#6b84a8] transition ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="border-t border-[#e8eef5] px-5 pb-5 pt-4">
          <p className="mb-3 text-xs text-[#6b84a8]">
            Leadership and admin visibility across accounts for roles and Paz Coins.
          </p>
          {error && (
            <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
          )}
          <div className="overflow-hidden rounded-xl border border-[#e8eef5]">
            <div className="grid grid-cols-[1.3fr_1fr_0.8fr_0.6fr] gap-2 border-b border-[#e8eef5] bg-[#f8fbff] px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[#6b84a8]">
              <span>User</span>
              <span>Email</span>
              <span>Role</span>
              <span className="text-right">Points</span>
            </div>
            {loading ? (
              <div className="px-4 py-6 text-sm text-[#6b84a8]">Loading staff…</div>
            ) : rows.length === 0 ? (
              <div className="px-4 py-6 text-sm text-[#6b84a8]">No user profiles found.</div>
            ) : (
              <div className="max-h-[min(420px,50vh)] overflow-y-auto">
                {rows.map((row) => (
                  <div
                    key={row.user_id}
                    className="grid grid-cols-[1.3fr_1fr_0.8fr_0.6fr] gap-2 border-b border-[#f4f7fb] px-4 py-3 text-sm last:border-b-0"
                  >
                    <span className="truncate font-medium text-[#0B1B34]">{row.full_name || '—'}</span>
                    <span className="truncate text-[#4b6d95]">{row.email || '—'}</span>
                    <span className="w-fit rounded-full border border-[#c8ddf4] bg-[#f4f8ff] px-2 py-0.5 text-[11px] capitalize text-[#0B1B34]">
                      {row.role}
                    </span>
                    <span className="text-right tabular-nums text-[#4b6d95]">{Number(row.points || 0)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};

export default StaffDirectoryPanel;

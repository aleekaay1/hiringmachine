import React from 'react';
import { Link } from 'react-router-dom';
import { PhoneCall, RefreshCw, Send } from 'lucide-react';
import { getCurrentUserProfile, type UserProfile } from '../services/accessControl';
import {
  displayName,
  displayPhone,
  loadHmDashboard,
  type HmDashboardData,
  type InstantlyDailyPoint,
} from '../services/hiringMachineService';

function formatWhen(iso: string | null): string {
  if (!iso) return 'Not synced yet';
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

function KpiCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <div className="hm-card rounded-2xl px-4 py-4">
      <p className="hm-kicker">{label}</p>
      <p className="mt-2 font-display text-3xl tabular-nums text-[#1c1915]">{value}</p>
      {hint ? <p className="mt-1 text-xs text-[#6f675c]">{hint}</p> : null}
    </div>
  );
}

function DailyChart({ points }: { points: InstantlyDailyPoint[] }) {
  const last = points.slice(-14);
  const max = Math.max(1, ...last.map((p) => Math.max(p.sent, p.opened, p.replies)));
  const w = 640;
  const h = 160;
  const pad = 8;
  const step = last.length > 1 ? (w - pad * 2) / (last.length - 1) : w;
  const toPath = (key: keyof InstantlyDailyPoint) => {
    if (!last.length) return '';
    return last
      .map((p, i) => {
        const x = pad + i * step;
        const y = h - pad - ((Number(p[key]) || 0) / max) * (h - pad * 2);
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  };
  if (!last.length) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-[#6f675c]">
        Daily Instantly data appears after the first metrics sync.
      </div>
    );
  }
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-40 w-full" role="img" aria-label="Daily Instantly activity">
      <path d={toPath('sent')} fill="none" stroke="#1c1915" strokeWidth="2.2" />
      <path d={toPath('opened')} fill="none" stroke="#b08d57" strokeWidth="2.2" />
      <path d={toPath('replies')} fill="none" stroke="#3f6b4e" strokeWidth="2.2" />
    </svg>
  );
}

const HiringMachineHome: React.FC<{ profile: UserProfile | null }> = ({ profile }) => {
  const [data, setData] = React.useState<HmDashboardData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const next = await loadHmDashboard();
      setData(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const first = String(profile?.full_name || profile?.email || 'there').split(/\s+/)[0];

  return (
    <div className="hm-shell mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[#d9cfc0] pb-5">
        <div>
          <p className="hm-kicker">Hiring machine</p>
          <h1 className="font-display text-4xl text-[#1c1915] sm:text-5xl">Good day, {first}.</h1>
          <p className="mt-2 max-w-xl text-sm text-[#5c554c]">
            Instantly runs outreach. Positive replies land here, Edlyn calls, then we send them to AO Interview Hub.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-xs text-[#6f675c]">Metrics {formatWhen(data?.pulledAt || null)}</p>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              void load();
            }}
            className="hm-btn-ghost inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-medium"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </header>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}

      <section>
        <p className="hm-kicker mb-3">Instantly</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <KpiCard label="Sent" value={data?.instantly.sent ?? '—'} />
          <KpiCard label="Opened" value={data?.instantly.opened ?? '—'} />
          <KpiCard label="Replies" value={data?.instantly.replies ?? '—'} />
          <KpiCard label="Interested" value={data?.instantly.interested ?? '—'} />
          <KpiCard label="Bounced" value={data?.instantly.bounced ?? '—'} />
          <KpiCard label="Unsubs" value={data?.instantly.unsubscribed ?? '—'} />
        </div>
      </section>

      <section>
        <p className="hm-kicker mb-3">Our funnel</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Shortlisted emails" value={data?.funnel.shortlisted ?? '—'} hint="Auto replies sent" />
          <KpiCard label="Call ready" value={data?.funnel.callReady ?? '—'} hint="Phone extracted" />
          <KpiCard label="Called today" value={data?.funnel.calledToday ?? '—'} />
          <KpiCard label="Sent to AO Hub" value={data?.funnel.sentToHub ?? '—'} />
        </div>
      </section>

      <section className="hm-card rounded-2xl p-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="hm-kicker">Last 14 days</p>
            <h2 className="font-display text-2xl text-[#1c1915]">Send · open · reply</h2>
          </div>
          <div className="flex gap-4 text-[11px] uppercase tracking-[0.16em] text-[#6f675c]">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#1c1915]" /> Sent</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#b08d57]" /> Opened</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#3f6b4e]" /> Replies</span>
          </div>
        </div>
        <DailyChart points={data?.daily || []} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="hm-card rounded-2xl p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-2xl text-[#1c1915]">Needs a call</h2>
            <Link to="/pipeline/call" className="hm-btn-brass inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs">
              <PhoneCall size={14} /> Open workspace
            </Link>
          </div>
          <ul className="space-y-3">
            {(data?.needsCall || []).length === 0 && (
              <li className="text-sm text-[#6f675c]">No call-ready people yet. Positive Instantly replies will appear here after AI extracts a phone number.</li>
            )}
            {(data?.needsCall || []).map((person) => (
              <li key={person.id} className="border-t border-[#eadfce] pt-3 first:border-0 first:pt-0">
                <p className="font-medium text-[#1c1915]">{displayName(person)}</p>
                <p className="text-xs tabular-nums text-[#6f675c]">{displayPhone(person)} · {person.email}</p>
                {person.ai_summary ? (
                  <p className="mt-1 line-clamp-2 text-sm text-[#4a453e]">{person.ai_summary}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
        <div className="hm-card rounded-2xl p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-2xl text-[#1c1915]">Sent ahead</h2>
            <Link to="/sent-ahead" className="hm-btn-ghost inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs">
              <Send size={14} /> Full list
            </Link>
          </div>
          <ul className="space-y-3">
            {(data?.sentAhead || []).length === 0 && (
              <li className="text-sm text-[#6f675c]">Nobody has been tagged for AO Interview Hub yet.</li>
            )}
            {(data?.sentAhead || []).map((person) => (
              <li key={person.id} className="border-t border-[#eadfce] pt-3 first:border-0 first:pt-0">
                <p className="font-medium text-[#1c1915]">{displayName(person)}</p>
                <p className="text-xs text-[#6f675c]">{person.email}</p>
                <p className="text-[11px] text-[#8a8174]">{formatWhen(person.sent_to_hub_at)}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
};

const RoleHome: React.FC = () => {
  const [profile, setProfile] = React.useState<UserProfile | null>(null);

  React.useEffect(() => {
    void getCurrentUserProfile().then(setProfile);
  }, []);

  return <HiringMachineHome profile={profile} />;
};

export default RoleHome;

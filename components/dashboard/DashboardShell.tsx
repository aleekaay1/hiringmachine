import React from 'react';
import PipelineAuthShell from '../PipelineAuthShell';
import CoinWalletBadge from './CoinWalletBadge';
import type { AppRole, UserProfile } from '../../services/accessControl';

const ROLE_LABELS: Record<AppRole, string> = {
  admin: 'Administrator',
  leadership: 'Leadership',
  recruiter: 'Recruiter',
  webinar: 'Webinar team',
  hr: 'Human resources',
  viewer: 'Viewer',
};

function LiveClock() {
  const [now, setNow] = React.useState(() => new Date());

  React.useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const time = now.toLocaleTimeString('en-CA', {
    timeZone: 'America/Toronto',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
  const date = now.toLocaleDateString('en-CA', {
    timeZone: 'America/Toronto',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  return (
    <div className="text-right">
      <p className="text-lg font-semibold tabular-nums text-[#0B1B34]" style={{ fontFamily: 'Outfit, Inter, system-ui, sans-serif' }}>
        {time}
      </p>
      <p className="text-[11px] text-[#5c7594]">{date} · Toronto</p>
    </div>
  );
}

function displayFirstName(profile: UserProfile): string {
  const full = String(profile.full_name || '').trim();
  if (full) return full.split(/\s+/)[0];
  const email = String(profile.email || '').split('@')[0] || '';
  if (!email) return 'there';
  return email.charAt(0).toUpperCase() + email.slice(1);
}

type DashboardShellProps = {
  profile: UserProfile | null;
  loading?: boolean;
  children: React.ReactNode;
};

const DashboardShell: React.FC<DashboardShellProps> = ({ profile, loading, children }) => {
  return (
    <PipelineAuthShell
      title="Your dashboard"
      subtitle="Sign in to open your personal workspace"
      redirectPath="/home"
    >
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Outfit:wght@500;600;700;800&display=swap');`}</style>
      <div
        className="relative mx-auto w-full max-w-[1480px] overflow-hidden rounded-[36px] border border-[#d7e4f5] bg-[#f7fbff] p-4 text-[#102344] shadow-[0_34px_95px_-60px_rgba(0,94,184,0.4)] md:p-6"
        style={{ fontFamily: 'Inter, system-ui, sans-serif' }}
      >
        <div className="pointer-events-none absolute -left-24 top-[-7rem] h-96 w-96 rounded-full bg-gradient-to-br from-indigo-500/18 via-sky-400/12 to-transparent blur-3xl" />
        <div className="pointer-events-none absolute -right-28 top-16 h-96 w-96 rounded-full bg-gradient-to-br from-amber-300/25 via-rose-300/10 to-transparent blur-3xl" />

        <div className="relative z-10 space-y-4">
          <div className="rounded-3xl border border-[#d9e5f6] bg-white/80 p-4 backdrop-blur-xl md:p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.26em] text-[#4e79a9]">
                  {profile ? ROLE_LABELS[profile.role] : 'Workspace'}
                </p>
                <h1
                  className="text-2xl font-semibold tracking-tight text-[#0B1B34] md:text-3xl"
                  style={{ fontFamily: 'Outfit, Inter, system-ui, sans-serif' }}
                >
                  Welcome, {profile ? displayFirstName(profile) : '…'}
                </h1>
                <p className="mt-1 max-w-2xl text-xs text-[#4f6886]">
                  {loading ? 'Loading your overview…' : 'Your home base for today’s work, goals, and quick links.'}
                </p>
              </div>
              <div className="flex flex-wrap items-start justify-end gap-3">
                {profile && profile.role !== 'viewer' && profile.role !== 'hr' ? (
                  <CoinWalletBadge profileBalance={profile.points} role={profile.role} />
                ) : null}
                <LiveClock />
              </div>
            </div>
          </div>
          {children}
        </div>
      </div>
    </PipelineAuthShell>
  );
};

export default DashboardShell;

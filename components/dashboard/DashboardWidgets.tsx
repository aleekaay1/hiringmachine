import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import type { RecruiterLeaderboardRow } from '../../services/pipelineLeaderboard';
import { DashboardStickyNotesPanel } from './DashboardStickyNotesPanel';

export function formatLeaderboardRefreshed(iso: string | null): string {
  if (!iso) return 'Refresh the leaderboard for latest team numbers';
  return `Board updated ${new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
}

export function RecruiterStandingsBoard({
  rows,
  title = 'Recruiter standings (saved board)',
}: {
  rows: RecruiterLeaderboardRow[];
  title?: string;
}) {
  if (rows.length === 0) return null;

  return (
    <div className="rounded-3xl border border-[#d9e5f6] bg-white/80 p-4 backdrop-blur-xl">
      <p className="text-sm font-semibold text-[#0B1B34]">{title}</p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[480px] text-left text-xs">
          <thead className="text-[#6d86a3]">
            <tr>
              <th className="pb-2 pr-3 font-medium">#</th>
              <th className="pb-2 pr-3 font-medium">Name</th>
              <th className="pb-2 pr-3 font-medium">Booked</th>
              <th className="pb-2 pr-3 font-medium">Attended</th>
              <th className="pb-2 pr-3 font-medium">Calls</th>
              <th className="pb-2 font-medium">Score</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.recruiterKey} className="border-t border-[#eef4fb] text-[#35567a]">
                <td className="py-2 pr-3 font-semibold text-[#0B1B34]">{row.rank}</td>
                <td className="py-2 pr-3">{row.displayName}</td>
                <td className="py-2 pr-3 tabular-nums">{row.webinarBooked}</td>
                <td className="py-2 pr-3 tabular-nums">{row.webinarShowed}</td>
                <td className="py-2 pr-3 tabular-nums">{row.calls}</td>
                <td className="py-2 tabular-nums">{row.score.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function StatTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-[#dfeaf8] bg-[#f9fcff] px-3 py-3">
      <p className="text-[10px] uppercase tracking-wide text-[#6d86a3]">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-[#0B1B34]" style={{ fontFamily: 'Outfit, Inter, system-ui, sans-serif' }}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[11px] text-[#5c7594]">{sub}</p>}
    </div>
  );
}

export function QuickLinkCard({
  title,
  description,
  to,
  accent = 'border-[#d9e5f6] bg-white hover:bg-[#f7fbff]',
}: {
  title: string;
  description: string;
  to: string;
  accent?: string;
}) {
  return (
    <Link
      to={to}
      className={`group flex flex-col rounded-2xl border p-4 transition ${accent}`}
    >
      <p className="text-sm font-semibold text-[#0B1B34]">{title}</p>
      <p className="mt-1 flex-1 text-xs text-[#5c7594]">{description}</p>
      <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[#2f6ea8]">
        Open <ArrowRight size={14} className="transition group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

export function DayNotesPanel({ userId }: { userId: string }) {
  return <DashboardStickyNotesPanel userId={userId} />;
}

export function GoalRow({
  label,
  current,
  goal,
}: {
  label: string;
  current: number;
  goal: number | null;
}) {
  if (goal == null || goal <= 0) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-[#dfeaf8] bg-white px-3 py-2 text-xs text-[#5c7594]">
        <span>{label}</span>
        <span>Set a goal in Settings</span>
      </div>
    );
  }
  const pct = Math.min(100, Math.round((100 * current) / goal));
  return (
    <div className="rounded-xl border border-[#dfeaf8] bg-white px-3 py-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-[#35567a]">{label}</span>
        <span className="tabular-nums text-[#0B1B34]">
          {current} / {goal}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 rounded-full bg-[#dfeaf8]">
        <div className="h-full rounded-full bg-[#67b5ff]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

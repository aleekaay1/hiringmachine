import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { DashboardStickyNotesPanel } from './DashboardStickyNotesPanel';

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

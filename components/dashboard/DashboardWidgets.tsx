import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, StickyNote } from 'lucide-react';
import { loadUserDashboardDayNote, saveUserDashboardDayNote, todayNoteDateYmd } from '../../services/userDashboardDayNotes';

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
  const [content, setContent] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [savedHint, setSavedHint] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void loadUserDashboardDayNote(userId, todayNoteDateYmd()).then((res) => {
      if (!cancelled) {
        setContent(res.content);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const persist = React.useCallback(
    async (next: string) => {
      setSaving(true);
      setSavedHint(null);
      try {
        await saveUserDashboardDayNote(userId, next, todayNoteDateYmd());
        setSavedHint('Saved');
        window.setTimeout(() => setSavedHint(null), 2000);
      } finally {
        setSaving(false);
      }
    },
    [userId],
  );

  return (
    <div className="rounded-3xl border border-[#f2d9aa] bg-gradient-to-br from-[#fff8ea] via-[#fffaf2] to-white p-4">
      <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[#9b6b00]">
        <StickyNote size={14} aria-hidden />
        Today&apos;s notes
      </p>
      <p className="mt-1 text-[11px] text-[#6d5a39]">Reminders for this shift — saved automatically.</p>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onBlur={() => void persist(content)}
        disabled={loading}
        rows={5}
        placeholder="Callbacks to make, priorities, follow-ups…"
        className="mt-3 w-full resize-y rounded-xl border border-[#f0ce8f] bg-white/90 px-3 py-2 text-sm text-[#0B1B34] placeholder:text-[#b8a06a] focus:border-[#d4a84a] focus:outline-none focus:ring-2 focus:ring-[#ffe9b8]"
      />
      <p className="mt-1 text-[10px] text-[#8a7340]">
        {saving ? 'Saving…' : savedHint || 'Edits save when you click away'}
      </p>
    </div>
  );
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

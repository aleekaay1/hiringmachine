import React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export function ReportExpandableSection({
  title,
  subtitle,
  count,
  open,
  onToggle,
  children,
}: {
  title: string;
  subtitle?: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-[#d9e5f6] bg-white/90 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[#f7fbff] transition"
      >
        <div className="flex min-w-0 items-center gap-2">
          {open ? (
            <ChevronDown size={18} className="shrink-0 text-[#2f6ea8]" aria-hidden />
          ) : (
            <ChevronRight size={18} className="shrink-0 text-[#2f6ea8]" aria-hidden />
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#0B1B34]">{title}</p>
            {subtitle && <p className="text-[11px] text-[#5c7594]">{subtitle}</p>}
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-[#dff0ff] px-3 py-1 text-sm font-bold tabular-nums text-[#0B1B34]">
          {count}
        </span>
      </button>
      {open && <div className="border-t border-[#eef4fb]">{children}</div>}
    </div>
  );
}

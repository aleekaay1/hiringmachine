import React from 'react';
import { Lightbulb, X } from 'lucide-react';
import { PAGE_GUIDES } from '../../content/portalTourContent';
import type { AppSection } from '../../services/accessControl';

const SECTION_GUIDE_MAP: Partial<Record<AppSection, keyof typeof PAGE_GUIDES>> = {
  home: 'home',
  'pipeline-call': 'pipeline-call',
  'pipeline-email': 'pipeline-email',
  'pipeline-performance': 'pipeline-performance',
  'calls-analytics': 'calls-analytics',
  'email-log': 'email-log',
  account: 'account',
  support: 'support',
};

type PageHintBulbProps = {
  section: AppSection;
};

const PageHintBulb: React.FC<PageHintBulbProps> = ({ section }) => {
  const [open, setOpen] = React.useState(false);
  const guideId = SECTION_GUIDE_MAP[section];
  const guide = guideId ? PAGE_GUIDES[guideId] : null;

  React.useEffect(() => {
    setOpen(false);
  }, [section]);

  if (!guide) return null;

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[120] flex flex-col items-end gap-3 sm:bottom-6 sm:right-6">
      {open && (
        <div
          className="pointer-events-auto w-[min(340px,calc(100vw-2.5rem))] rounded-2xl border border-amber-200/80 bg-white p-4 shadow-[0_18px_50px_-24px_rgba(15,23,42,0.45)]"
          role="dialog"
          aria-label={`Hints for ${guide.title}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-700">Page hints</p>
              <h3 className="mt-0.5 text-sm font-semibold text-[#0B1B34]">{guide.title}</h3>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[#6b84a8] hover:bg-slate-100"
              aria-label="Close hints"
            >
              <X size={14} />
            </button>
          </div>
          <p className="mt-2 text-sm text-[#4b6d95]">{guide.summary}</p>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-[#365274]">
            {guide.steps.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`pointer-events-auto inline-flex h-12 w-12 items-center justify-center rounded-full border shadow-lg transition-all duration-200 ${
          open
            ? 'border-amber-300 bg-amber-300 text-amber-950 shadow-amber-300/40 ring-4 ring-amber-200/70'
            : 'border-[#d6deea] bg-white text-[#6b84a8] hover:border-amber-200 hover:bg-amber-50 hover:text-amber-700'
        }`}
        aria-label={open ? 'Hide page hints' : 'Show page hints'}
        aria-expanded={open}
        title="Page hints"
      >
        <Lightbulb size={22} strokeWidth={open ? 2.25 : 1.75} className={open ? 'fill-amber-100' : ''} />
      </button>
    </div>
  );
};

export default PageHintBulb;

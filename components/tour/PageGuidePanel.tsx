import React from 'react';
import { BookOpen, ChevronDown } from 'lucide-react';
import { PAGE_GUIDES } from '../../content/portalTourContent';

type PageGuidePanelProps = {
  guideId: keyof typeof PAGE_GUIDES;
};

const PageGuidePanel: React.FC<PageGuidePanelProps> = ({ guideId }) => {
  const [open, setOpen] = React.useState(false);
  const guide = PAGE_GUIDES[guideId];
  if (!guide) return null;

  return (
    <section className="rounded-2xl border border-[#d6deea] bg-[#f8fbff]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-[#0B1B34]">
          <BookOpen size={16} className="text-[#005EB8]" />
          How to use this page
        </span>
        <ChevronDown size={16} className={`text-[#6b84a8] transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-[#e8eef5] px-4 pb-4 pt-3">
          <p className="text-sm text-[#4b6d95]">{guide.summary}</p>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-[#365274]">
            {guide.steps.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
};

export default PageGuidePanel;

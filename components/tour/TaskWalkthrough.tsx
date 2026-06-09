import React from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { TASK_WALKTHROUGHS, type TaskWalkthrough } from '../../content/taskWalkthroughs';
import { START_TASK_WALKTHROUGH_EVENT } from '../../services/portalTourService';

type Rect = { top: number; left: number; width: number; height: number };

function measureTarget(selector: string): Rect | null {
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const pad = 8;
  return {
    top: Math.max(0, r.top - pad),
    left: Math.max(0, r.left - pad),
    width: r.width + pad * 2,
    height: r.height + pad * 2,
  };
}

function routesMatch(currentPath: string, currentSearch: string, route: string): boolean {
  const [path, search = ''] = route.split('?');
  if (currentPath !== path) return false;
  if (!search) return true;
  return currentSearch === `?${search}` || currentSearch.includes(search);
}

async function waitForTarget(selector: string | undefined, maxMs: number): Promise<Rect | null> {
  if (!selector) return null;
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const rect = measureTarget(selector);
    if (rect) return rect;
    await new Promise((resolve) => window.setTimeout(resolve, 120));
  }
  return null;
}

async function prepareStep(
  step: TaskWalkthrough['steps'][number],
  navigate: (route: string) => void,
  pathname: string,
  search: string,
): Promise<void> {
  if (step.route && !routesMatch(pathname, search, step.route)) {
    navigate(step.route);
    await new Promise((resolve) => window.setTimeout(resolve, 200));
  }
  const waitMs = step.optionalTarget ? 1800 : 4500;
  if (step.target) await waitForTarget(step.target, waitMs);
  if (step.route?.includes('#')) {
    const hash = step.route.split('#')[1];
    if (hash) {
      window.requestAnimationFrame(() => {
        document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      await new Promise((resolve) => window.setTimeout(resolve, 350));
    }
  }
};

const TaskWalkthrough: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [activeTour, setActiveTour] = React.useState<TaskWalkthrough | null>(null);
  const [open, setOpen] = React.useState(false);
  const [stepIndex, setStepIndex] = React.useState(0);
  const [preparing, setPreparing] = React.useState(false);
  const [spotlight, setSpotlight] = React.useState<Rect | null>(null);
  const [cardPos, setCardPos] = React.useState<{ top: number; left: number }>({ top: 80, left: 24 });

  const steps = activeTour?.steps ?? [];
  const step = steps[stepIndex];
  const isLast = stepIndex >= steps.length - 1;

  const layoutStep = React.useCallback(() => {
    if (!step) return;
    const rect = step.target ? measureTarget(step.target) : null;
    setSpotlight(rect);
    if (rect) {
      const cardWidth = Math.min(380, window.innerWidth - 32);
      let left = rect.left + rect.width + 16;
      let top = rect.top;
      if (left + cardWidth > window.innerWidth - 16) {
        left = Math.max(16, rect.left);
        top = rect.top + rect.height + 12;
      }
      if (top > window.innerHeight - 240) top = Math.max(16, window.innerHeight - 260);
      setCardPos({ top, left: Math.min(left, window.innerWidth - cardWidth - 16) });
    } else {
      setCardPos({ top: window.innerHeight / 2 - 110, left: window.innerWidth / 2 - 190 });
    }
  }, [step]);

  const closeTour = React.useCallback(() => {
    setOpen(false);
    setActiveTour(null);
    setStepIndex(0);
    setPreparing(false);
    setSpotlight(null);
  }, []);

  const runStep = React.useCallback(
    async (index: number, tour: TaskWalkthrough) => {
      const next = tour.steps[index];
      if (!next) return;
      setPreparing(true);
      try {
        await prepareStep(next, navigate, location.pathname, location.search);
        setStepIndex(index);
      } finally {
        setPreparing(false);
      }
    },
    [navigate, location.pathname, location.search],
  );

  const startTour = React.useCallback(
    async (tour: TaskWalkthrough) => {
      setActiveTour(tour);
      setOpen(true);
      setStepIndex(0);
      await runStep(0, tour);
    },
    [runStep],
  );

  React.useEffect(() => {
    const onStart = (event: Event) => {
      const id = (event as CustomEvent<{ id: string }>).detail?.id;
      if (!id || id === 'portal-welcome') return;
      const tour = TASK_WALKTHROUGHS[id];
      if (tour) void startTour(tour);
    };
    window.addEventListener(START_TASK_WALKTHROUGH_EVENT, onStart);
    return () => window.removeEventListener(START_TASK_WALKTHROUGH_EVENT, onStart);
  }, [startTour]);

  React.useEffect(() => {
    if (!open || preparing) return;
    layoutStep();
    const onResize = () => layoutStep();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    const timer = window.setTimeout(layoutStep, 150);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
      window.clearTimeout(timer);
    };
  }, [open, preparing, stepIndex, layoutStep, location.pathname, location.search]);

  if (!open || !step || !activeTour || typeof document === 'undefined') return null;

  const card = (
    <div
      className="fixed z-[300] w-[min(380px,calc(100vw-2rem))] rounded-2xl border border-[#c8ddf4] bg-white p-5 shadow-2xl"
      style={{ top: cardPos.top, left: cardPos.left }}
      role="dialog"
      aria-labelledby="task-walkthrough-title"
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#6b84a8]">
        {activeTour.title} · Step {stepIndex + 1} of {steps.length}
      </p>
      <h2 id="task-walkthrough-title" className="mt-1 text-lg font-semibold text-[#0B1B34]">
        {step.title}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-[#4b6d95]">{step.body}</p>
      {preparing && <p className="mt-2 text-xs text-[#6b84a8]">Opening the right page…</p>}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={closeTour}
          className="text-sm font-medium text-[#6b84a8] hover:text-[#0B1B34]"
        >
          Exit guide
        </button>
        <div className="flex gap-2">
          {stepIndex > 0 && (
            <button
              type="button"
              disabled={preparing}
              onClick={() => void runStep(stepIndex - 1, activeTour)}
              className="rounded-xl border border-[#c8ddf4] px-4 py-2 text-sm font-semibold text-[#0B1B34] hover:bg-[#f4f8ff] disabled:opacity-50"
            >
              Back
            </button>
          )}
          <button
            type="button"
            disabled={preparing}
            onClick={() => {
              if (isLast) closeTour();
              else void runStep(stepIndex + 1, activeTour);
            }}
            className="rounded-xl bg-[#005EB8] px-4 py-2 text-sm font-semibold text-white hover:bg-[#004a94] disabled:opacity-50"
          >
            {isLast ? 'Finish' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 z-[290] pointer-events-auto">
      <div className="absolute inset-0 bg-[#0B1B34]/55 transition-opacity" />
      {spotlight && (
        <div
          className="absolute rounded-xl ring-2 ring-white/90 shadow-[0_0_0_9999px_rgba(11,27,52,0.55)] transition-all duration-300"
          style={{
            top: spotlight.top,
            left: spotlight.left,
            width: spotlight.width,
            height: spotlight.height,
          }}
        />
      )}
      {card}
    </div>,
    document.body,
  );
};

export default TaskWalkthrough;

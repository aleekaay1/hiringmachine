import React from 'react';
import { createPortal } from 'react-dom';
import { PORTAL_TOUR_STEPS } from '../../content/portalTourContent';
import {
  START_TOUR_EVENT,
  markTourCompleted,
  shouldAutoStartTour,
} from '../../services/portalTourService';
import { measureTourTarget, prepareTourTarget, type TourRect } from './tourTargetUtils';

type PortalTourProps = {
  userId: string | null;
  enabled: boolean;
};

const PortalTour: React.FC<PortalTourProps> = ({ userId, enabled }) => {
  const [open, setOpen] = React.useState(false);
  const [stepIndex, setStepIndex] = React.useState(0);
  const [preparing, setPreparing] = React.useState(false);
  const [spotlight, setSpotlight] = React.useState<TourRect | null>(null);
  const [cardPos, setCardPos] = React.useState<{ top: number; left: number }>({ top: 80, left: 24 });

  const step = PORTAL_TOUR_STEPS[stepIndex];
  const isLast = stepIndex >= PORTAL_TOUR_STEPS.length - 1;

  const closeTour = React.useCallback(
    (completed: boolean) => {
      setOpen(false);
      setStepIndex(0);
      setPreparing(false);
      if (userId && completed) markTourCompleted(userId);
    },
    [userId],
  );

  const layoutFromRect = React.useCallback((rect: TourRect | null) => {
    setSpotlight(rect);
    if (rect) {
      const cardWidth = Math.min(360, window.innerWidth - 32);
      let left = rect.left + rect.width + 16;
      let top = rect.top;
      if (left + cardWidth > window.innerWidth - 16) {
        left = Math.max(16, rect.left);
        top = rect.top + rect.height + 12;
      }
      if (top > window.innerHeight - 220) top = Math.max(16, window.innerHeight - 240);
      setCardPos({ top, left: Math.min(left, window.innerWidth - cardWidth - 16) });
    } else {
      setCardPos({ top: window.innerHeight / 2 - 100, left: window.innerWidth / 2 - 180 });
    }
  }, []);

  const layoutStep = React.useCallback(async () => {
    if (!step) return;
    setPreparing(true);
    try {
      const rect = step.target ? await prepareTourTarget(step.target) : null;
      layoutFromRect(rect ?? (step.target ? measureTourTarget(step.target) : null));
    } finally {
      setPreparing(false);
    }
  }, [step, layoutFromRect]);

  React.useEffect(() => {
    if (!enabled || !userId) return;
    if (shouldAutoStartTour(userId)) {
      const timer = window.setTimeout(() => {
        setOpen(true);
        setStepIndex(0);
      }, 900);
      return () => window.clearTimeout(timer);
    }
  }, [enabled, userId]);

  React.useEffect(() => {
    const onStart = () => {
      setStepIndex(0);
      setOpen(true);
    };
    window.addEventListener(START_TOUR_EVENT, onStart);
    return () => window.removeEventListener(START_TOUR_EVENT, onStart);
  }, []);

  React.useEffect(() => {
    if (!open || !step) return;
    void layoutStep();
    const onReflow = () => {
      layoutFromRect(step.target ? measureTourTarget(step.target) : null);
    };
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);
    const timer = window.setTimeout(onReflow, 150);
    return () => {
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
      window.clearTimeout(timer);
    };
  }, [open, stepIndex, step, layoutStep, layoutFromRect]);

  if (!open || !step || typeof document === 'undefined') return null;

  const card = (
    <div
      className="fixed z-[300] w-[min(360px,calc(100vw-2rem))] rounded-2xl border border-[#c8ddf4] bg-white p-5 shadow-2xl"
      style={{ top: cardPos.top, left: cardPos.left }}
      role="dialog"
      aria-labelledby="portal-tour-title"
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#6b84a8]">
        Step {stepIndex + 1} of {PORTAL_TOUR_STEPS.length}
      </p>
      <h2 id="portal-tour-title" className="mt-1 text-lg font-semibold text-[#0B1B34]">
        {step.title}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-[#4b6d95]">{step.body}</p>
      {preparing && <p className="mt-2 text-xs text-[#6b84a8]">Scrolling to this step…</p>}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => closeTour(true)}
          className="text-sm font-medium text-[#6b84a8] hover:text-[#0B1B34]"
        >
          Skip tour
        </button>
        <div className="flex gap-2">
          {stepIndex > 0 && (
            <button
              type="button"
              disabled={preparing}
              onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
              className="rounded-xl border border-[#c8ddf4] px-4 py-2 text-sm font-semibold text-[#0B1B34] hover:bg-[#f4f8ff] disabled:opacity-50"
            >
              Back
            </button>
          )}
          <button
            type="button"
            disabled={preparing}
            onClick={() => {
              if (isLast) closeTour(true);
              else setStepIndex((i) => i + 1);
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
    <div className="fixed inset-0 z-[290] pointer-events-auto" aria-hidden={false}>
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

export default PortalTour;

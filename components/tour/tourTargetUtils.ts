export type TourRect = { top: number; left: number; width: number; height: number };

const SPOTLIGHT_PAD = 8;
const VIEW_MARGIN = 72;

export function queryTourTarget(selector: string): HTMLElement | null {
  const el = document.querySelector(selector);
  return el instanceof HTMLElement ? el : null;
}

export function measureTourTarget(selector: string): TourRect | null {
  const el = queryTourTarget(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    top: Math.max(0, r.top - SPOTLIGHT_PAD),
    left: Math.max(0, r.left - SPOTLIGHT_PAD),
    width: r.width + SPOTLIGHT_PAD * 2,
    height: r.height + SPOTLIGHT_PAD * 2,
  };
}

function targetNeedsScroll(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return (
    r.top < VIEW_MARGIN ||
    r.bottom > window.innerHeight - VIEW_MARGIN ||
    r.left < VIEW_MARGIN ||
    r.right > window.innerWidth - VIEW_MARGIN
  );
}

function waitForScrollSettle(getTop: () => number, maxMs = 700): Promise<void> {
  return new Promise((resolve) => {
    let frames = 0;
    let lastTop = getTop();
    let settledFrames = 0;

    const finish = () => resolve();

    const timer = window.setTimeout(finish, maxMs);

    const tick = () => {
      frames += 1;
      const top = getTop();
      if (Math.abs(top - lastTop) < 0.75) settledFrames += 1;
      else settledFrames = 0;
      lastTop = top;

      if (settledFrames >= 4 || frames > 45) {
        window.clearTimeout(timer);
        finish();
        return;
      }
      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  });
}

export async function scrollTourTargetIntoView(selector: string): Promise<HTMLElement | null> {
  const el = queryTourTarget(selector);
  if (!el) return null;

  if (targetNeedsScroll(el)) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    await waitForScrollSettle(() => el.getBoundingClientRect().top);
  }

  return el;
}

export async function waitForTourTarget(selector: string | undefined, maxMs: number): Promise<TourRect | null> {
  if (!selector) return null;
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const el = queryTourTarget(selector);
    if (el) {
      await scrollTourTargetIntoView(selector);
      return measureTourTarget(selector);
    }
    await new Promise((resolve) => window.setTimeout(resolve, 120));
  }
  return null;
}

export async function prepareTourTarget(selector: string | undefined): Promise<TourRect | null> {
  if (!selector) return null;
  const el = queryTourTarget(selector);
  if (!el) return null;
  await scrollTourTargetIntoView(selector);
  return measureTourTarget(selector);
}

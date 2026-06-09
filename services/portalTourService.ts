const TOUR_VERSION = 'v1';
const STORAGE_PREFIX = 'pohiring_portal_tour_';

export function tourStorageKey(userId: string): string {
  return `${STORAGE_PREFIX}${TOUR_VERSION}_${userId}`;
}

export function isTourCompleted(userId: string | null | undefined): boolean {
  if (!userId || typeof window === 'undefined') return true;
  return window.localStorage.getItem(tourStorageKey(userId)) === 'done';
}

export function markTourCompleted(userId: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(tourStorageKey(userId), 'done');
}

export function clearTourCompleted(userId: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(tourStorageKey(userId));
}

export function shouldAutoStartTour(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return !isTourCompleted(userId);
}

export const START_TOUR_EVENT = 'pohiring:start-tour';
export const START_TASK_WALKTHROUGH_EVENT = 'pohiring:start-task-walkthrough';

export function requestPortalTour(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(START_TOUR_EVENT));
}

export function requestTaskWalkthrough(guideId: string): void {
  if (typeof window === 'undefined') return;
  if (guideId === 'portal-welcome') {
    requestPortalTour();
    return;
  }
  window.dispatchEvent(new CustomEvent(START_TASK_WALKTHROUGH_EVENT, { detail: { id: guideId } }));
}

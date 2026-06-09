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

export function requestPortalTour(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(START_TOUR_EVENT));
}

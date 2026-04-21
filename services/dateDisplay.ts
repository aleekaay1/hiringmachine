/** Canada Eastern (Toronto) — used for all user-visible dates/times in the app. */
export const DISPLAY_TIME_ZONE_CANADA_EASTERN = 'America/Toronto';
export const DISPLAY_LOCALE = 'en-CA';

const DEFAULT_DATE_TIME: Intl.DateTimeFormatOptions = {
  timeZone: DISPLAY_TIME_ZONE_CANADA_EASTERN,
  dateStyle: 'medium',
  timeStyle: 'short',
};

const DEFAULT_DATE_ONLY: Intl.DateTimeFormatOptions = {
  timeZone: DISPLAY_TIME_ZONE_CANADA_EASTERN,
  dateStyle: 'medium',
};

function toValidDate(input: string | number | Date): Date | null {
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDateTimeCanadaEastern(
  input: string | number | Date | null | undefined,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (input == null || input === '') return '—';
  const d = toValidDate(input instanceof Date ? input : new Date(input));
  if (!d) return '—';
  return d.toLocaleString(DISPLAY_LOCALE, { ...DEFAULT_DATE_TIME, ...options });
}

export function formatDateCanadaEastern(
  input: string | number | Date | null | undefined,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (input == null || input === '') return '—';
  const d = toValidDate(input instanceof Date ? input : new Date(input));
  if (!d) return '—';
  return d.toLocaleDateString(DISPLAY_LOCALE, { ...DEFAULT_DATE_ONLY, ...options });
}

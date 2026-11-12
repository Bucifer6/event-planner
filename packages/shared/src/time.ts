// INF8: all timestamps are stored in UTC; display happens in Europe/Bucharest (L3).
export const BUCHAREST_TZ = 'Europe/Bucharest';

export function now(): Date {
  return new Date();
}

export function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60_000);
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function addMonthsUtc(d: Date, months: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate()));
}

const roMonths = [
  'ianuarie',
  'februarie',
  'martie',
  'aprilie',
  'mai',
  'iunie',
  'iulie',
  'august',
  'septembrie',
  'octombrie',
  'noiembrie',
  'decembrie',
];
const roWeekdays = ['duminică', 'luni', 'marți', 'miercuri', 'joi', 'vineri', 'sâmbătă'];
const enMonths = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const enWeekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export type Locale = 'ro' | 'en';

function partsInBucharest(d: Date) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUCHAREST_TZ,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    weekday: 'short',
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) out[p.type] = p.value;
  return out;
}

// L3: dd.mm.yyyy, 24-hour time, Romanian month/weekday names; English conventions on toggle.
export function formatDate(d: Date | string, locale: Locale = 'ro'): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  const p = partsInBucharest(date);
  const dd = String(Number(p.day)).padStart(2, '0');
  const mm = String(Number(p.month)).padStart(2, '0');
  if (locale === 'ro') return `${dd}.${mm}.${p.year}`;
  return `${dd}/${mm}/${p.year}`;
}

export function formatDateTime(d: Date | string, locale: Locale = 'ro'): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  const p = partsInBucharest(date);
  const dd = String(Number(p.day)).padStart(2, '0');
  const mm = String(Number(p.month)).padStart(2, '0');
  const hh = String(Number(p.hour) % 24).padStart(2, '0');
  const min = String(Number(p.minute)).padStart(2, '0');
  const dateStr = locale === 'ro' ? `${dd}.${mm}.${p.year}` : `${dd}/${mm}/${p.year}`;
  return `${dateStr}, ${hh}:${min}`;
}

export function formatDayMonth(d: Date | string, locale: Locale = 'ro'): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  const p = partsInBucharest(date);
  const months = locale === 'ro' ? roMonths : enMonths;
  return `${Number(p.day)} ${months[Number(p.month) - 1]}`;
}

export function formatWeekday(d: Date | string, locale: Locale = 'ro'): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  const p = partsInBucharest(date);
  const weekdays = locale === 'ro' ? roWeekdays : enWeekdays;
  const jsDay = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day))).getUTCDay();
  return weekdays[jsDay] ?? '';
}

// L3: amounts in RON with "RON" suffix, thousands separator (1.990 RON). Input is bani (int).
export function formatRon(bani: number, locale: Locale = 'ro'): string {
  const lei = Math.floor(bani / 100);
  const frac = Math.abs(bani % 100);
  const grouped = new Intl.NumberFormat(locale === 'ro' ? 'ro-RO' : 'en-GB').format(lei);
  const withFrac = frac === 0 ? grouped : `${grouped},${String(frac).padStart(2, '0')}`;
  return locale === 'ro' ? `${withFrac} RON` : `${withFrac} RON`;
}

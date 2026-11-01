const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function parseLabel(label: string): [number, number] {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(label);
  if (!m) throw new Error(`bad cycle label ${label}`);
  return [Number(m[1]), Number(m[2])];
}

export function shiftLabel(label: string, n: number): string {
  const [y, m] = parseLabel(label);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

export function displayLabel(label: string): string {
  const [y, m] = parseLabel(label);
  return `${MONTHS[m - 1]} ${y}`;
}

const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function monthName(label: string): string {
  return MONTHS_FULL[parseLabel(label)[1] - 1];
}

/** Local calendar date as YYYY-MM-DD (never via toISOString, which is UTC). */
export function isoDay(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatDay(day: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', opts);
}

export function relativeDay(day: string, today = isoDay()): string {
  if (day === today) return 'Today';
  const [y, m, d] = today.split('-').map(Number);
  const yesterday = isoDay(new Date(y, m - 1, d - 1));
  if (day === yesterday) return 'Yesterday';
  return formatDay(day, { weekday: 'short', day: 'numeric', month: 'short' });
}

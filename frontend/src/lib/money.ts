/** Money helpers. Amounts are always integer cents (LKR x 100). */

export const MAX_CENTS = 1_000_000_000; // Rs 10,000,000.00
const MINUS = '−';

const grouped = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const groupedWhole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** Rs 30,000.00 (or Rs 30,000 with `whole`). Negative values use a true minus sign. */
export function formatRs(cents: number, opts: { whole?: boolean; signed?: boolean } = {}): string {
  const negative = cents < 0;
  const abs = Math.abs(cents) / 100;
  const body = opts.whole ? groupedWhole.format(Math.round(abs)) : grouped.format(abs);
  const sign = negative ? MINUS : opts.signed && cents > 0 ? '+' : '';
  return `Rs ${sign}${body}`;
}

/** Compact form for charts: Rs 30K, Rs 1.2M, Rs 950. */
export function formatCompact(cents: number): string {
  const negative = cents < 0;
  const rupees = Math.abs(cents) / 100;
  let body: string;
  if (rupees >= 1_000_000) body = `${trim(rupees / 1_000_000)}M`;
  else if (rupees >= 1_000) body = `${trim(rupees / 1_000)}K`;
  else body = `${Math.round(rupees)}`;
  return `Rs ${negative ? MINUS : ''}${body}`;
}

function trim(n: number): string {
  return n >= 100 ? Math.round(n).toString() : n.toFixed(1).replace(/\.0$/, '');
}

/** Parse a user-typed amount ("2,350.5") into cents. Returns null when invalid. */
export function parseToCents(input: string): number | null {
  const clean = input.replace(/[,\s]/g, '').replace(/^Rs\.?/i, '');
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return null;
  const [whole, frac = ''] = clean.split('.');
  const cents = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Format keypad text with thousands separators while typing ("12345.5" -> "12,345.5"). */
export function formatTyping(raw: string): string {
  if (!raw) return '0';
  const [whole, frac] = raw.split('.');
  const w = groupedWhole.format(Number(whole || '0'));
  return frac !== undefined ? `${w}.${frac}` : w;
}

/** Apply one keypad key to the raw amount string. */
export function applyKey(raw: string, key: string): string {
  if (key === 'back') return raw.slice(0, -1);
  if (key === 'clear') return '';
  if (key === '.') {
    if (raw.includes('.')) return raw;
    return (raw || '0') + '.';
  }
  if (!/^\d$/.test(key)) return raw;
  if (raw.includes('.') && raw.split('.')[1].length >= 2) return raw;
  const next = raw === '0' ? key : raw + key;
  const cents = parseToCents(next);
  if (cents === null || cents > MAX_CENTS) return raw;
  return next;
}

export function centsToRaw(cents: number): string {
  if (!cents) return '';
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  return frac ? `${whole}.${String(frac).padStart(2, '0').replace(/0$/, '')}` : String(whole);
}

export function formatPct(p: number | null | undefined, digits = 0): string {
  if (p === null || p === undefined || Number.isNaN(p)) return '–';
  return `${Math.abs(p).toFixed(digits)}%`;
}

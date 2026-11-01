import { applyKey, centsToRaw, formatCompact, formatRs, formatTyping, parseToCents } from './money';

describe('formatRs', () => {
  it('formats cents as rupees with separators', () => {
    expect(formatRs(3_000_000)).toBe('Rs 30,000.00');
    expect(formatRs(235_050)).toBe('Rs 2,350.50');
    expect(formatRs(5)).toBe('Rs 0.05');
  });
  it('uses a real minus sign and optional plus', () => {
    expect(formatRs(-120_000)).toBe('Rs −1,200.00');
    expect(formatRs(310_000, { whole: true, signed: true })).toBe('Rs +3,100');
  });
});

describe('formatCompact', () => {
  it('abbreviates for charts', () => {
    expect(formatCompact(3_000_000)).toBe('Rs 30K');
    expect(formatCompact(4_390_000)).toBe('Rs 43.9K');
    expect(formatCompact(120_000_000)).toBe('Rs 1.2M');
    expect(formatCompact(95_000)).toBe('Rs 950');
    expect(formatCompact(-250_000)).toBe('Rs −2.5K');
  });
});

describe('parseToCents', () => {
  it('parses typed amounts without floating point error', () => {
    expect(parseToCents('2,350.5')).toBe(235_050);
    expect(parseToCents('0.1')).toBe(10);
    expect(parseToCents('19.99')).toBe(1999);
    expect(parseToCents('1000')).toBe(100_000);
  });
  it('rejects junk', () => {
    expect(parseToCents('')).toBeNull();
    expect(parseToCents('1.234')).toBeNull();
    expect(parseToCents('abc')).toBeNull();
    expect(parseToCents('-5')).toBeNull();
  });
});

describe('keypad', () => {
  const type = (keys: string[]) => keys.reduce((raw, k) => applyKey(raw, k), '');
  it('builds an amount key by key', () => {
    expect(type(['2', '3', '5', '0', '.', '5'])).toBe('2350.5');
    expect(formatTyping('12345.5')).toBe('12,345.5');
  });
  it('limits to two decimals and one point', () => {
    expect(type(['1', '.', '2', '3', '4'])).toBe('1.23');
    expect(type(['1', '.', '.', '5'])).toBe('1.5');
    expect(type(['.', '5'])).toBe('0.5');
  });
  it('ignores leading zeros and respects the Rs 10M ceiling', () => {
    expect(type(['0', '0', '7'])).toBe('7');
    expect(type(['1', '0', '0', '0', '0', '0', '0', '0', '1'])).toBe('10000000');
  });
  it('backspace', () => {
    expect(applyKey('123', 'back')).toBe('12');
    expect(applyKey('', 'back')).toBe('');
  });
  it('round-trips cents to keypad text', () => {
    expect(centsToRaw(235_050)).toBe('2350.5');
    expect(centsToRaw(235_005)).toBe('2350.05');
    expect(centsToRaw(200_000)).toBe('2000');
    expect(parseToCents(centsToRaw(123_456))).toBe(123_456);
  });
});

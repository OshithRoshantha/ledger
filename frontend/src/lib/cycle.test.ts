import { displayLabel, isoDay, relativeDay, shiftLabel } from './cycle';

describe('cycle utils', () => {
  it('shifts across year boundaries', () => {
    expect(shiftLabel('2026-01', -1)).toBe('2025-12');
    expect(shiftLabel('2026-12', 1)).toBe('2027-01');
    expect(shiftLabel('2026-11', -6)).toBe('2026-05');
  });
  it('displays labels', () => {
    expect(displayLabel('2026-11')).toBe('Nov 2026');
  });
  it('formats local days without UTC drift', () => {
    expect(isoDay(new Date(2026, 10, 1, 23, 59))).toBe('2026-11-01');
  });
  it('relative days', () => {
    expect(relativeDay('2026-11-01', '2026-11-01')).toBe('Today');
    expect(relativeDay('2026-10-31', '2026-11-01')).toBe('Yesterday');
  });
  it('rejects bad labels', () => {
    expect(() => shiftLabel('2026-13', 1)).toThrow();
  });
});

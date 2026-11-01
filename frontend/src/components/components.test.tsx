import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { OtpInput } from '@/features/auth/OtpInput';
import { AmountDisplay, Keypad } from './keypad/Keypad';
import { ChangeBadge } from './ui/primitives';

function KeypadHarness() {
  const [raw, setRaw] = useState('');
  return (
    <>
      <AmountDisplay value={raw} />
      <Keypad value={raw} onChange={setRaw} />
    </>
  );
}

describe('Keypad', () => {
  it('types an amount with separators', async () => {
    const user = userEvent.setup();
    render(<KeypadHarness />);
    for (const k of ['2', '3', '5', '0']) await user.click(screen.getByRole('button', { name: k }));
    await user.click(screen.getByRole('button', { name: 'Decimal point' }));
    await user.click(screen.getByRole('button', { name: '5' }));
    expect(screen.getByLabelText('Amount: Rs 2,350.5')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete digit' }));
    expect(screen.getByLabelText('Amount: Rs 2,350.')).toBeInTheDocument();
  });
  it('has 44pt+ touch targets', () => {
    render(<KeypadHarness />);
    for (const b of screen.getAllByRole('button')) expect(b.className).toMatch(/h-(12|\[54px\])/);
  });
});

function OtpHarness({ onComplete }: { onComplete: (v: string) => void }) {
  const [v, setV] = useState('');
  return <OtpInput value={v} onChange={setV} onComplete={onComplete} />;
}

describe('OtpInput', () => {
  it('auto-advances and completes', async () => {
    const done = vi.fn();
    const user = userEvent.setup();
    render(<OtpHarness onComplete={done} />);
    await user.keyboard('123456');
    expect(done).toHaveBeenCalledWith('123456');
  });
  it('accepts a pasted code', () => {
    const done = vi.fn();
    render(<OtpHarness onComplete={done} />);
    fireEvent.paste(screen.getByLabelText('Digit 1'), { clipboardData: { getData: () => '654 321' } });
    expect(done).toHaveBeenCalledWith('654321');
  });
  it('supports iOS one-time-code autofill', () => {
    render(<OtpHarness onComplete={() => undefined} />);
    expect(screen.getByLabelText('Digit 1')).toHaveAttribute('autocomplete', 'one-time-code');
  });
});

describe('ChangeBadge', () => {
  it('shows New instead of an infinite percentage', () => {
    render(<ChangeBadge change={{ current: 100, previous: 0, diff: 100, pct: null, is_new: true, good: false }} />);
    expect(screen.getByText('New')).toBeInTheDocument();
  });
  it('uses arrow + sign, not colour alone', () => {
    render(<ChangeBadge change={{ current: 510_000, previous: 200_000, diff: 310_000, pct: 155, is_new: false, good: false }} />);
    const badge = screen.getByLabelText(/up 155%/);
    expect(badge).toHaveTextContent('+155%');
    expect(badge.className).toContain('text-negative');
  });
  it('spending down is green', () => {
    render(<ChangeBadge change={{ current: 50, previous: 150, diff: -100, pct: -66.7, is_new: false, good: true }} />);
    expect(screen.getByLabelText(/down 67%/).className).toContain('text-positive');
  });
});

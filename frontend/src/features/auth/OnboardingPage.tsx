import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AmountDisplay, Keypad } from '@/components/keypad/Keypad';
import { Button, Field, inputClass } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { formatDay, isoDay } from '@/lib/cycle';
import { parseToCents } from '@/lib/money';
import { useApp } from '@/lib/store';
import { AuthLayout, Logo } from './Logo';

/** First run: salary amount + date of the most recent salary (which sets the first cycle). */
export default function OnboardingPage() {
  const [step, setStep] = useState<1 | 2>(1);
  const [raw, setRaw] = useState('');
  const [date, setDate] = useState(isoDay());
  const [day, setDay] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const setOnboarded = useApp((s) => s.setOnboarded);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const cents = parseToCents(raw) ?? 0;
  const salaryDay = day ?? Number(date.slice(8, 10));

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await api('/settings/onboarding', { method: 'POST', body: { salary: cents, last_salary_date: date, salary_day: salaryDay } });
      setOnboarded(true);
      qc.invalidateQueries();
      navigate('/', { replace: true });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <div className="mb-4 flex flex-col items-center text-center">
        <Logo size={52} />
        <h1 className="mt-4 text-[24px] font-bold tracking-tight">{step === 1 ? 'Welcome to Ledger' : 'When was your last salary?'}</h1>
        <p className="mt-1 max-w-[300px] text-[15px] text-muted">
          {step === 1
            ? 'What’s your monthly salary?'
            : 'Each budget cycle runs from one salary day to the day before the next, so spending is always matched to the salary that paid for it.'}
        </p>
      </div>
      {step === 1 ? (
        <>
          <AmountDisplay value={raw} label="Monthly salary" />
          <div className="mt-2">
            <Keypad value={raw} onChange={setRaw} />
          </div>
          <Button block className="mt-5" disabled={cents <= 0} onClick={() => setStep(2)}>
            Continue
          </Button>
        </>
      ) : (
        <div className="space-y-4">
          <Field label="Most recent salary received on">
            <input type="date" className={inputClass} value={date} max={isoDay()} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </Field>
          <Field label="Usual salary day of the month" hint="Salary days 29–31 fall back to the last day of shorter months. You can change this later.">
            <select className={inputClass} value={salaryDay} onChange={(e) => setDay(Number(e.target.value))}>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </Field>
          <p className="text-[14px] text-muted">Your first cycle starts on {formatDay(date, { day: 'numeric', month: 'long' })}.</p>
          {error ? (
            <p role="alert" className="text-center text-[14px] text-negative">
              {error}
            </p>
          ) : null}
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <Button variant="secondary" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button block loading={busy} onClick={submit}>
              Get started
            </Button>
          </div>
        </div>
      )}
    </AuthLayout>
  );
}

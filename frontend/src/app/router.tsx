import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import AppShell from '@/components/layout/AppShell';
import { Toaster } from '@/components/ui/Toaster';
import { Logo } from '@/features/auth/Logo';
import { api } from '@/lib/api';
import { useApp } from '@/lib/store';

// Route-level code splitting.
const LoginPage = lazy(() => import('@/features/auth/LoginPage'));
const VerifyPage = lazy(() => import('@/features/auth/VerifyPage'));
const LockScreen = lazy(() => import('@/features/auth/LockScreen'));
const OnboardingPage = lazy(() => import('@/features/auth/OnboardingPage'));
const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage'));
const BillsPage = lazy(() => import('@/features/bills/BillsPage'));
const SpendingPage = lazy(() => import('@/features/spending/SpendingPage'));
const CategoryDetailPage = lazy(() => import('@/features/spending/CategoryDetailPage'));
const IncomePage = lazy(() => import('@/features/income/IncomePage'));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage'));
const FixedExpensesSettings = lazy(() => import('@/features/settings/FixedExpensesSettings'));
const IncomeSettings = lazy(() => import('@/features/settings/IncomeSettings'));
const CategoriesSettings = lazy(() => import('@/features/settings/CategoriesSettings'));
const SecuritySettings = lazy(() => import('@/features/settings/SecuritySettings'));
const DataSettings = lazy(() => import('@/features/settings/DataSettings'));
const IncomeCycleSettings = lazy(() => import('@/features/settings/IncomeCycleSettings'));
const AppearanceSettings = lazy(() => import('@/features/settings/PreferenceSettings').then((m) => ({ default: m.AppearanceSettings })));

function SettingsSection() {
  const { section } = useParams();
  switch (section) {
    case 'fixed':
      return <FixedExpensesSettings />;
    case 'income':
      return <IncomeSettings />;
    case 'categories':
      return <CategoriesSettings />;
    case 'cycle':
      return <IncomeCycleSettings />;
    case 'appearance':
      return <AppearanceSettings />;
    case 'security':
      return <SecuritySettings />;
    case 'data':
      return <DataSettings />;
    default:
      return <Navigate to="/settings" replace />;
  }
}

function Splash() {
  return (
    <div className="flex h-[100dvh] items-center justify-center" aria-busy="true" aria-label="Loading Ledger">
      <div className="animate-pulse">
        <Logo size={56} />
      </div>
    </div>
  );
}

export function AppRoutes() {
  const auth = useApp((s) => s.auth);
  const onboarded = useApp((s) => s.onboarded);
  const setAuth = useApp((s) => s.setAuth);

  useEffect(() => {
    api<{ username: string; onboarded: boolean }>('/auth/me')
      .then((me) => setAuth('authed', me))
      .catch(() => {
        if (useApp.getState().auth === 'unknown') setAuth('anon');
      });
  }, [setAuth]);

  if (auth === 'unknown') return <Splash />;

  if (auth === 'anon') {
    return (
      <Suspense fallback={<Splash />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/login/verify" element={<VerifyPage />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
        <Toaster />
      </Suspense>
    );
  }

  if (auth === 'locked') {
    return (
      <Suspense fallback={<Splash />}>
        <LockScreen />
      </Suspense>
    );
  }

  if (!onboarded) {
    return (
      <Suspense fallback={<Splash />}>
        <OnboardingPage />
      </Suspense>
    );
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="bills" element={<BillsPage />} />
        <Route path="spending" element={<SpendingPage />} />
        <Route path="spending/:categoryId" element={<CategoryDetailPage />} />
        <Route path="income" element={<IncomePage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="settings/:section" element={<SettingsSection />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

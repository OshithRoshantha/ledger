import { Suspense, useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Skeleton } from '@/components/ui/primitives';
import { Toaster } from '@/components/ui/Toaster';
import { useIdleLock } from '@/features/auth/useIdleLock';
import { QuickAddSheet } from '@/features/spending/QuickAddSheet';
import { useSettings } from '@/lib/queries';
import { local } from '@/lib/store';
import { applyTheme } from '@/lib/theme';
import { TabBar } from './TabBar';

export default function AppShell() {
  const { data: settings } = useSettings();
  const { pathname } = useLocation();
  const main = useRef<HTMLElement>(null);
  useIdleLock(settings?.auto_lock_minutes ?? 10);

  useEffect(() => {
    if (settings && local.get('theme') !== settings.theme) applyTheme(settings.theme);
  }, [settings]);

  useEffect(() => {
    main.current?.scrollTo({ top: 0 });
  }, [pathname]);

  return (
    <div className="relative mx-auto flex h-[100dvh] max-w-[480px] flex-col overflow-hidden bg-bg min-[481px]:border-x min-[481px]:border-hairline">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-brand focus:px-3 focus:py-2 focus:text-white">
        Skip to content
      </a>
      <main id="main" ref={main} className="scroll-pane min-h-0 flex-1" tabIndex={-1}>
        <Suspense fallback={<PageSkeleton />}>
          <Outlet />
        </Suspense>
        <div style={{ height: 'calc(var(--safe-bottom) + 96px)' }} aria-hidden />
      </main>
      <TabBar />
      <QuickAddSheet />
      <Toaster />
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-3 px-4" style={{ paddingTop: 'calc(max(var(--safe-top), 12px) + 60px)' }}>
      <Skeleton className="h-[200px] w-full !rounded-[20px]" />
      <Skeleton className="h-[80px] w-full !rounded-[20px]" />
      <Skeleton className="h-[160px] w-full !rounded-[20px]" />
    </div>
  );
}

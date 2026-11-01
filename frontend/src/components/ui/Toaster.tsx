import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import { useApp } from '@/lib/store';

export function Toaster() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[70] flex flex-col items-center gap-2 px-4"
      style={{ bottom: 'calc(var(--safe-bottom) + 92px)' }}
      aria-live="polite"
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            className={clsx(
              'pointer-events-auto flex w-full max-w-[448px] items-center justify-between gap-3 rounded-2xl border border-hairline px-4 py-3 shadow-lg backdrop-blur',
              t.tone === 'error' ? 'bg-[var(--negative)] text-white' : 'bg-elevated text-text',
            )}
            role="status"
          >
            <span className="text-[15px]">{t.message}</span>
            {t.action ? (
              <button
                type="button"
                className="tap -my-2 -mr-2 px-2 text-[15px] font-semibold text-brand"
                onClick={() => {
                  t.action!.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            ) : null}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

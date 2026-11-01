import * as Dialog from '@radix-ui/react-dialog';
import { AnimatePresence, motion, useDragControls } from 'framer-motion';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { prefersReducedMotion } from '@/lib/haptics';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** visually hide the title (still read by screen readers) */
  hideTitle?: boolean;
}

/** iOS-style bottom sheet: swipe the grabber/header down to dismiss. */
export function BottomSheet({ open, onOpenChange, title, description, children, footer, hideTitle }: Props) {
  const controls = useDragControls();
  const reduced = prefersReducedMotion();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-50 bg-[var(--scrim)]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduced ? 0 : 0.2 }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount {...(description ? {} : { 'aria-describedby': undefined })}>
              <motion.div
                className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[92dvh] w-full max-w-[480px] flex-col rounded-t-[24px] border-t border-hairline bg-surface outline-none"
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 40 }}
                drag="y"
                dragListener={false}
                dragControls={controls}
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0, bottom: 0.7 }}
                onDragEnd={(_, info) => {
                  if (info.offset.y > 110 || info.velocity.y > 600) onOpenChange(false);
                }}
              >
                <div
                  className="shrink-0 cursor-grab touch-none px-4 pb-2 pt-2"
                  onPointerDown={(e) => controls.start(e)}
                >
                  <div className="mx-auto mb-2 h-[5px] w-10 rounded-full bg-[var(--hairline-strong)]" aria-hidden />
                  <div className="flex min-h-[36px] items-center justify-between">
                    <Dialog.Title className={hideTitle ? 'sr-only' : 'text-[18px] font-semibold'}>{title}</Dialog.Title>
                    <Dialog.Close
                      className="tap -mr-2 flex items-center justify-center rounded-full text-muted"
                      aria-label="Close"
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-elevated">
                        <X size={18} strokeWidth={2} aria-hidden />
                      </span>
                    </Dialog.Close>
                  </div>
                  {description ? <Dialog.Description className="text-[14px] text-muted">{description}</Dialog.Description> : null}
                </div>
                <div className="scroll-pane min-h-0 flex-1 px-4 pb-3">{children}</div>
                {footer ? (
                  <div className="shrink-0 border-t border-hairline px-4 pt-3" style={{ paddingBottom: 'calc(var(--safe-bottom) + 12px)' }}>
                    {footer}
                  </div>
                ) : (
                  <div style={{ height: 'var(--safe-bottom)' }} />
                )}
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  );
}

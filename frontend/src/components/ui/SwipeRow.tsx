import { animate, motion, useMotionValue } from 'framer-motion';
import { Pencil, Trash2 } from 'lucide-react';
import { useRef, type ReactNode } from 'react';

const ACTION_W = 148;

/** Row that reveals Edit / Delete on a left swipe. Actions are also reachable by keyboard. */
export function SwipeRow({ children, onEdit, onDelete, label }: { children: ReactNode; onEdit?: () => void; onDelete?: () => void; label: string }) {
  const x = useMotionValue(0);
  const open = useRef(false);

  const snap = (to: number) => {
    open.current = to !== 0;
    animate(x, to, { type: 'spring', stiffness: 500, damping: 40 });
  };

  return (
    <div className="relative overflow-hidden">
      <div className="absolute inset-y-0 right-0 flex" style={{ width: ACTION_W }}>
        {onEdit ? (
          <button
            type="button"
            onClick={() => {
              snap(0);
              onEdit();
            }}
            className="flex flex-1 flex-col items-center justify-center gap-1 bg-elevated text-[12px] font-medium text-text"
            aria-label={`Edit ${label}`}
          >
            <Pencil size={18} strokeWidth={1.75} aria-hidden />
            Edit
          </button>
        ) : null}
        {onDelete ? (
          <button
            type="button"
            onClick={() => {
              snap(0);
              onDelete();
            }}
            className="flex flex-1 flex-col items-center justify-center gap-1 bg-negative text-[12px] font-medium text-white"
            aria-label={`Delete ${label}`}
          >
            <Trash2 size={18} strokeWidth={1.75} aria-hidden />
            Delete
          </button>
        ) : null}
      </div>
      <motion.div
        drag="x"
        dragDirectionLock
        dragConstraints={{ left: -ACTION_W, right: 0 }}
        dragElastic={{ left: 0.08, right: 0 }}
        style={{ x, touchAction: 'pan-y' }}
        onDragEnd={(_, info) => {
          const shouldOpen = info.offset.x < -48 || info.velocity.x < -400;
          snap(shouldOpen ? -ACTION_W : 0);
        }}
        onClickCapture={(e) => {
          if (open.current) {
            e.stopPropagation();
            snap(0);
          }
        }}
        className="relative bg-surface"
      >
        {children}
      </motion.div>
    </div>
  );
}

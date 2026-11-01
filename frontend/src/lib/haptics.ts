/**
 * Haptic-style feedback. iOS Safari has no Vibration API, so on iPhone the visual
 * micro-interactions carry the feedback; Android/desktop get a short vibration.
 */
export function haptic(kind: 'light' | 'success' | 'error' = 'light'): void {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(kind === 'success' ? [12, 40, 18] : kind === 'error' ? [30, 50, 30] : 8);
    }
  } catch {
    /* unsupported */
  }
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

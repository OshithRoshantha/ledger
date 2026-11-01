export function Logo({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <linearGradient id="ledger-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#818CF8" />
          <stop offset="1" stopColor="#4338CA" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#ledger-logo)" />
      <rect x="14" y="34" width="9" height="16" rx="3" fill="#fff" opacity=".75" />
      <rect x="27.5" y="24" width="9" height="26" rx="3" fill="#fff" opacity=".9" />
      <rect x="41" y="14" width="9" height="36" rx="3" fill="#fff" />
    </svg>
  );
}

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="scroll-pane mx-auto flex h-[100dvh] max-w-[480px] flex-col px-6"
      style={{ paddingTop: 'max(var(--safe-top), 24px)', paddingBottom: 'max(var(--safe-bottom), 24px)' }}
    >
      <div className="flex flex-1 flex-col justify-center">{children}</div>
    </div>
  );
}

/** Tiny inline sparkline (pure SVG, no chart library). Last point is highlighted. */
export function Sparkline({ values, width = 64, height = 22, colour = 'var(--brand)', label }: { values: number[]; width?: number; height?: number; colour?: string; label?: string }) {
  if (!values.length || values.every((v) => v === 0)) {
    return <svg width={width} height={height} aria-hidden />;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = values.length > 1 ? (width - 4) / (values.length - 1) : 0;
  const pts = values.map((v, i) => [2 + i * step, height - 3 - ((v - min) / span) * (height - 6)] as const);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={!label}>
      <path d={d} fill="none" stroke={colour} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
      <circle cx={lx} cy={ly} r={2.5} fill={colour} />
    </svg>
  );
}

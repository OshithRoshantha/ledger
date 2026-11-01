import { defineConfig, type Project } from '@playwright/test';

// Safe-area insets are simulated through the --safe-top/--safe-bottom CSS variables
// (standalone PWA: Dynamic Island + home indicator on iPhone 16; 20pt status bar on 7 Plus).
export const DEVICES = {
  'iphone-16': { width: 393, height: 852, dpr: 3, top: 59, bottom: 34 },
  'iphone-7-plus': { width: 414, height: 736, dpr: 3, top: 20, bottom: 0 },
  'iphone-se': { width: 375, height: 667, dpr: 2, top: 20, bottom: 0 },
} as const;

const browserName = (process.env.PW_BROWSER as 'webkit' | 'chromium' | undefined) ?? 'webkit';

const projects: Project[] = Object.entries(DEVICES).map(([name, d]) => ({
  name,
  use: {
    browserName,
    viewport: { width: d.width, height: d.height },
    deviceScaleFactor: d.dpr,
    isMobile: true,
    hasTouch: true,
    colorScheme: 'dark',
    serviceWorkers: 'block',
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  },
  metadata: { insets: { top: d.top, bottom: d.bottom } },
}));

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'off' },
  projects,
  webServer: {
    command: 'npx vite preview --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});

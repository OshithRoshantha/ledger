import { defineConfig } from '@playwright/test';

/**
 * Smoke test of the GitHub Pages build: served under /ledger/, API on another site, token mode.
 *   npx vite build --outDir dist-pages-test   (with VITE_BASE=/ledger/ VITE_AUTH_MODE=token VITE_API_BASE=https://api.test)
 *   npx playwright test -c playwright.pages.config.ts
 */
export default defineConfig({
  testDir: './e2e-pages',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4174/ledger/',
    browserName: 'webkit',
    viewport: { width: 393, height: 852 },
    hasTouch: true,
    isMobile: true,
    serviceWorkers: 'block',
  },
  webServer: {
    command: 'npx vite preview --outDir dist-pages-test --host 127.0.0.1 --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174/ledger/',
    reuseExistingServer: false,
    timeout: 120_000,
    env: { VITE_BASE: '/ledger/' },
  },
});

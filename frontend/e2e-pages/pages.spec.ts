import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fx = (name: string) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'e2e', 'fixtures', `${name}.json`), 'utf8'));

test('GitHub Pages build: sub-path, cross-site API, token login without cookies', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-12T10:00:00+05:30'));
  page.on('console', (m) => m.type() === 'error' && console.log('[console]', m.text()));
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('requestfailed', (r) => console.log('[failed]', r.url(), r.failure()?.errorText));
  const seen: { path: string; auth?: string; csrf?: string; rt?: string; cookie?: string }[] = [];
  let access: string | null = null;

  await page.route('https://api.test/api/v1/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname.replace('/api/v1', '');
    const h = await req.allHeaders();
    seen.push({ path: p, auth: h.authorization, csrf: h['x-csrf-token'], rt: h['x-refresh-token'], cookie: h.cookie });
    const cors = { 'access-control-allow-origin': 'http://127.0.0.1:4174', 'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'content-type,authorization,x-refresh-token,x-csrf-token,accept', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE' };
    const json = (body: unknown, status = 200) => route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: cors });
    if (p === '/auth/login') return json({ pre_auth_token: 'pre', expires_in: 300 });
    if (p === '/auth/verify-2fa') {
      access = 'at-1';
      return json({ ok: true, username: 'oshith', access_token: access, refresh_token: 'rt-1', expires_in: 900 });
    }
    if (p === '/auth/refresh') return json({ detail: 'Not authenticated' }, 401);
    if (!access || h.authorization !== `Bearer ${access}`) return json({ detail: 'Not authenticated' }, 401);
    const map: Record<string, string> = {
      '/auth/me': 'me', '/settings': 'settings', '/analytics/overview': 'overview-last', '/categories': 'categories',
      '/reasons': 'reasons', '/income-sources': 'sources', '/fixed-expenses': 'bills', '/cycles/resolve': 'resolve-nov',
    };
    if (map[p]) return json(fx(map[p]));
    return json({ ok: true });
  });

  await page.goto('./');
  await expect(page).toHaveURL(/\/ledger\/login$/);
  await expect(page.getByRole('heading', { name: 'Ledger' })).toBeVisible();
  // assets and theme script load under the sub-path
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("connect-src 'self' https://api.test");

  await page.getByPlaceholder('Username').fill('oshith');
  await page.getByPlaceholder('Password').fill('correct horse battery');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/ledger\/login\/verify$/);
  await page.getByLabel('Digit 1').fill('123456');

  await expect(page.getByText('Safe to spend').first()).toBeVisible();
  await expect(page).toHaveURL(/\/ledger\/?$/);
  expect(await page.evaluate(() => localStorage.getItem('ledger.rt'))).toBe('rt-1');
  expect(await page.evaluate(() => document.cookie)).toBe('');

  const me = seen.find((s) => s.path === '/auth/me' && s.auth);
  expect(me?.auth).toBe('Bearer at-1');
  // no CSRF dance in token mode, and the refresh token only goes to /auth/* endpoints
  expect(seen.filter((s) => s.path === '/auth/csrf')).toHaveLength(0);
  expect(seen.filter((s) => s.rt && !s.path.startsWith('/auth/'))).toHaveLength(0);

  // deep link after reload: 404.html is not used by vite preview, but the router basename must resolve
  await page.getByRole('link', { name: 'Bills' }).click();
  await expect(page).toHaveURL(/\/ledger\/bills$/);
});

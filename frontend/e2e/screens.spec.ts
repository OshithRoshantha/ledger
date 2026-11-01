import { expect, test, type Page, type TestInfo } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Screenshots of every screen and every dashboard tab at iPhone 16, iPhone 7 Plus and
 * iPhone SE sizes, with layout assertions: no horizontal page overflow (wide tables must
 * scroll inside their card), header clear of the status bar / Dynamic Island, tab bar clear
 * of the home indicator, 44pt tab targets. The API is mocked with fixtures generated from
 * the real backend (e2e/make_fixtures.py).
 */

const FX = path.join(__dirname, 'fixtures');
const fx = (name: string) => JSON.parse(fs.readFileSync(path.join(FX, `${name}.json`), 'utf8'));
const ids = fx('ids') as { uber: string; bank: string };
const SHOTS = path.join(__dirname, 'screenshots');

type Mode = 'authed' | 'anon' | 'locked';

async function mockApi(page: Page, mode: Mode = 'authed') {
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname.replace('/api/v1', '');
    const method = route.request().method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (p === '/auth/csrf') return json({ csrf: 'test-token' });
    if (p === '/auth/login') return json({ pre_auth_token: 'pre-auth-token-for-tests', expires_in: 300 });
    if (p === '/auth/refresh') return mode === 'locked' ? json({ detail: 'Session locked' }, 423) : json({ detail: 'Not authenticated' }, 401);
    if (mode !== 'authed' && p === '/auth/me') return json({ detail: 'Not authenticated' }, 401);
    if (p === '/analytics/simulate') return json(fx('simulate'));
    if (p === '/settings/salary/preview') return json(fx('salary-preview'));
    if (method !== 'GET') return json({ ok: true });

    if (p === '/analytics/overview') return json(fx(`overview-${url.searchParams.get('compare') ?? 'last'}`));
    if (p === '/cycles/resolve') return json(fx((url.searchParams.get('date') ?? '') < '2026-11-05' ? 'resolve-oct' : 'resolve-nov'));
    if (p === '/expenses') {
      const cat = url.searchParams.get('category_id');
      if (url.searchParams.get('day') || url.searchParams.get('reason_id') || url.searchParams.get('method')) return json({ total: 0, items: [] });
      return json(fx(cat === ids.bank ? 'expenses-bank' : 'expenses-uber'));
    }
    const map: Record<string, string> = {
      '/auth/me': 'me',
      '/settings': 'settings',
      '/settings/salary': 'salary',
      '/cycles': 'cycles',
      '/analytics/spending': 'tab-spending',
      '/analytics/bills': 'tab-bills',
      '/analytics/trends': 'tab-trends',
      '/analytics/plan': 'tab-plan',
      '/fixed-expenses': 'bills',
      '/spending/summary': 'spending',
      '/income': 'income',
      '/categories': 'categories',
      '/reasons': 'reasons',
      '/income-sources': 'sources',
      '/settings/fixed-expenses': 'templates',
      '/security/activity': 'activity',
    };
    if (map[p]) return json(fx(map[p]));
    if (p === '/budgets' || p === '/goals') return json([]);
    return json({ detail: 'not mocked' }, 404);
  });
}

async function prepare(page: Page, info: TestInfo, mode: Mode = 'authed') {
  const insets = (info.project.metadata as { insets: { top: number; bottom: number } }).insets;
  await page.clock.setFixedTime(new Date('2026-11-12T10:00:00+05:30'));
  // A frozen clock would also freeze animations mid-way; reduced motion renders final states.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript((i) => {
    const css = `:root{--safe-top:${i.top}px !important;--safe-bottom:${i.bottom}px !important}`;
    const add = () => {
      const s = document.createElement('style');
      s.textContent = css;
      document.head.appendChild(s);
    };
    if (document.head) add();
    else document.addEventListener('DOMContentLoaded', add);
    try {
      localStorage.setItem('ledger.lastActive', String(Date.now()));
      localStorage.removeItem('ledger.compare');
    } catch {
      /* ignore */
    }
  }, insets);
  await mockApi(page, mode);
  return insets;
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);
}

async function shot(page: Page, info: TestInfo, name: string, full = false) {
  const file = path.join(SHOTS, info.project.name, `${name}.png`);
  if (!full) {
    await page.screenshot({ path: file });
    return;
  }
  // The app scrolls inside <main>; expand it so a full-page capture shows every section.
  await page.evaluate(() => {
    document.body.style.position = 'static';
    document.body.style.overflow = 'visible';
    document.querySelectorAll<HTMLElement>('#root, #root > div, #main').forEach((el) => {
      el.style.height = 'auto';
      el.style.overflow = 'visible';
    });
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: file, fullPage: true });
  await page.reload();
  await settle(page);
}

async function assertLayout(page: Page, insets: { top: number; bottom: number }) {
  const r = await page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const main = document.querySelector<HTMLElement>('#main');
    const title = document.querySelector('header h1')?.getBoundingClientRect();
    const nav = document.querySelector<HTMLElement>('nav[aria-label="Main"]');
    const navList = nav?.querySelector('ul')?.getBoundingClientRect();
    const tabTargets = nav ? [...nav.querySelectorAll<HTMLElement>('a, button')].map((el) => el.getBoundingClientRect()) : [];
    const overflowing = [...document.querySelectorAll<HTMLElement>('#main *, header *')]
      .filter((el) => {
        const b = el.getBoundingClientRect();
        // horizontally scrollable strips/tables are allowed to extend past the edge
        return b.width > 0 && (b.right > vw + 1 || b.left < -1) && !el.closest('[class*="overflow-x-auto"]');
      })
      .slice(0, 5)
      .map((el) => `${el.tagName}.${el.className.toString().slice(0, 60)}`);
    return {
      vw,
      vh,
      docScroll: document.documentElement.scrollWidth,
      mainScroll: main ? main.scrollWidth - main.clientWidth : 0,
      titleTop: title?.top ?? null,
      navBottom: navList?.bottom ?? null,
      tabTargets: tabTargets.map((b) => Math.min(b.width, b.height)),
      overflowing,
    };
  });
  expect(r.docScroll, 'page must not scroll horizontally').toBeLessThanOrEqual(r.vw);
  expect(r.mainScroll, `main pane must not scroll horizontally: ${r.overflowing.join(' | ')}`).toBeLessThanOrEqual(0);
  expect(r.overflowing, `elements outside the viewport: ${r.overflowing.join(' | ')}`).toEqual([]);
  if (r.titleTop !== null) expect(r.titleTop, 'header clear of status bar / Dynamic Island').toBeGreaterThanOrEqual(insets.top);
  if (r.navBottom !== null) {
    expect(r.navBottom, 'tab bar clear of home indicator').toBeLessThanOrEqual(r.vh - insets.bottom + 0.5);
    for (const size of r.tabTargets) expect(size, 'tab touch target >= 44pt').toBeGreaterThanOrEqual(44);
  }
}

test.describe('auth screens', () => {
  test('login and 2FA', async ({ page }, info) => {
    await prepare(page, info, 'anon');
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Ledger' })).toBeVisible();
    await settle(page);
    await assertLayout(page, { top: 0, bottom: 0 });
    await shot(page, info, '01-login');
    await page.getByPlaceholder('Username').fill('oshith');
    await page.getByPlaceholder('Password').fill('correct horse battery');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Two-factor code' })).toBeVisible();
    await expect(page.getByLabel('Digit 1')).toHaveAttribute('autocomplete', 'one-time-code');
    await shot(page, info, '02-otp');
  });

  test('lock screen', async ({ page }, info) => {
    await prepare(page, info, 'locked');
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Ledger is locked' })).toBeVisible();
    await shot(page, info, '03-locked');
  });
});

const TABS = [
  { name: 'Overview', marker: 'Money health', file: '10-tab-overview' },
  { name: 'Spending', marker: 'Where the money goes', file: '11-tab-spending' },
  { name: 'Bills', marker: 'Bill amounts · 12 cycles', file: '12-tab-bills' },
  { name: 'Trends', marker: 'Cycle by cycle', file: '13-tab-trends' },
  { name: 'Plan', marker: 'Can I afford it?', file: '14-tab-plan' },
];

test.describe('dashboard tabs', () => {
  for (const t of TABS) {
    test(`${t.name} tab`, async ({ page }, info) => {
      const insets = await prepare(page, info);
      await page.goto('/');
      await expect(page.getByText('Safe to spend').first()).toBeVisible();
      await page.getByRole('tab', { name: t.name }).click();
      await expect(page.getByText(t.marker, { exact: true }).first()).toBeVisible();
      await settle(page);
      await assertLayout(page, insets);
      await shot(page, info, t.file);
      await page.locator('#main').evaluate((el) => el.scrollTo(0, 700));
      await page.waitForTimeout(250);
      await assertLayout(page, insets);
      await shot(page, info, `${t.file}-b`);
      await shot(page, info, `${t.file}-full`, true);
    });
  }

  test('overview content, compare modes and drill-down', async ({ page }, info) => {
    await prepare(page, info);
    await page.goto('/');
    await expect(page.getByText(/You can spend Rs [\d,]+\/day for \d+ more days/)).toBeVisible();
    await expect(page.getByText('vs Oct 2026, same day 8').first()).toBeVisible();
    await page.getByLabel('Compare with').selectOption('avg3');
    await expect(page.getByText(/^vs 3-cycle avg \(/).first()).toBeVisible();
    await page.getByLabel('Compare with').selectOption('yoy');
    await expect(page.getByText(/^vs Nov 2025, same day 8/).first()).toBeVisible();
    // tap a KPI card -> drill-down sheet with entries
    await page.getByRole('button', { name: /Total spent/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('affordability simulator', async ({ page }, info) => {
    await prepare(page, info);
    await page.goto('/?tab=plan');
    await expect(page.getByText('Can I afford it?').first()).toBeVisible();
    await page.getByLabel('Amount to check').fill('5000');
    await expect(page.getByText(/Yes — you can afford this|You can, but|Not without missing bills/)).toBeVisible();
    await page.getByLabel('Amount to check').scrollIntoViewIfNeeded();
    await shot(page, info, '15-simulator');
  });
});

test.describe('app screens', () => {
  test('bills and pay sheet with attribution chip', async ({ page }, info) => {
    const insets = await prepare(page, info);
    await page.goto('/bills');
    await expect(page.getByText(/of \d+ paid/)).toBeVisible();
    await settle(page);
    await assertLayout(page, insets);
    await shot(page, info, '20-bills');
    await page.getByRole('button', { name: /Water Bill/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('From Nov salary')).toBeVisible();
    await page.waitForTimeout(400);
    await shot(page, info, '21-pay-sheet');
    const box = await dialog.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(info.project.use.viewport!.height + 0.5);
  });

  test('quick add: attribution follows the date', async ({ page }, info) => {
    await prepare(page, info);
    await page.goto('/');
    await expect(page.getByText('Safe to spend').first()).toBeVisible();
    await page.getByRole('button', { name: 'Quick add' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('radio', { name: 'Bank & Cash Spending' }).click();
    for (const k of ['5', '0', '0', '0']) await dialog.getByRole('button', { name: k, exact: true }).click();
    await expect(dialog.getByText('From Nov salary')).toBeVisible();
    await shot(page, info, '40-quick-add');
    await dialog.getByLabel('Pick date').fill('2026-11-04');
    await expect(dialog.getByText('From Oct salary')).toBeVisible();
    await shot(page, info, '41-quick-add-oct');
  });

  test('spending and category detail', async ({ page }, info) => {
    const insets = await prepare(page, info);
    await page.goto('/spending');
    await expect(page.getByText('Uber / PickMe').first()).toBeVisible();
    await settle(page);
    await assertLayout(page, insets);
    await shot(page, info, '30-spending');
    await page.goto(`/spending/${ids.bank}`);
    await expect(page.getByRole('heading', { name: 'Bank & Cash Spending' })).toBeVisible();
    await settle(page);
    await assertLayout(page, insets);
    await shot(page, info, '31-category-detail');
  });

  test('income', async ({ page }, info) => {
    const insets = await prepare(page, info);
    await page.goto('/income');
    await expect(page.getByText('Received this cycle')).toBeVisible();
    await settle(page);
    await assertLayout(page, insets);
    await shot(page, info, '50-income');
  });

  test('income & cycle settings with salary-day preview', async ({ page }, info) => {
    const insets = await prepare(page, info);
    await page.goto('/settings/cycle');
    await expect(page.getByText('Salary day of the month')).toBeVisible();
    await settle(page);
    await assertLayout(page, insets);
    await shot(page, info, '66-settings-income-cycle');
    await page.locator('select').first().selectOption('10');
    await page.getByRole('button', { name: 'Review' }).click();
    await expect(page.getByRole('dialog').getByText(/will move from .* cycle to .* cycle|No entries will move/).first()).toBeVisible();
    await page.waitForTimeout(400);
    await shot(page, info, '67-salary-day-preview');
  });

  test('settings', async ({ page }, info) => {
    const insets = await prepare(page, info);
    for (const [route, name, marker] of [
      ['/settings', '60-settings', 'Fixed bills'],
      ['/settings/fixed', '61-settings-fixed', 'Claude Pro'],
      ['/settings/categories', '62-settings-categories', 'Spending categories'],
      ['/settings/security', '63-settings-security', 'Recent activity'],
      ['/settings/data', '65-settings-data', 'Export CSV'],
    ] as const) {
      await page.goto(route);
      await expect(page.getByText(marker).first()).toBeVisible();
      await settle(page);
      await assertLayout(page, insets);
      await shot(page, info, name);
    }
  });

  test('light theme', async ({ page }, info) => {
    const insets = await prepare(page, info);
    await page.addInitScript(() => localStorage.setItem('ledger.theme', 'light'));
    await page.route('**/api/v1/settings', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...fx('settings'), theme: 'light' }) }),
    );
    await page.goto('/');
    await expect(page.getByText('Safe to spend').first()).toBeVisible();
    await settle(page);
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
    await assertLayout(page, insets);
    await shot(page, info, '70-dashboard-light');
  });
});

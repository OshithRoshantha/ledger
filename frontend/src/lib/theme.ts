import { local } from './store';

export type ThemePref = 'dark' | 'light' | 'system';

let mql: MediaQueryList | null = null;
let listener: (() => void) | null = null;

function resolve(pref: ThemePref): 'dark' | 'light' {
  if (pref !== 'system') return pref;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function paint(theme: 'dark' | 'light') {
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#F5F6F8' : '#0B0D12');
}

/** Apply and remember the theme preference; "system" keeps following the OS. */
export function applyTheme(pref: ThemePref) {
  local.set('theme', pref);
  if (mql && listener) mql.removeEventListener('change', listener);
  mql = null;
  listener = null;
  paint(resolve(pref));
  if (pref === 'system' && window.matchMedia) {
    mql = window.matchMedia('(prefers-color-scheme: light)');
    listener = () => paint(resolve('system'));
    mql.addEventListener('change', listener);
  }
}

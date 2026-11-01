/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API origin when the app is hosted separately (e.g. https://api.example.com). Empty = same origin. */
  readonly VITE_API_BASE?: string;
  /** Custom domain written to CNAME for GitHub Pages. */
  readonly VITE_PAGES_CNAME?: string;
  /** 'token' for cross-site hosting where the API's cookies are blocked. */
  readonly VITE_AUTH_MODE?: 'cookie' | 'token';
  /** Public path the app is served from, e.g. /ledger/ on GitHub Pages project sites. */
  readonly VITE_BASE?: string;
}

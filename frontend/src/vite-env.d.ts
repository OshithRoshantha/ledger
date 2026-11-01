/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API origin when the app is hosted separately (e.g. https://api.example.com). Empty = same origin. */
  readonly VITE_API_BASE?: string;
  /** Custom domain written to CNAME for GitHub Pages. */
  readonly VITE_PAGES_CNAME?: string;
}

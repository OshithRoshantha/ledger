/// <reference types="vitest" />
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Static hosting (GitHub Pages) can't send HTTP headers, so for that build:
 * - the CSP goes into a <meta> tag (connect-src allows only the API host),
 * - 404.html = index.html so deep links like /bills load the SPA,
 * - CNAME pins the custom domain and .nojekyll disables Jekyll processing.
 */
function staticHosting(apiBase: string, cname: string): Plugin {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${apiBase}`,
    "manifest-src 'self'",
    "worker-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
    // no upgrade-insecure-requests: GitHub Pages already enforces HTTPS, and the API URL is https
  ].join('; ');
  let outDir = 'dist';
  return {
    name: 'ledger-static-hosting',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    transformIndexHtml(html) {
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`);
    },
    closeBundle() {
      const index = path.join(outDir, 'index.html');
      if (!fs.existsSync(index)) return;
      fs.copyFileSync(index, path.join(outDir, '404.html'));
      fs.writeFileSync(path.join(outDir, '.nojekyll'), '');
      if (cname) fs.writeFileSync(path.join(outDir, 'CNAME'), `${cname}\n`);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const apiBase = (env.VITE_API_BASE ?? '').replace(/\/$/, '');
  const base = env.VITE_BASE ?? '/';
  return {
  base,
  plugins: [
    react(),
    ...(apiBase ? [staticHosting(apiBase, env.VITE_PAGES_CNAME ?? '')] : []),
    VitePWA({
      registerType: 'autoUpdate',
      // emits an external registerSW.js <script> tag: no inline script, CSP-safe
      injectRegister: 'script',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'theme-init.js', 'splash/*.png'],
      manifest: {
        name: 'Ledger',
        short_name: 'Ledger',
        description: 'Personal money manager',
        lang: 'en',
        // relative to the manifest, so the app also works under a sub-path (GitHub Pages)
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0B0D12',
        theme_color: '#0B0D12',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        globIgnores: ['splash/**'],
        navigateFallback: `${base}index.html`,
        navigateFallbackDenylist: [/^\/api\//],
        // Financial data is never cached by the service worker.
        runtimeCaching: [{ urlPattern: /^\/api\//, handler: 'NetworkOnly' }],
      },
    }),
  ],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:8000', changeOrigin: false } },
  },
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query', 'zustand'],
          motion: ['framer-motion'],
          // ECharts is deliberately NOT a manual chunk: forcing it would pull shared helpers into
          // the chunk and make the entry preload it. Left alone it loads with the dashboard charts.
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
  };
});

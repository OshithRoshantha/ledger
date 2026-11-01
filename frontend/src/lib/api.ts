import { useApp } from './store';

// Same origin by default (Nginx proxies /api). When the app is hosted separately (GitHub Pages),
// VITE_API_BASE points at the API host, e.g. https://api.example.com.
const BASE = `${(import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '')}/api/v1`;
const CREDENTIALS: RequestCredentials = import.meta.env.VITE_API_BASE ? 'include' : 'same-origin';
const CSRF_COOKIE = 'ledger_csrf';

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, detail: unknown) {
    super(errorText(detail) || `Request failed (${status})`);
    this.status = status;
    this.detail = detail;
  }
}

function errorText(detail: unknown): string {
  if (!detail) return '';
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const first = detail[0] as { msg?: string; loc?: string[] } | undefined;
    if (!first) return '';
    const field = first.loc?.[first.loc.length - 1];
    return field ? `${field}: ${first.msg}` : first.msg ?? '';
  }
  if (typeof detail === 'object' && detail && 'message' in detail) return String((detail as { message: string }).message);
  return '';
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong.';
}

function readCookie(name: string): string | null {
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

// On a separate API host the CSRF cookie belongs to that host and is invisible to
// document.cookie, so the token returned by /auth/csrf is also kept in memory.
let csrfMemo: string | null = null;
let csrfPromise: Promise<string> | null = null;
async function csrfToken(): Promise<string> {
  const existing = readCookie(CSRF_COOKIE) ?? csrfMemo;
  if (existing) return existing;
  csrfPromise ??= fetch(`${BASE}/auth/csrf`, { credentials: CREDENTIALS })
    .then((r) => r.json())
    .then((j: { csrf: string }) => (csrfMemo = j.csrf))
    .finally(() => {
      csrfPromise = null;
    });
  return csrfPromise;
}

type RefreshResult = 'ok' | 'locked' | 'fail';
let refreshPromise: Promise<RefreshResult> | null = null;

/** One in-flight refresh shared by every request that hit a 401. */
function refreshSession(): Promise<RefreshResult> {
  refreshPromise ??= (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        credentials: CREDENTIALS,
        headers: { 'X-CSRF-Token': await csrfToken() },
      });
      if (res.ok) return 'ok';
      return res.status === 423 ? 'locked' : 'fail';
    } catch {
      return 'fail';
    } finally {
      setTimeout(() => (refreshPromise = null), 0);
    }
  })();
  return refreshPromise;
}

interface Options {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** auth endpoints manage session state themselves */
  noRetry?: boolean;
}

async function raw(path: string, opts: Options = {}): Promise<Response> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-CSRF-Token'] = await csrfToken();
  return fetch(`${BASE}${path}`, {
    method,
    headers,
    credentials: CREDENTIALS,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  let res = await raw(path, opts);
  if (res.status === 401 && !opts.noRetry) {
    const r = await refreshSession();
    if (r === 'ok') res = await raw(path, opts);
    else if (r === 'locked') useApp.getState().setAuth('locked');
    else useApp.getState().setAuth('anon');
  }
  if (res.status === 423 && !opts.noRetry) useApp.getState().setAuth('locked');
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) throw new ApiError(res.status, (data as { detail?: unknown } | null)?.detail ?? data);
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Download an export through fetch (keeps cookies + refresh), then hand the blob to the browser. */
export async function download(path: string): Promise<void> {
  let res = await raw(path);
  if (res.status === 401 && (await refreshSession()) === 'ok') res = await raw(path);
  if (!res.ok) throw new ApiError(res.status, 'Export failed');
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'ledger-export';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

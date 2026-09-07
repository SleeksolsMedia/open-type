import {log} from './logging';

/** HTTP error with status + truncated body for display. */
export class HttpError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`Request failed (${status}): ${body.slice(0, 160) || 'no details'}`);
    this.status = status;
    this.body = body;
  }
}

/** Thrown when our own timeout fires (distinct from caller cancellation). */
export class TimeoutError extends Error {}

function mergeSignal(
  timeoutMs: number,
  outer?: AbortSignal,
): {signal: AbortSignal; cancel: () => void} {
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    ctrl.abort(
      new TimeoutError(
        `Timed out after ${Math.round(timeoutMs / 1000)}s. Check the server URL and network.`,
      ),
    );
  }, timeoutMs);
  if (outer) {
    if (outer.aborted) {
      clearTimeout(timer);
      ctrl.abort(outer.reason);
    } else {
      outer.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          ctrl.abort(outer.reason);
        },
        {once: true},
      );
    }
  }
  return {signal: ctrl.signal, cancel: () => clearTimeout(timer)};
}

/** fetch that also settles when the signal aborts (mocks may ignore signals). */
function fetchRacingAbort(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<Response> {
  if (signal.aborted) {
    return Promise.reject(
      signal.reason ?? new Error('Cancelled.'),
    );
  }
  const p = fetch(url, {...init, signal});
  // The loser of the race must never surface as unhandled.
  p.catch(() => undefined);
  const onAbort = new Promise<never>((_, reject) => {
    signal.addEventListener(
      'abort',
      () => reject(signal.reason ?? new Error('Cancelled.')),
      {once: true},
    );
  });
  return Promise.race([p, onAbort]);
}

export interface RetryOptions {
  timeoutMs?: number;
  /** Retries for network errors + 5xx + 429 (never for other 4xx). */
  retries?: number;
  baseBackoffMs?: number;
  signal?: AbortSignal;
  tag?: string;
}

const DEFAULT_TIMEOUT = 60000;

/**
 * fetch with timeout, cancellation, and bounded retries.
 * 4xx (except 429) fail fast with a readable message.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: RetryOptions = {},
): Promise<Response> {
  const {
    timeoutMs = DEFAULT_TIMEOUT,
    retries = 2,
    baseBackoffMs = 1000,
    signal,
    tag = 'net',
  } = opts;
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt += 1;
    const {signal: s, cancel} = mergeSignal(timeoutMs, signal);
    try {
      const res = await fetchRacingAbort(url, init, s);
      cancel();
      if (res.ok) {
        return res;
      }
      const body = await res.text().catch(() => '');
      if (
        attempt <= retries &&
        (res.status >= 500 || res.status === 429)
      ) {
        log('warn', tag, `HTTP ${res.status}, retry ${attempt}/${retries}`);
        await sleep(baseBackoffMs * attempt, signal);
        continue;
      }
      throw new HttpError(res.status, body);
    } catch (e) {
      cancel();
      if (e instanceof HttpError) {
        throw e;
      }
      if (e instanceof TimeoutError) {
        throw e;
      }
      if (signal?.aborted) {
        throw new Error('Cancelled.');
      }
      if (isAbort(e)) {
        throw new Error('Cancelled.');
      }
      if (attempt <= retries) {
        log('warn', tag, `Network error, retry ${attempt}/${retries}: ${msg(e)}`);
        await sleep(baseBackoffMs * attempt, signal);
        continue;
      }
      throw new Error(`Could not reach the server. ${msg(e)}`);
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Cancelled.'));
      return;
    }
    const t = setTimeout(() => resolve(), ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new Error('Cancelled.'));
      },
      {once: true},
    );
  });
}

function isAbort(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'name' in e &&
    (e as {name?: unknown}).name === 'AbortError'
  );
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Human message for auth/validation failures. */
export function friendlyHttpError(e: unknown, url?: string): string {
  if (e instanceof HttpError) {
    if (e.status === 401 || e.status === 403) {
      return 'Invalid API key (401/403). Check the key and try Test again.';
    }
    if (e.status === 404) {
      return url
        ? `Nothing OpenAI-compatible at ${url} (404). Fix the Base URL, then retest.`
        : 'Endpoint not found (404). Check the Base URL — it should end in /v1.';
    }
    if (e.status === 429) {
      return 'Rate limited (429). Wait a minute and retry.';
    }
    if (e.status >= 500) {
      return `Server error (${e.status}). The server may be starting up or out of memory.`;
    }
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

// ---- Base URL normalization + model discovery ------------------------------

/** Hosts where plain http is the sane default (loopback + LAN). */
function looksLocal(host: string): boolean {
  const h = host.toLowerCase().split(':')[0].replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '::1' || h === '127.0.0.1') {
    return true;
  }
  const v4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    return (
      a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    );
  }
  return h.endsWith('.local') || h.endsWith('.lan');
}

/**
 * Normalize a user-typed API base so every caller builds the same URLs:
 * adds a scheme (https, or http for local hosts), strips full-endpoint
 * pastes (`…/v1/chat/completions` → `…/v1`) and trailing slashes.
 */
export function normalizeBaseUrl(input: string): string {
  let u = (input ?? '').trim();
  if (!u) {
    return '';
  }
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(u)) {
    const host = u.split('/')[0];
    u = `${looksLocal(host) ? 'http' : 'https'}://${u}`;
  }
  u = u.replace(/\/+$/, '');
  // Strip a pasted full endpoint back to its base.
  u = u.replace(
    /\/(audio\/transcriptions|audio\/translations|chat\/completions|completions|models)$/i,
    '',
  );
  return u.replace(/\/+$/, '');
}

/** Normalized base or a throw with a message safe to show the user. */
export function requireBaseUrl(input: string | undefined): string {
  const base = normalizeBaseUrl(input ?? '');
  if (!base) {
    throw new Error('Base URL is missing.');
  }
  const m = base.match(/^(https?):\/\/([^/]+)(\/.*)?$/i);
  if (!m || /\s/.test(base) || !/^[A-Za-z0-9.:\-[\]]+$/.test(m[2])) {
    throw new Error('Base URL must look like https://host:port/v1.');
  }
  return base;
}

export function modelsUrl(base: string): string {
  return `${base}/models`;
}

/** Thrown when the server answers but has no usable GET /v1/models. */
export class ModelsUnsupportedError extends Error {}

export function isModelsUnsupported(e: unknown): boolean {
  return e instanceof ModelsUnsupportedError;
}

export function chatCompletionsUrl(base: string): string {
  return `${base}/chat/completions`;
}

export function transcriptionsUrl(base: string): string {
  return `${base}/audio/transcriptions`;
}

/**
 * Live model discovery: proves the URL is OpenAI-compatible AND the key
 * works, and returns the real model ids for the picker. Throws readable
 * errors for 401 / 404 / unreachable.
 */
export async function listModels(
  baseUrl: string | undefined,
  apiKey: string | undefined,
  opts: {signal?: AbortSignal} = {},
): Promise<string[]> {
  const base = requireBaseUrl(baseUrl);
  const url = modelsUrl(base);
  const headers: Record<string, string> = {};
  const key = (apiKey ?? '').trim();
  if (key) {
    headers.Authorization = `Bearer ${key}`;
  }
  let res: Response;
  try {
    res = await fetchWithRetry(
      url,
      {headers},
      {timeoutMs: 20000, retries: 1, signal: opts.signal, tag: 'models'},
    );
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) {
      throw new ModelsUnsupportedError(
        `No model list at ${url} (404). You can enter the model name manually.`,
      );
    }
    throw new Error(friendlyHttpError(e, url));
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ModelsUnsupportedError(
      `The server answered but did not return JSON at ${url}. You can enter the model name manually.`,
    );
  }
  const data = (json as {data?: unknown}).data;
  if (!Array.isArray(data)) {
    throw new ModelsUnsupportedError(
      `No model list at ${url} — this server is not OpenAI-compatible. You can enter the model name manually.`,
    );
  }
  const ids = [
    ...new Set(
      data
        .map(d => (d as {id?: unknown} | null)?.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ].sort();
  if (ids.length === 0) {
    throw new Error(`The server at ${url} returned an empty model list.`);
  }
  return ids;
}

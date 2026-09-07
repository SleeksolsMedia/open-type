import ReactNativeBlobUtil from 'react-native-blob-util';
import {log} from '../logging';
import {
  nativeCancelDownload,
  newDownloadToken,
  nativeRangeDownload,
} from '../native/modelDownload';
import {fetchWithRetry} from '../net';
import type {OnDeviceModel} from '../types';

const HF = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

/** whisper.cpp models. `.en` = English-only (faster, smaller); rest multilingual. */
export const MODEL_CATALOG: OnDeviceModel[] = [
  {
    id: 'tiny.en',
    label: 'Tiny English',
    detail: 'Fastest · good for quiet rooms',
    sizeMB: 75,
    fileName: 'ggml-tiny.en.bin',
    url: `${HF}/ggml-tiny.en.bin`,
  },
  {
    id: 'base.en',
    label: 'Base English',
    detail: 'Better accuracy · still fast',
    sizeMB: 142,
    fileName: 'ggml-base.en.bin',
    url: `${HF}/ggml-base.en.bin`,
  },
  {
    id: 'tiny',
    label: 'Tiny Multilingual',
    detail: '100+ languages · fastest',
    sizeMB: 75,
    fileName: 'ggml-tiny.bin',
    url: `${HF}/ggml-tiny.bin`,
  },
  {
    id: 'base',
    label: 'Base Multilingual',
    detail: '100+ languages · better accuracy',
    sizeMB: 142,
    fileName: 'ggml-base.bin',
    url: `${HF}/ggml-base.bin`,
  },
  {
    id: 'small.en',
    label: 'Small English',
    detail: 'Best accuracy · slower + 466 MB',
    sizeMB: 466,
    fileName: 'ggml-small.en.bin',
    url: `${HF}/ggml-small.en.bin`,
  },
];

const {fs} = ReactNativeBlobUtil;
const MODELS_DIR = `${fs.dirs.DocumentDir}/whisper-models`;

export function modelFilePath(model: OnDeviceModel): string {
  return `${MODELS_DIR}/${model.fileName}`;
}

export function getModel(modelId: string): OnDeviceModel {
  const found = MODEL_CATALOG.find(m => m.id === modelId);
  if (!found) {
    throw new Error(`Unknown model: ${modelId}`);
  }
  return found;
}

/** Ordered download sources: primary HuggingFace + public mirrors. */
export function mirrorUrls(model: OnDeviceModel): string[] {
  const urls = [model.url];
  const m = model.url.match(/^https:\/\/huggingface\.co\/(.+)$/);
  if (m) {
    urls.push(`https://hf-mirror.com/${m[1]}`);
  }
  return urls;
}

async function ensureDir(): Promise<void> {
  if (!(await fs.exists(MODELS_DIR))) {
    await fs.mkdir(MODELS_DIR);
  }
}

/** Downloaded + size within 5% of catalog (guards truncated downloads). */
export async function isModelDownloaded(modelId: string): Promise<boolean> {
  try {
    const model = getModel(modelId);
    const path = modelFilePath(model);
    if (!(await fs.exists(path))) {
      return false;
    }
    const stat = await fs.stat(path);
    const bytes = Number(stat.size);
    const expected = model.sizeMB * 1024 * 1024;
    return bytes > expected * 0.95;
  } catch {
    return false;
  }
}

export async function getModelPath(modelId: string): Promise<string> {
  return modelFilePath(getModel(modelId));
}

export async function deleteModel(modelId: string): Promise<void> {
  const path = modelFilePath(getModel(modelId));
  if (await fs.exists(path)) {
    await fs.unlink(path);
  }
  // Remove stale partial download.
  const tmp = `${path}.part`;
  if (await fs.exists(tmp)) {
    await fs.unlink(tmp).catch(() => undefined);
  }
}

export interface DownloadHandle {
  cancel: () => void;
  done: Promise<string>;
}

export interface DownloadCallbacks {
  onProgress?: (receivedMB: number, totalMB: number) => void;
  /** Human-readable stage line for the UI ("Mirror 2/2 · retrying…"). */
  onStatus?: (s: string) => void;
  signal?: AbortSignal;
}

/** No bytes for this long => the connection is dead; fail fast, auto-retry. */
const STALL_AFTER_MS = 25000;
const WATCHDOG_TICK_MS = 5000;
const PROBE_TIMEOUT_MS = 15000;
const MAX_ATTEMPTS_PER_MIRROR = 8;
const BACKOFF_BASE_MS = 2000;
const BACKOFF_MAX_MS = 10000;
const MB = 1024 * 1024;

class FetchStatusError extends Error {
  status: number;
  constructor(status: number) {
    super(`Download failed (HTTP ${status}).`);
    this.status = status;
  }
}

interface MirrorProbe {
  ok: boolean;
  ranges: boolean;
  status: number;
  reason: string;
}

/**
 * 1-byte ranged probe: proves the mirror is reachable and tells whether it
 * honors Range (needed for resume) — without downloading anything.
 */
async function probeMirror(
  url: string,
  signal?: AbortSignal,
): Promise<MirrorProbe> {
  try {
    const res = await fetchWithRetry(
      url,
      {headers: {Range: 'bytes=0-0'}},
      {timeoutMs: PROBE_TIMEOUT_MS, retries: 0, signal, tag: 'models'},
    );
    const accept = (res.headers.get('accept-ranges') ?? '').toLowerCase();
    const contentRange = res.headers.get('content-range') ?? '';
    if (res.status === 206) {
      return {ok: true, ranges: true, status: 206, reason: ''};
    }
    if (res.status === 200) {
      return {
        ok: true,
        ranges: accept.includes('bytes') || contentRange !== '',
        status: 200,
        reason: '',
      };
    }
    return {ok: false, ranges: false, status: res.status, reason: `HTTP ${res.status}`};
  } catch (e) {
    if (signal?.aborted) {
      throw new Error('Cancelled.');
    }
    return {
      ok: false,
      ranges: false,
      status: 0,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Download a model with progress + cancellation + resume + mirrors.
 * Downloads to `<file>.part`, verifies size, then renames into place,
 * so a killed download never looks complete.
 *
 * Robustness strategy: for each mirror (primary, then fallbacks), probe
 * reachability, then loop ranged attempts — every interruption resumes
 * from the last good byte, stalls fail fast via watchdog, and retries
 * back off automatically. The user taps once; the engine keeps going.
 */
export function downloadModel(
  modelId: string,
  cb: DownloadCallbacks = {},
): DownloadHandle {
  const model = getModel(modelId);
  const expectedBytes = model.sizeMB * MB;
  let cancelled = false;
  let currentToken: string | null = null;

  const throwIfCancelled = () => {
    if (cancelled || cb.signal?.aborted) {
      throw new Error('Cancelled.');
    }
  };

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve, reject) => {
      if (cancelled || cb.signal?.aborted) {
        reject(new Error('Cancelled.'));
        return;
      }
      const t = setTimeout(resolve, ms);
      cb.signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          reject(new Error('Cancelled.'));
        },
        {once: true},
      );
    });

  const partSize = async (tmp: string): Promise<number> => {
    try {
      if (!(await fs.exists(tmp))) {
        return 0;
      }
      return Number((await fs.stat(tmp)).size) || 0;
    } catch {
      return 0;
    }
  };

  /**
   * One ranged attempt through the first-party native downloader.
   * Resolves the HTTP status; throws on interrupt/stall/cancel.
   * Progress reports cumulative bytes.
   */
  const runFetch = (
    url: string,
    tmp: string,
    baseOffset: number,
  ): Promise<number> =>
    new Promise<number>((resolve, reject) => {
      const token = newDownloadToken();
      currentToken = token;
      let settled = false;
      let stalled = false;
      let lastT = Date.now();
      const finish = (fn: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        clearInterval(watchdog);
        cb.signal?.removeEventListener('abort', abortListener);
        if (currentToken === token) {
          currentToken = null;
        }
        fn();
      };
      cb.onProgress?.(baseOffset / MB, expectedBytes / MB);
      const watchdog = setInterval(() => {
        if (settled) {
          return;
        }
        if (Date.now() - lastT > STALL_AFTER_MS) {
          stalled = true;
          nativeCancelDownload(token);
        }
      }, WATCHDOG_TICK_MS);
      const abortListener = () => {
        cancelled = true;
        nativeCancelDownload(token);
      };
      cb.signal?.addEventListener('abort', abortListener, {once: true});
      nativeRangeDownload(url, tmp, baseOffset, token, receivedThisCall => {
        lastT = Date.now();
        const rx = baseOffset + receivedThisCall;
        cb.onProgress?.(rx / MB, expectedBytes / MB);
      }).then(
        r => finish(() => {
          log(
            'info',
            'models',
            `source answered ${r.status} via ${r.finalUrl || url}`,
          );
          resolve(r.status);
        }),
        e => finish(() => {
          if (cancelled || cb.signal?.aborted) {
            reject(new Error('Cancelled.'));
            return;
          }
          if (stalled) {
            reject(new Error('Stalled (no data for 25s).'));
            return;
          }
          const code = (e as {code?: unknown} | null)?.code;
          if (typeof code === 'string' && code.startsWith('HTTP_')) {
            reject(new FetchStatusError(Number(code.slice(5)) || 0));
            return;
          }
          reject(e instanceof Error ? e : new Error(String(e)));
        }),
      );
    });

  const done = (async (): Promise<string> => {
    await ensureDir();
    const dest = modelFilePath(model);
    const tmp = `${dest}.part`;
    const urls = mirrorUrls(model);
    let lastError: unknown = null;

    for (let mi = 0; mi < urls.length; mi++) {
      throwIfCancelled();
      const url = urls[mi];
      const host = (() => {
        try {
          return new URL(url).host;
        } catch {
          return url;
        }
      })();
      cb.onStatus?.(`Contacting source ${mi + 1}/${urls.length}…`);
      log('info', 'models', `${model.id}: probing ${host}`);
      const probe = await probeMirror(url, cb.signal);
      log(
        'info',
        'models',
        `${model.id}: ${host} → status=${probe.status} ranges=${probe.ranges}${
          probe.ok ? '' : ` (${probe.reason})`
        }`,
      );
      if (!probe.ok) {
        lastError = new Error(`${host}: ${probe.reason}`);
        continue;
      }

      let have = await partSize(tmp);
      if (have > expectedBytes + MB) {
        await fs.unlink(tmp).catch(() => undefined);
        have = 0;
      }
      if (have > 0 && !probe.ranges) {
        log('warn', 'models', `${host} ignores Range; restarting this source fresh`);
        await fs.unlink(tmp).catch(() => undefined);
        have = 0;
      }
      if (have >= expectedBytes * 0.95) {
        break; // previous run basically finished → verify + promote below
      }
      cb.onStatus?.(
        have > 0
          ? `Resuming from ${(have / MB).toFixed(1)} MB (source ${mi + 1}/${urls.length})`
          : `Downloading from source ${mi + 1}/${urls.length}…`,
      );
      log(
        'info',
        'models',
        have > 0
          ? `Resuming ${model.id} from ${(have / MB).toFixed(1)} MB via ${host}`
          : `Downloading ${model.id} (${model.sizeMB} MB) via ${host}`,
      );

      let freshRestarted = false;
      let mirrorComplete = false;
      for (let att = 1; att <= MAX_ATTEMPTS_PER_MIRROR; att++) {
        throwIfCancelled();
        have = await partSize(tmp);
        const haveBefore = have;
        try {
          const status = await runFetch(url, tmp, have);
          if (status === 416) {
            if (haveBefore >= expectedBytes * 0.95) {
              log('info', 'models', `${host}: range unsatisfiable — file complete`);
              mirrorComplete = true;
              break;
            }
            lastError = new Error('Server has nothing more to send.');
            break; // next mirror
          }
          if (status < 200 || status >= 300) {
            throw new FetchStatusError(status);
          }
          if (have > 0 && status === 200 && !freshRestarted) {
            // Server ignored Range: tmp holds part + full copy. Restart once.
            log('warn', 'models', `${host} ignored Range; restarting fresh`);
            await fs.unlink(tmp).catch(() => undefined);
            freshRestarted = true;
            continue;
          }
          have = await partSize(tmp);
          if (have >= expectedBytes * 0.95) {
            mirrorComplete = true;
            break;
          }
          if (have <= haveBefore) {
            // Clean close but zero new bytes (the user's instant-failure
            // shape): back off and retry instead of spinning.
            throw new Error(
              'Server closed the connection with no new data.',
            );
          }
          // Clean break, more to go — loop back for the next range.
          log(
            'info',
            'models',
            `${host}: got ${(have / MB).toFixed(1)} MB so far, continuing`,
          );
        } catch (e) {
          if (cancelled || cb.signal?.aborted) {
            throw new Error('Cancelled.');
          }
          if (
            e instanceof FetchStatusError &&
            e.status !== 429 &&
            e.status < 500
          ) {
            lastError = e; // client error: this mirror won't work, move on
            break;
          }
          lastError = e;
          const detail = e instanceof Error ? e.message : String(e);
          log('warn', 'models', `${model.id} attempt ${att} failed: ${detail}`);
          if (att < MAX_ATTEMPTS_PER_MIRROR) {
            cb.onStatus?.(`Interrupted — retrying (${att}/${MAX_ATTEMPTS_PER_MIRROR})…`);
            await sleep(Math.min(BACKOFF_BASE_MS * att, BACKOFF_MAX_MS));
          }
        }
      }
      if (mirrorComplete) {
        break;
      }
      // Attempts exhausted on this mirror: next mirror resumes the .part.
      log('warn', 'models', `${host} exhausted, trying next source`);
    }

    // Integrity gate before exposing the file.
    const bytes = await partSize(tmp);
    if (bytes >= expectedBytes * 0.95) {
      await fs.mv(tmp, dest);
      log('info', 'models', `Downloaded ${modelId} (${(bytes / MB).toFixed(1)} MB)`);
      return dest;
    }
    if (lastError instanceof Error && lastError.message !== 'Cancelled.') {
      throw lastError;
    }
    throw new Error(
      `Download incomplete (${(bytes / MB).toFixed(1)} MB). Retry — it resumes.`,
    );
  })();

  return {
    cancel: () => {
      cancelled = true;
      if (currentToken) {
        nativeCancelDownload(currentToken);
      }
    },
    done,
  };
}

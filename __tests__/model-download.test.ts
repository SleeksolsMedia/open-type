/**
 * Exercises downloadModel resume + stall watchdog with a scripted
 * react-native-blob-util mock (chunked delivery, failures, hangs).
 */

type FetchPlan = {
  status?: number;
  /** chunk sizes in bytes delivered via progress, in order */
  chunks?: number[];
  /** reject with this message after `failAfter` chunks */
  failAfter?: number;
  failMessage?: string;
  /** never settle (watchdog must fire) */
  hang?: boolean;
  /** reject with a coded native error (e.g. HTTP_404) */
  code?: string;
};

const MB = 1024 * 1024;

const M = (
  jest.requireMock('react-native-blob-util') as {
    __state: {
      files: Map<string, number>;
      planQueue: FetchPlan[];
      defaultPlan: FetchPlan | null;
      lastHeaders: Array<Record<string, string>>;
      lastPaths: string[];
      cancels: number;
    };
  }
).__state;

jest.mock('react-native-blob-util', () => {
  const S = {
    files: new Map<string, number>(),
    planQueue: [] as FetchPlan[],
    defaultPlan: null as FetchPlan | null,
    lastHeaders: [] as Array<Record<string, string>>,
    lastPaths: [] as string[],
    cancels: 0,
  };
  const strip = (p: string) => p.replace('?append=true', '');
  const fs = {
    dirs: {DocumentDir: '/docs', CacheDir: '/cache'},
    exists: async (p: string) => S.files.has(strip(p)),
    mkdir: async () => {},
    stat: async (p: string) => ({size: String(S.files.get(strip(p)) ?? 0)}),
    unlink: async (p: string) => {
      S.files.delete(strip(p));
    },
    mv: async (from: string, to: string) => {
      S.files.set(to, S.files.get(strip(from)) ?? 0);
      S.files.delete(strip(from));
    },
    writeFile: async () => {},
    readFile: async () => '',
  };
  const config = (opts: {path?: string; overwrite?: boolean}) => ({
    fetch: (_method: string, _url: string, headers?: Record<string, string>) => {
      const plan = S.planQueue.shift() ?? S.defaultPlan ?? {status: 200, chunks: []};
      S.lastHeaders.push(headers ?? {});
      S.lastPaths.push(opts.path ?? '');
      let progressCb: ((rx: number, total: number) => void) | null = null;
      let rejectTask!: (e: Error) => void;
      let settled = false;
      const task = new Promise<{info: () => {status: number}}>(
        (resolve, reject) => {
          rejectTask = reject;
          // report per-response bytes (append-aware handled by caller offset)
          deliverWithResponseBytes();
          async function deliverWithResponseBytes() {
            if (plan.hang) {
              return;
            }
            const base = strip(opts.path ?? '');
            const appending = !!opts.path?.includes('?append=true');
            if (!appending) {
              S.files.set(base, 0);
            }
            let rx = 0;
            const chunks = plan.chunks ?? [];
            for (let i = 0; i < chunks.length; i++) {
              if (settled) {
                return;
              }
              if (plan.failAfter === i) {
                reject(new Error(plan.failMessage ?? 'Download interrupted.'));
                return;
              }
              rx += chunks[i];
              S.files.set(base, (S.files.get(base) ?? 0) + chunks[i]);
              progressCb?.(rx, 0);
              await new Promise<void>(done => setTimeout(done, 1));
            }
            if (settled) {
              return;
            }
            if (plan.failAfter === chunks.length) {
              reject(new Error(plan.failMessage ?? 'Download interrupted.'));
              return;
            }
            resolve({info: () => ({status: plan.status ?? 200})});
          }
        },
      ) as Promise<{info: () => {status: number}}> & {
        progress: (cb: (rx: number, total: number) => void) => unknown;
        cancel: (cb?: () => void) => void;
      };
      (task as unknown as {progress: unknown}).progress = (
        cb: (rx: number, total: number) => void,
      ) => {
        progressCb = cb;
        return task;
      };
      (task as unknown as {cancel: unknown}).cancel = (cb?: () => void) => {
        if (!settled) {
          settled = true;
          S.cancels += 1;
          rejectTask(new Error('cancelled by test'));
        }
        cb?.();
      };
      return task;
    },
  });
  return {
    __esModule: true,
    default: {fs, config},
    __state: S,
    __files: S.files,
  };
});

jest.mock('../src/native/modelDownload');

import {
  downloadModel,
  getModel,
  isModelDownloaded,
  mirrorUrls,
} from '../src/providers/models';

const TINY_URL = getModel('tiny.en').url;

const DL = (
  jest.requireMock('../src/native/modelDownload') as {
    __state: {
      plans: Array<{
        status?: number;
        chunks?: number[];
        failAfter?: number;
        failMessage?: string;
        hang?: boolean;
        code?: string;
      }>;
      defaultPlan: unknown;
      calls: Array<{url: string; dest: string; offset: number}>;
      cancels: number;
      reset: () => void;
    };
  }
).__state;

const probe206 = () => ({
  ok: true,
  status: 206,
  headers: new Headers({
    'content-range': 'bytes 0-0/100',
    'accept-ranges': 'bytes',
  }),
});

beforeEach(() => {
  jest.useRealTimers();
  M.files.clear();
  M.planQueue = [];
  M.defaultPlan = null;
  M.lastHeaders = [];
  M.lastPaths = [];
  M.cancels = 0;
  DL.reset();
  globalThis.fetch = jest.fn().mockResolvedValue(probe206());
});

test('fresh download promotes file when size verifies', async () => {
  DL.plans.push({status: 200, chunks: [40 * MB, 40 * MB]});
  const h = downloadModel('tiny.en');
  const dest = await h.done;
  expect(dest.endsWith('ggml-tiny.en.bin')).toBe(true);
  expect(DL.calls[0].offset).toBe(0);
  expect(M.files.get(dest)).toBe(80 * MB);
  expect(await isModelDownloaded('tiny.en')).toBe(true);
});

test('interrupted download auto-resumes with Range (single tap)', async () => {
  // First native attempt: 30 MB arrive, then the connection breaks.
  DL.plans.push({
    status: 200,
    chunks: [30 * MB],
    failAfter: 1,
    failMessage: 'Download interrupted.',
  });
  // Auto-retry: server honors Range (206), remaining 50 MB arrive.
  DL.plans.push({status: 206, chunks: [25 * MB, 25 * MB]});
  const statuses: string[] = [];
  const dest = await downloadModel('tiny.en', {
    onStatus: s => statuses.push(s),
  }).done;
  expect(DL.calls[1].offset).toBe(30 * MB);
  expect(M.files.get(dest)).toBe(80 * MB);
  expect(statuses.some(s => /retrying|Resuming/i.test(s))).toBe(true);
});

test('server ignoring Range restarts fresh once', async () => {
  M.files.set('/docs/whisper-models/ggml-tiny.en.bin.part', 10 * MB);
  DL.plans.push({status: 200, chunks: [80 * MB]}); // ignores Range
  DL.plans.push({status: 200, chunks: [80 * MB]}); // fresh retry
  const dest = await downloadModel('tiny.en').done;
  expect(DL.calls[0].offset).toBe(10 * MB);
  expect(DL.calls[1].offset).toBe(0);
  expect(M.files.get(dest)).toBe(80 * MB);
});

test('stall watchdog aborts a hung connection', async () => {
  jest.useFakeTimers();
  DL.defaultPlan = {hang: true};
  const seen: number[] = [];
  const h = downloadModel('tiny.en', {
    onProgress: rx => seen.push(rx),
  });
  const p = h.done;
  // Fail the assertion chain loudly instead of hanging the suite.
  const assertion = p.then(
    () => {
      throw new Error('should have stalled');
    },
    (e: Error) => e,
  );
  // 2 mirrors × 8 attempts × (25s stall + backoff), fake time.
  await jest.advanceTimersByTimeAsync(900000);
  const err = await assertion;
  expect(String((err as Error).message)).toMatch(/stalled/i);
  expect(DL.cancels).toBeGreaterThan(0);
  jest.useRealTimers();
});

test('mirrorUrls orders primary then hf-mirror', () => {
  const urls = mirrorUrls(getModel('tiny.en'));
  expect(urls[0]).toBe(TINY_URL);
  expect(urls[1]).toBe(
    'https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
  );
});

test('dead primary falls through to mirror', async () => {
  const fetchMock = globalThis.fetch as jest.Mock;
  fetchMock.mockImplementation((url: string) =>
    String(url).includes('hf-mirror.com')
      ? Promise.resolve(probe206())
      : Promise.reject(new TypeError('fetch failed')),
  );
  DL.plans.push({status: 200, chunks: [80 * MB]});
  const dest = await downloadModel('tiny.en').done;
  expect(M.files.get(dest)).toBe(80 * MB);
  expect(
    fetchMock.mock.calls.some((c: unknown[]) =>
      String(c[0]).includes('hf-mirror.com'),
    ),
  ).toBe(true);
});

test('all mirrors dead surfaces the cause', async () => {
  (globalThis.fetch as jest.Mock).mockRejectedValue(
    new TypeError('fetch failed'),
  );
  await expect(downloadModel('tiny.en').done).rejects.toThrow(
    /fetch failed|unreachable|mirror/i,
  );
});

import * as BlobModule from 'react-native-blob-util';

export interface MockDlPlan {
  status?: number;
  chunks?: number[];
  failAfter?: number;
  failMessage?: string;
  hang?: boolean;
  code?: string;
}

interface CallRec {
  url: string;
  dest: string;
  offset: number;
}

const plans: MockDlPlan[] = [];
let defaultPlan: MockDlPlan | null = null;
const calls: CallRec[] = [];
let cancels = 0;
const pending = new Map<string, (e: Error) => void>();

const fallbackFiles = new Map<string, number>();

function blobFiles(): Map<string, number> {
  try {
    const m = BlobModule as unknown as {
      __files?: Map<string, number>;
      default?: {__files?: Map<string, number>};
    };
    const files = m.__files ?? m.default?.__files;
    if (files instanceof Map) {
      return files;
    }
  } catch {
    // Roots auto-mock without a numeric store (no download in those tests).
  }
  return fallbackFiles;
}

export async function nativeRangeDownload(
  url: string,
  dest: string,
  offset: number,
  token: string,
  onBytes: (rx: number) => void,
): Promise<{status: number; total: number; finalUrl: string}> {
  calls.push({url, dest, offset});
  const plan = plans.shift() ?? defaultPlan ?? {status: 200, chunks: []};
  return new Promise((resolve, reject) => {
    pending.set(token, e => {
      if (pending.delete(token)) {
        reject(e);
      }
    });
    const finishOk = (v: {status: number; total: number; finalUrl: string}) => {
      if (pending.delete(token)) {
        resolve(v);
      }
    };
    const finishErr = (e: Error) => {
      if (pending.delete(token)) {
        reject(e);
      }
    };
    (async () => {
      try {
        if (plan.hang) {
          await new Promise(() => {}); // settles only via cancel
          return;
        }
        const files = blobFiles();
        if (offset === 0) {
          files.set(dest, 0);
        }
        let rx = 0;
        const chunks = plan.chunks ?? [];
        for (let i = 0; i < chunks.length; i++) {
          if (plan.failAfter === i) {
            throw new Error(plan.failMessage ?? 'Download interrupted.');
          }
          rx += chunks[i];
          files.set(dest, (files.get(dest) ?? 0) + chunks[i]);
          onBytes(rx);
          await new Promise<void>(done => setTimeout(done, 1));
        }
        if (plan.failAfter === chunks.length) {
          throw new Error(plan.failMessage ?? 'Download interrupted.');
        }
        if (plan.code) {
          const e = new Error('native error') as Error & {code: string};
          e.code = plan.code;
          throw e;
        }
        finishOk({status: plan.status ?? 200, total: files.get(dest) ?? 0, finalUrl: url});
      } catch (e) {
        finishErr(e instanceof Error ? e : new Error(String(e)));
      }
    })();
  });
}

export async function nativeCancelDownload(token: string): Promise<void> {
  cancels += 1;
  pending.get(token)?.(new Error('cancelled by test'));
}

export function newDownloadToken(): string {
  return `t-${calls.length}`;
}

export function isNativeDownloaderAvailable(): boolean {
  return true;
}

export const __state = {
  plans,
  calls,
  get defaultPlan() {
    return defaultPlan;
  },
  set defaultPlan(p: MockDlPlan | null) {
    defaultPlan = p;
  },
  get cancels() {
    return cancels;
  },
  reset() {
    plans.length = 0;
    defaultPlan = null;
    calls.length = 0;
    cancels = 0;
    pending.clear();
  },
};

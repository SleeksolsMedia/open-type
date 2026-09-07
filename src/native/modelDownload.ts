import {DeviceEventEmitter, NativeModules, Platform} from 'react-native';

export interface NativeRangeResult {
  status: number;
  total: number;
  finalUrl: string;
  acceptRanges: boolean;
}

interface NativeModelDownload {
  downloadRange(
    url: string,
    dest: string,
    offset: number,
    token: string,
  ): Promise<NativeRangeResult>;
  cancelDownload(token: string): Promise<void>;
}

function mod(): NativeModelDownload | null {
  if (Platform.OS !== 'android') {
    return null;
  }
  const m = NativeModules.ModelDownloadModule as
    | NativeModelDownload
    | undefined;
  return m ?? null;
}

export function isNativeDownloaderAvailable(): boolean {
  return mod() != null;
}

let tokenSeq = 0;
export function newDownloadToken(): string {
  tokenSeq += 1;
  return `dl-${Date.now().toString(36)}-${tokenSeq}`;
}

/**
 * One ranged download via the first-party Kotlin downloader.
 * Progress events carry cumulative-per-call bytes for `token`;
 * `received < 0` is the completion tick and is ignored here.
 */
export async function nativeRangeDownload(
  url: string,
  dest: string,
  offset: number,
  token: string,
  onBytes: (receivedThisCall: number) => void,
): Promise<NativeRangeResult> {
  const m = mod();
  if (!m) {
    throw new Error('Native downloader unavailable.');
  }
  const sub = DeviceEventEmitter.addListener(
    'ModelDownloadProgress',
    (e: unknown) => {
      const evt = e as {token?: unknown; received?: unknown} | null;
      if (
        evt?.token === token &&
        typeof evt.received === 'number' &&
        evt.received >= 0
      ) {
        try {
          onBytes(evt.received);
        } catch {
          // Progress must never break the download.
        }
      }
    },
  );
  try {
    return await m.downloadRange(url, dest, offset, token);
  } finally {
    sub.remove();
  }
}

export async function nativeCancelDownload(token: string): Promise<void> {
  try {
    await mod()?.cancelDownload(token);
  } catch {
    // Best effort.
  }
}

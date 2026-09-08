export interface WsConnectOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Open a WebSocket with connect timeout + cancellation.
 * React Native supports headers (Android) and binary send.
 */
export function connectWs(
  url: string,
  opts: WsConnectOptions = {},
): Promise<WebSocket> {
  const {headers, timeoutMs = 12000, signal} = opts;
  return new Promise<WebSocket>((resolve, reject) => {
    let settled = false;
    const done = (fn: () => void) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fn();
      }
    };
    let ws: WebSocket;
    try {
      ws = new WebSocket(url, null, headers ? {headers} : undefined);
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    const timer = setTimeout(() => {
      done(() => {
        try {
          ws.close();
        } catch {
          // Already dead.
        }
        reject(new Error('WebSocket connect timed out. Check URL and network.'));
      });
    }, timeoutMs);
    if (signal?.aborted) {
      done(() => {
        try {
          ws.close();
        } catch {
          // Ignore.
        }
        reject(new Error('Cancelled.'));
      });
      return;
    }
    signal?.addEventListener(
      'abort',
      () => {
        done(() => {
          try {
            ws.close();
          } catch {
            // Ignore.
          }
          reject(new Error('Cancelled.'));
        });
      },
      {once: true},
    );
    ws.onopen = () => done(() => resolve(ws));
    ws.onerror = () => {
      done(() => {
        try {
          ws.close();
        } catch {
          // Ignore.
        }
        reject(new Error('WebSocket connection failed. Check URL, key, and network.'));
      });
    };
  });
}

/** Send binary (copied to a fresh ArrayBuffer for bridge safety). */
export function wsSendBinary(ws: WebSocket, bytes: Uint8Array): void {
  const copy = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  ws.send(copy);
}

/** Wait for a condition with timeout (handshake/test helpers). */
export function waitFor(
  cond: () => boolean,
  timeoutMs: number,
  idleMessage: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const start = Date.now();
    const id = setInterval(() => {
      if (cond()) {
        clearInterval(id);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(id);
        reject(new Error(idleMessage));
      }
    }, 100);
  });
}

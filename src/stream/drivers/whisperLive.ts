import {connectWs, waitFor} from '../transport';
import type {StreamDriver, StreamEvent} from '../types';

export interface WhisperLiveConfig {
  /** Full address: full ws(s) URL, host:port, or bare host. */
  serverUrl?: string;
  /** Legacy split fields; serverUrl wins when set. */
  host?: string;
  port?: number;
  tls?: boolean;
  /** Optional key, sent as a Bearer handshake header (auth proxies). */
  apiKey?: string;
}

const DEFAULT_PORT = 9090;
const END_OF_AUDIO = 'END_OF_AUDIO';

export interface WhisperLiveSegment {
  text?: unknown;
  start?: unknown;
  end?: unknown;
  completed?: unknown;
}

export type ParsedWhisperLive =
  | {kind: 'ready'}
  | {kind: 'finals'; finals: Array<{text: string; key: string}>}
  | {kind: 'error'; message: string}
  | {kind: 'server-closed'}
  | {kind: 'ignore'};

export function buildWhisperLiveUrl(cfg: WhisperLiveConfig): string {
  const raw = (cfg.serverUrl ?? '').trim() || (cfg.host ?? '').trim();
  if (!raw) {
    throw new Error('WhisperLive server address is missing.');
  }
  const m = raw.match(/^(wss?:\/\/)?([^/]+)(\/.*)?$/i);
  if (!m) {
    throw new Error('That server address does not look like a URL or host.');
  }
  const [, scheme, authority, path] = m;
  const secure = scheme
    ? scheme.toLowerCase() === 'wss://'
    : !!cfg.tls;
  let hostPort = authority;
  if (!/:\d+$/.test(hostPort)) {
    const port =
      cfg.serverUrl && cfg.serverUrl.trim() !== ''
        ? 0 // full URL without port: keep as-is (default 443/80 downstream)
        : cfg.port && cfg.port > 0
          ? cfg.port
          : DEFAULT_PORT;
    if (port > 0) {
      hostPort = `${hostPort}:${port}`;
    }
  }
  const cleanPath = (path ?? '').replace(/\/+$/, '');
  return `${secure ? 'wss' : 'ws'}://${hostPort}${cleanPath}`;
}

/** Pure parser — unit-tested with recorded fixtures. */
export function parseWhisperLiveMessage(raw: string): ParsedWhisperLive {
  let msg: unknown;
  try {
    msg = JSON.parse(raw) as unknown;
  } catch {
    return {kind: 'ignore'};
  }
  const m = msg as {
    status?: unknown;
    message?: unknown;
    segments?: unknown;
    uid?: unknown;
  };
  if (m.status === 'ERROR') {
    const detail =
      typeof m.message === 'string' && m.message !== ''
        ? m.message.slice(0, 200)
        : 'server error';
    return {kind: 'error', message: `WhisperLive: ${detail}`};
  }
  if (m.message === 'SERVER_READY') {
    return {kind: 'ready'};
  }
  if (m.message === 'DISCONNECT') {
    return {kind: 'server-closed'};
  }
  if (Array.isArray(m.segments)) {
    const finals = (m.segments as WhisperLiveSegment[])
      .filter(s => s.completed === true && typeof s.text === 'string')
      .map(s => ({
        text: (s.text as string).trim(),
        key: `${String(s.start)}|${String(s.end)}|${(s.text as string).trim()}`,
      }))
      .filter(s => s.text !== '');
    return {kind: 'finals', finals};
  }
  return {kind: 'ignore'};
}

export class WhisperLiveDriver implements StreamDriver {
  readonly name = 'WhisperLive';
  private ws: WebSocket | null = null;
  private emit: (e: StreamEvent) => void = () => undefined;
  private ready = false;
  private uid: string;

  constructor(private cfg: WhisperLiveConfig) {
    this.uid = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  }

  onEvent(cb: (e: StreamEvent) => void): void {
    this.emit = cb;
  }

  async connect(signal?: AbortSignal): Promise<void> {
    const key = (this.cfg.apiKey ?? '').trim();
    const ws = await connectWs(buildWhisperLiveUrl(this.cfg), {
      ...(key ? {headers: {Authorization: `Bearer ${key}`}} : {}),
      timeoutMs: 12000,
      signal,
    });
    this.ws = ws;
    // Fixed handshake: the server owns model + language selection.
    ws.send(
      JSON.stringify({
        uid: this.uid,
        language: null,
        task: 'transcribe',
        model: 'small',
        use_vad: true,
        audio_format: 'int16',
      }),
    );
    ws.onmessage = (ev: {data?: unknown}) => {
      if (typeof ev.data !== 'string') {
        return;
      }
      const parsed = parseWhisperLiveMessage(ev.data);
      if (parsed.kind === 'ready') {
        this.ready = true;
      } else if (parsed.kind === 'finals') {
        for (const f of parsed.finals) {
          this.emit({type: 'final', text: f.text, key: f.key});
        }
      } else if (parsed.kind === 'error') {
        this.emit({type: 'error', message: parsed.message});
      } else if (parsed.kind === 'server-closed') {
        this.emit({type: 'closed'});
      }
    };
    ws.onerror = () => {
      this.emit({type: 'error', message: 'WhisperLive socket error.'});
    };
    ws.onclose = () => {
      this.ws = null;
      this.emit({type: 'closed'});
    };
  }

  sendAudio(pcm16: Uint8Array): void {
    try {
      // Server takes raw int16 (audio_format handshake); no conversion.
      const buf = pcm16.buffer.slice(
        pcm16.byteOffset,
        pcm16.byteOffset + pcm16.byteLength,
      ) as ArrayBuffer;
      this.ws?.send(buf);
    } catch {
      // Socket dying mid-stream surfaces via onclose; don't crash the recorder.
    }
  }

  async finalize(): Promise<void> {
    try {
      // ASCII-only marker; no TextEncoder needed (absent from RN lib defs).
      const bytes = Uint8Array.from(
        END_OF_AUDIO.split('').map(c => c.charCodeAt(0)),
      );
      const buf = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      this.ws?.send(buf);
    } catch {
      // Best effort; grace period below still collects stragglers.
    }
    // Server transcribes buffered audio, sends finals, then closes itself.
    await waitFor(() => this.ws == null, 12000, 'WhisperLive did not finish.').catch(
      () => undefined,
    );
    this.close();
  }

  close(): void {
    try {
      this.ws?.close();
    } catch {
      // Already closed.
    }
    this.ws = null;
  }

  async test(signal?: AbortSignal): Promise<void> {
    await this.connect(signal);
    try {
      await waitFor(
        () => this.ready,
        12000,
        'No SERVER_READY — is the WhisperLive server running on that host:port?',
      );
    } finally {
      this.close();
    }
  }
}

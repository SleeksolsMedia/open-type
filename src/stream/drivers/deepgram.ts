import {connectWs, waitFor} from '../transport';
import type {StreamDriver, StreamEvent} from '../types';

export interface DeepgramConfig {
  apiKey: string;
  model?: string;
  language?: string;
}

const DEFAULT_MODEL = 'nova-3';

export function buildDeepgramUrl(cfg: DeepgramConfig): string {
  const q = new URLSearchParams({
    model: (cfg.model ?? '').trim() || DEFAULT_MODEL,
    language: (cfg.language ?? '').trim() || 'en',
    encoding: 'linear16',
    sample_rate: '16000',
    channels: '1',
    interim_results: 'false',
    endpointing: '300',
    smart_format: 'true',
    punctuate: 'true',
  });
  return `wss://api.deepgram.com/v1/listen?${q.toString()}`;
}

export type ParsedDeepgram =
  | {kind: 'final'; text: string}
  | {kind: 'error'; message: string}
  | {kind: 'ignore'};

/** Pure parser — unit-tested with recorded fixtures. */
export function parseDeepgramMessage(raw: string): ParsedDeepgram {
  let msg: unknown;
  try {
    msg = JSON.parse(raw) as unknown;
  } catch {
    return {kind: 'ignore'};
  }
  const m = msg as {
    type?: unknown;
    channel?: {alternatives?: Array<{transcript?: unknown}>};
    is_final?: unknown;
    description?: unknown;
    message?: unknown;
  };
  if (m.type === 'Results') {
    const text = m.channel?.alternatives?.[0]?.transcript;
    if (m.is_final === true && typeof text === 'string' && text.trim() !== '') {
      return {kind: 'final', text: text.trim()};
    }
    return {kind: 'ignore'};
  }
  if (m.type === 'Metadata') {
    return {kind: 'ignore'};
  }
  if (typeof m.description === 'string' && m.description !== '') {
    return {kind: 'error', message: `Deepgram: ${m.description.slice(0, 200)}`};
  }
  return {kind: 'ignore'};
}

export class DeepgramDriver implements StreamDriver {
  readonly name = 'Deepgram';
  private ws: WebSocket | null = null;
  private emit: (e: StreamEvent) => void = () => undefined;
  private seq = 0;
  private heardFromServer = false;

  constructor(private cfg: DeepgramConfig) {}

  onEvent(cb: (e: StreamEvent) => void): void {
    this.emit = cb;
  }

  async connect(signal?: AbortSignal): Promise<void> {
    const key = (this.cfg.apiKey ?? '').trim();
    if (!key) {
      throw new Error('Deepgram API key is missing.');
    }
    const ws = await connectWs(buildDeepgramUrl(this.cfg), {
      headers: {Authorization: `Token ${key}`},
      timeoutMs: 12000,
      signal,
    });
    this.ws = ws;
    ws.onmessage = (ev: {data?: unknown}) => {
      if (typeof ev.data !== 'string') {
        return;
      }
      this.heardFromServer = true;
      const parsed = parseDeepgramMessage(ev.data);
      if (parsed.kind === 'final') {
        this.seq += 1;
        this.emit({type: 'final', text: parsed.text, key: `dg-${this.seq}`});
      } else if (parsed.kind === 'error') {
        this.emit({type: 'error', message: parsed.message});
      }
    };
    ws.onerror = () => {
      this.emit({type: 'error', message: 'Deepgram socket error.'});
    };
    ws.onclose = () => {
      this.ws = null;
      this.emit({type: 'closed'});
    };
  }

  sendAudio(pcm16: Uint8Array): void {
    try {
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
      this.ws?.send(JSON.stringify({type: 'Finalize'}));
    } catch {
      // Best effort; grace period below still collects stragglers.
    }
    await new Promise<void>(done => setTimeout(done, 3000));
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
      // Metadata arrives right after open on a valid key.
      await waitFor(() => this.heardFromServer, 8000, 'Deepgram stayed silent — check the API key.');
    } finally {
      this.close();
    }
  }
}

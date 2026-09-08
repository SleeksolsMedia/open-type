import {b64decode, b64encode, resamplePcm16} from '../codec';
import {connectWs, waitFor} from '../transport';
import type {StreamDriver, StreamEvent} from '../types';

export interface OpenAiLiveConfig {
  apiKey: string;
  model?: string;
  language?: string;
}

const URL = 'wss://api.openai.com/v1/realtime?intent=transcription';
const DEFAULT_MODEL = 'gpt-4o-mini-transcribe';

export type ParsedOpenAi =
  | {kind: 'ready'}
  | {kind: 'final'; text: string}
  | {kind: 'error'; message: string}
  | {kind: 'ignore'};

/** Pure parser — unit-tested with recorded fixtures. */
export function parseOpenAiMessage(raw: string): ParsedOpenAi {
  let msg: unknown;
  try {
    msg = JSON.parse(raw) as unknown;
  } catch {
    return {kind: 'ignore'};
  }
  const m = msg as {type?: unknown; transcript?: unknown; error?: unknown};
  if (typeof m.type !== 'string') {
    return {kind: 'ignore'};
  }
  if (
    m.type === 'session.created' ||
    m.type === 'session.updated' ||
    m.type.startsWith('transcription_session.')
  ) {
    return {kind: 'ready'};
  }
  if (m.type === 'conversation.item.input_audio_transcription.completed') {
    if (typeof m.transcript === 'string' && m.transcript.trim() !== '') {
      return {kind: 'final', text: m.transcript.trim()};
    }
    return {kind: 'ignore'};
  }
  if (m.type === 'error') {
    const err = m.error as {message?: unknown} | undefined;
    const detail =
      typeof err?.message === 'string' && err.message !== ''
        ? err.message.slice(0, 200)
        : 'unknown error';
    return {kind: 'error', message: `OpenAI Realtime: ${detail}`};
  }
  return {kind: 'ignore'};
}

export class OpenAiLiveDriver implements StreamDriver {
  readonly name = 'OpenAI Live';
  private ws: WebSocket | null = null;
  private emit: (e: StreamEvent) => void = () => undefined;
  private seq = 0;
  private ready = false;

  constructor(private cfg: OpenAiLiveConfig) {}

  onEvent(cb: (e: StreamEvent) => void): void {
    this.emit = cb;
  }

  async connect(signal?: AbortSignal): Promise<void> {
    const key = (this.cfg.apiKey ?? '').trim();
    if (!key) {
      throw new Error('OpenAI API key is missing.');
    }
    const ws = await connectWs(URL, {
      headers: {Authorization: `Bearer ${key}`, 'OpenAI-Beta': 'realtime=v1'},
      timeoutMs: 12000,
      signal,
    });
    this.ws = ws;
    const model = (this.cfg.model ?? '').trim() || DEFAULT_MODEL;
    const language = (this.cfg.language ?? '').trim();
    ws.send(
      JSON.stringify({
        type: 'session.update',
        session: {
          type: 'transcription',
          audio: {
            input: {
              format: {type: 'audio/pcm', rate: 24000},
              transcription: {
                model,
                ...(language ? {language} : {}),
              },
              turn_detection: {type: 'server_vad'},
            },
          },
        },
      }),
    );
    ws.onmessage = (ev: {data?: unknown}) => {
      if (typeof ev.data !== 'string') {
        return;
      }
      const parsed = parseOpenAiMessage(ev.data);
      if (parsed.kind === 'ready') {
        this.ready = true;
      } else if (parsed.kind === 'final') {
        this.seq += 1;
        this.emit({type: 'final', text: parsed.text, key: `oai-${this.seq}`});
      } else if (parsed.kind === 'error') {
        this.emit({type: 'error', message: parsed.message});
      }
    };
    ws.onerror = () => {
      this.emit({type: 'error', message: 'OpenAI Realtime socket error.'});
    };
    ws.onclose = () => {
      this.ws = null;
      this.emit({type: 'closed'});
    };
  }

  sendAudio(pcm16k: Uint8Array): void {
    const ws = this.ws;
    if (!ws) {
      return;
    }
    try {
      // Server wants 24 kHz; we capture 16 kHz.
      const up = resamplePcm16(pcm16k, 16000, 24000);
      ws.send(
        JSON.stringify({type: 'input_audio_buffer.append', audio: b64encode(up)}),
      );
    } catch {
      // Socket dying mid-stream surfaces via onclose; don't crash the recorder.
    }
  }

  async finalize(): Promise<void> {
    try {
      this.ws?.send(JSON.stringify({type: 'input_audio_buffer.commit'}));
    } catch {
      // Best effort; grace period below still collects stragglers.
    }
    await new Promise<void>(done => setTimeout(done, 5000));
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
        10000,
        'No session from OpenAI — check the API key.',
      );
    } finally {
      this.close();
    }
  }

  /** Exposed for tests: decode + resample one captured frame. */
  static frameTo24k(base64Pcm16k: string): Uint8Array {
    return resamplePcm16(b64decode(base64Pcm16k), 16000, 24000);
  }
}

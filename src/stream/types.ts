/** Live (WebSocket) transcription providers. Groq is HTTP-only on purpose. */
export type LiveProviderId = 'openai-live' | 'deepgram' | 'whisper-live';

export interface LiveConfig {
  provider: LiveProviderId;
  apiKey?: string;
  model?: string;
  language?: string;
  /** whisper-live: full server address — bare host, host:port, or full ws(s) URL. */
  serverUrl?: string;
  /** Legacy split fields (kept for saved settings); serverUrl wins. */
  host?: string;
  port?: number;
  tls?: boolean;
  /** On any live failure, run the HTTP upload pipeline on the kept WAV. */
  fallbackToUpload: boolean;
}

export const LIVE_PROVIDERS: Array<{
  id: LiveProviderId;
  label: string;
  hint: string;
}> = [
  {
    id: 'openai-live',
    label: 'OpenAI Live',
    hint: 'Realtime transcription · needs API key',
  },
  {
    id: 'deepgram',
    label: 'Deepgram',
    hint: 'Streaming nova · needs API key',
  },
  {
    id: 'whisper-live',
    label: 'WhisperLive self-host',
    hint: 'Your own server · usually no key',
  },
];

export type StreamEvent =
  | {type: 'final'; text: string; key: string}
  | {type: 'error'; message: string}
  | {type: 'closed'};

export interface StreamDriver {
  readonly name: string;
  connect(signal?: AbortSignal): Promise<void>;
  sendAudio(pcm16: Uint8Array): void;
  /** End-of-speech: flush finals, then resolve. */
  finalize(): Promise<void>;
  close(): void;
  onEvent(cb: (e: StreamEvent) => void): void;
  /** Real handshake test used by setup screens. */
  test(signal?: AbortSignal): Promise<void>;
}

export class LiveUnavailableError extends Error {}
